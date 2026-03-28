/**
 * GitHub Polling Plugin for Beige.
 *
 * Monitors GitHub notifications via periodic API polling (similar to Telegram's
 * long-polling approach). No webhooks or infrastructure required.
 *
 * Features:
 * - Poll GitHub notifications API every N seconds (configurable, default 60s)
 * - Filter for @mentions, replies, or all activity
 * - Route events to agents via channel adapter
 * - Include full comment thread in session context
 * - Support for watching specific repos and PRs
 * - Session steering for multiple events on same issue/PR
 *
 * Config (passed via pluginConfigs or plugins.github-polling.config):
 *   enabled:              false - must be explicitly enabled
 *   token:                GitHub PAT (optional if gh already authenticated)
 *   username:             GitHub username to watch for mentions (required)
 *   pollIntervalSeconds:   60 (default, min 30, max 3600)
 *   respondTo:            "mentions" | "all" | "watched" (default: "mentions")
 *   includeFullThread:     true (include full comment thread)
 *   watchedRepos:          ["owner/repo", ...] (optional)
 *   watchedPrs:            [123, 456, ...] (optional)
 *   agentMapping:          { default: "agentName", "owner/repo": "otherAgent" }
 */

import { spawn } from "child_process";
import { resolveBin } from "../_shared/resolve-bin.ts";
import type {
  PluginInstance,
  PluginContext,
  PluginRegistrar,
  ChannelAdapter,
} from "@matthias-hausberger/beige";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubPollingConfig {
  enabled: boolean;
  token?: string;
  username: string;
  pollIntervalSeconds: number;
  respondTo: "mentions" | "all" | "watched";
  includeFullThread: boolean;
  watchedRepos?: string[];
  watchedPrs?: number[];
  agentMapping: { default: string; [repo: string]: string };
}

interface GitHubNotification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  subject: {
    title: string;
    type: string;
    url: string;
    latest_comment_url?: string;
  };
  repository: {
    full_name: string;
    html_url: string;
  };
}

interface IssueComment {
  id: number;
  body: string;
  html_url: string;
  user: {
    login: string;
  };
  created_at: string;
}

interface PRComment {
  id: number;
  body: string;
  html_url: string;
  user: {
    login: string;
  };
  created_at: string;
  path?: string;
  line?: number;
}

interface IssueThread {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  user: {
    login: string;
  };
  created_at: string;
  comments: IssueComment[];
}

interface PRThread {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed" | "merged";
  user: {
    login: string;
  };
  created_at: string;
  comments: PRComment[];
  review_comments: PRComment[];
}

// ---------------------------------------------------------------------------
// Polling State
// ---------------------------------------------------------------------------

interface PollingState {
  timer: NodeJS.Timeout | null;
  lastCheckTimestamp: string;
  seenNotificationIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export function createPlugin(
  config: Record<string, unknown>,
  ctx: PluginContext
): PluginInstance {
  const cfg = config as unknown as GitHubPollingConfig;

  // Validation
  if (!cfg.username) {
    throw new Error("GitHub polling plugin requires 'username' in config");
  }
  if (!cfg.agentMapping?.default) {
    throw new Error("GitHub polling plugin requires 'agentMapping.default' in config");
  }
  if (cfg.pollIntervalSeconds && (cfg.pollIntervalSeconds < 30 || cfg.pollIntervalSeconds > 3600)) {
    ctx.log.warn(`pollIntervalSeconds out of range [30, 3600], clamping to 60`);
    cfg.pollIntervalSeconds = 60;
  }

  // Set defaults
  cfg.enabled = cfg.enabled ?? false;
  cfg.pollIntervalSeconds = cfg.pollIntervalSeconds ?? 60;
  cfg.respondTo = (cfg.respondTo as "mentions" | "all" | "watched") ?? "mentions";
  cfg.includeFullThread = cfg.includeFullThread ?? true;

  // Polling state
  const state: PollingState = {
    timer: null,
    lastCheckTimestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Start 5 min ago
    seenNotificationIds: new Set(),
  };

  // Resolve gh binary
  const ghBin = resolveBin("gh");

  // ---------------------------------------------------------------------------
  // Helper: Execute gh command
  // ---------------------------------------------------------------------------

  async function execGh(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const env = cfg.token ? { ...process.env, GH_TOKEN: cfg.token } : process.env;

      const proc = spawn(ghBin, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on("error", (err) => {
        resolve({
          stdout: "",
          stderr: `Failed to spawn gh (${ghBin}): ${err.message}`,
          exitCode: 1,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Helper: Fetch notifications since timestamp
  // ---------------------------------------------------------------------------

  async function fetchNotifications(since: string): Promise<GitHubNotification[]> {
    const result = await execGh([
      "api",
      "notifications",
      "--paginate",
      "--jq",
      ".[]",
      "-f",
      `since=${since}`,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to fetch notifications: ${result.stderr}`);
    }

    const lines = result.stdout.trim().split("\n").filter((l) => l);
    return lines.map((line) => JSON.parse(line));
  }

  // ---------------------------------------------------------------------------
  // Helper: Fetch issue comment details
  // ---------------------------------------------------------------------------

  async function fetchIssueComment(url: string): Promise<IssueComment | null> {
    const result = await execGh(["api", "--jq", ".", url]);

    if (result.exitCode !== 0) {
      ctx.log.warn(`Failed to fetch issue comment from ${url}: ${result.stderr}`);
      return null;
    }

    return JSON.parse(result.stdout);
  }

  // ---------------------------------------------------------------------------
  // Helper: Fetch PR comment details
  // ---------------------------------------------------------------------------

  async function fetchPRComment(url: string): Promise<PRComment | null> {
    const result = await execGh(["api", "--jq", ".", url]);

    if (result.exitCode !== 0) {
      ctx.log.warn(`Failed to fetch PR comment from ${url}: ${result.stderr}`);
      return null;
    }

    return JSON.parse(result.stdout);
  }

  // ---------------------------------------------------------------------------
  // Helper: Fetch full issue thread
  // ---------------------------------------------------------------------------

  async function fetchIssueThread(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IssueThread | null> {
    const result = await execGh([
      "api",
      `repos/${owner}/${repo}/issues/${issueNumber}`,
      "--jq",
      ".",
    ]);

    if (result.exitCode !== 0) {
      ctx.log.warn(`Failed to fetch issue ${owner}/${repo}#${issueNumber}: ${result.stderr}`);
      return null;
    }

    const issue = JSON.parse(result.stdout);

    // Fetch comments
    const commentsResult = await execGh([
      "api",
      `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      "--paginate",
      "--jq",
      ".[]",
    ]);

    const comments: IssueComment[] = [];
    if (commentsResult.exitCode === 0) {
      const lines = commentsResult.stdout.trim().split("\n").filter((l) => l);
      for (const line of lines) {
        try {
          comments.push(JSON.parse(line));
        } catch (e) {
          ctx.log.warn(`Failed to parse comment: ${e}`);
        }
      }
    }

    return {
      number: issue.number,
      title: issue.title,
      html_url: issue.html_url,
      state: issue.state,
      user: { login: issue.user.login },
      created_at: issue.created_at,
      comments,
    };
  }

  // ---------------------------------------------------------------------------
  // Helper: Fetch full PR thread
  // ---------------------------------------------------------------------------

  async function fetchPRThread(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PRThread | null> {
    const result = await execGh([
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}`,
      "--jq",
      ".",
    ]);

    if (result.exitCode !== 0) {
      ctx.log.warn(`Failed to fetch PR ${owner}/${repo}#${prNumber}: ${result.stderr}`);
      return null;
    }

    const pr = JSON.parse(result.stdout);

    // Fetch PR comments
    const commentsResult = await execGh([
      "api",
      `repos/${owner}/${repo}/issues/${prNumber}/comments`,
      "--paginate",
      "--jq",
      ".[]",
    ]);

    const comments: PRComment[] = [];
    if (commentsResult.exitCode === 0) {
      const lines = commentsResult.stdout.trim().split("\n").filter((l) => l);
      for (const line of lines) {
        try {
          comments.push(JSON.parse(line));
        } catch (e) {
          ctx.log.warn(`Failed to parse comment: ${e}`);
        }
      }
    }

    // Fetch review comments
    const reviewCommentsResult = await execGh([
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      "--paginate",
      "--jq",
      ".[]",
    ]);

    const reviewComments: PRComment[] = [];
    if (reviewCommentsResult.exitCode === 0) {
      const lines = reviewCommentsResult.stdout.trim().split("\n").filter((l) => l);
      for (const line of lines) {
        try {
          reviewComments.push(JSON.parse(line));
        } catch (e) {
          ctx.log.warn(`Failed to parse review comment: ${e}`);
        }
      }
    }

    return {
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      state: pr.merged ? "merged" : pr.state,
      user: { login: pr.user.login },
      created_at: pr.created_at,
      comments,
      review_comments: reviewComments,
    };
  }

  // ---------------------------------------------------------------------------
  // Helper: Check if notification is relevant based on config
  // ---------------------------------------------------------------------------

  async function isNotificationRelevant(
    notif: GitHubNotification
  ): Promise<boolean> {
    const repo = notif.repository.full_name;

    // Check if repo is in watched list (if configured)
    if (cfg.respondTo === "watched" && cfg.watchedRepos?.length > 0) {
      if (!cfg.watchedRepos.includes(repo)) {
        return false;
      }
    }

    // Extract issue/PR number from URL
    const match = notif.subject.url.match(/\/(issues|pull)\/(\d+)$/);
    if (!match) {
      return false;
    }
    const number = parseInt(match[2], 10);

    // Check if PR/issue is in watched list (if configured)
    if (cfg.watchedPrs?.length > 0 && !cfg.watchedPrs.includes(number)) {
      return false;
    }

    // Filter by respondTo mode
    switch (cfg.respondTo) {
      case "all":
        // All notifications pass through
        return true;

      case "watched":
        // Only notifications from watched repos/PRs
        if (cfg.watchedRepos?.length > 0 || cfg.watchedPrs?.length > 0) {
          return true;
        }
        // If no watched repos/PRs, fall back to mentions
        return (
          notif.reason === "mention" ||
          notif.reason === "team_mention" ||
          notif.reason === "review_requested"
        );

      case "mentions":
      default:
        // Only mentions and review requests
        if (notif.reason === "mention" || notif.reason === "team_mention" || notif.reason === "review_requested") {
          return true;
        }

        // For issue comments, check if @mentioned in body
        if (notif.subject.type === "IssueComment" && notif.subject.latest_comment_url) {
          const comment = await fetchIssueComment(notif.subject.latest_comment_url);
          if (comment?.body?.includes(`@${cfg.username}`)) {
            return true;
          }
        }

        // For PR comments, check if @mentioned in body
        if (notif.subject.type === "PullRequestReviewComment" && notif.subject.latest_comment_url) {
          const comment = await fetchPRComment(notif.subject.latest_comment_url);
          if (comment?.body?.includes(`@${cfg.username}`)) {
            return true;
          }
        }

        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: Resolve agent name for a repo
  // ---------------------------------------------------------------------------

  function resolveAgent(repo: string): string {
    return cfg.agentMapping[repo] ?? cfg.agentMapping.default;
  }

  // ---------------------------------------------------------------------------
  // Helper: Build session key from notification
  // ---------------------------------------------------------------------------

  function getSessionKey(notif: GitHubNotification): string {
    const match = notif.subject.url.match(/\/repos\/([^\/]+)\/([^\/]+)\/(issues|pull)\/(\d+)$/);
    if (match) {
      const owner = match[1];
      const repo = match[2];
      const type = match[3]; // "issues" or "pull"
      const number = match[4];
      return `github:${owner}/${repo}:${type}/${number}`;
    }
    return `github:${notif.id}`;
  }

  // ---------------------------------------------------------------------------
  // Helper: Build context for agent
  // ---------------------------------------------------------------------------

  async function buildEventContext(notif: GitHubNotification): Promise<string> {
    const lines: string[] = [
      `GitHub Event: ${notif.subject.type}`,
      ``,
      `Repository: ${notif.repository.full_name}`,
      `URL: ${notif.repository.html_url}`,
      ``,
      `Subject: ${notif.subject.title}`,
      `Subject Type: ${notif.subject.type}`,
      `Subject URL: ${notif.subject.url}`,
      ``,
      `Notification Reason: ${notif.reason}`,
      `Last Updated: ${notif.updated_at}`,
      ``,
    ];

    // Include full thread if configured
    if (cfg.includeFullThread) {
      const match = notif.subject.url.match(/\/repos\/([^\/]+)\/([^\/]+)\/(issues|pull)\/(\d+)$/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        const type = match[3];
        const number = parseInt(match[4], 10);

        if (type === "issues") {
          const thread = await fetchIssueThread(owner, repo, number);
          if (thread) {
            lines.push(
              `---`,
              ``,
              `Issue #${thread.number}: ${thread.title}`,
              `State: ${thread.state}`,
              `URL: ${thread.html_url}`,
              ``,
              `Comments (${thread.comments.length}):`,
              ``,
            );

            for (const comment of thread.comments) {
              lines.push(
                `---`,
                ``,
                `@${comment.user.login} (${new Date(comment.created_at).toISOString()}):`,
                ``,
                comment.body || "(no body)",
              );
            }
          }
        } else if (type === "pull") {
          const thread = await fetchPRThread(owner, repo, number);
          if (thread) {
            lines.push(
              `---`,
              ``,
              `PR #${thread.number}: ${thread.title}`,
              `State: ${thread.state}`,
              `URL: ${thread.html_url}`,
              ``,
              `Comments (${thread.comments.length + thread.review_comments.length}):`,
              ``,
            );

            for (const comment of thread.comments) {
              lines.push(
                `---`,
                ``,
                `@${comment.user.login} (${new Date(comment.created_at).toISOString()}):`,
                ``,
                comment.body || "(no body)",
              );
            }

            for (const comment of thread.review_comments) {
              lines.push(
                `---`,
                ``,
                `@${comment.user.login} (review comment, ${comment.path}:${comment.line}, ${new Date(comment.created_at).toISOString()}):`,
                ``,
                comment.body || "(no body)",
              );
            }
          }
        }
      }
    }

    lines.push(
      `---`,
      ``,
      `You can reply to this by using the GitHub tool:`,
      `- Comment on issue/PR: gh issue comment <number> <comment>`,
      `- Create issue: gh issue create --repo <repo> --title <title> --body <body>`,
      `- Merge PR: gh pr merge <number>`,
      ``,
      `What would you like to do?`,
    );

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Main polling loop
  // ---------------------------------------------------------------------------

  async function pollGitHubNotifications(): Promise<void> {
    try {
      ctx.log.debug("Polling GitHub notifications...");

      // Fetch notifications since last check
      const notifications = await fetchNotifications(state.lastCheckTimestamp);

      if (notifications.length === 0) {
        ctx.log.debug("No new notifications");
        return;
      }

      ctx.log.info(`Found ${notifications.length} new notifications`);

      // Deduplicate and filter
      const relevant: GitHubNotification[] = [];
      for (const notif of notifications) {
        if (state.seenNotificationIds.has(notif.id)) {
          continue;
        }
        state.seenNotificationIds.add(notif.id);

        const isRelevant = await isNotificationRelevant(notif);
        if (isRelevant) {
          relevant.push(notif);
        }
      }

      ctx.log.info(`${relevant.length} relevant notifications after filtering`);

      // Group by session key
      const grouped = new Map<string, GitHubNotification[]>();
      for (const notif of relevant) {
        const sessionKey = getSessionKey(notif);
        if (!grouped.has(sessionKey)) {
          grouped.set(sessionKey, []);
        }
        grouped.get(sessionKey)!.push(notif);
      }

      // Route each group to agent
      for (const [sessionKey, events] of grouped.entries()) {
        await routeEventGroup(sessionKey, events);
      }

      // Update last check timestamp
      state.lastCheckTimestamp = new Date().toISOString();

    } catch (err) {
      ctx.log.error(`GitHub polling error: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Route grouped events to agent
  // ---------------------------------------------------------------------------

  async function routeEventGroup(
    sessionKey: string,
    events: GitHubNotification[]
  ): Promise<void> {
    const repo = events[0].repository.full_name;
    const agentName = resolveAgent(repo);

    // Build combined context for all events
    const contexts: string[] = [];
    for (const event of events) {
      const context = await buildEventContext(event);
      contexts.push(context);
    }

    const combinedContext = contexts.join("\n\n" + "=".repeat(80) + "\n\n");

    // Check if session is active (steer) or create new
    if (ctx.isSessionActive(sessionKey)) {
      ctx.log.info(`Steering active session: ${sessionKey}`);
      await ctx.steerSession(sessionKey, combinedContext);
    } else {
      ctx.log.info(`Creating new session: ${sessionKey}`);
      await ctx.prompt(sessionKey, agentName, combinedContext);
    }
  }

  // ---------------------------------------------------------------------------
  // Channel adapter (no-op for polling)
  // ---------------------------------------------------------------------------

  const channelAdapter: ChannelAdapter = {
    supportsMessaging(): boolean {
      return false; // Polling doesn't support proactive messaging
    },
    async sendMessage(): Promise<void> {
      throw new Error("GitHub polling channel does not support proactive messaging");
    },
  };

  // ---------------------------------------------------------------------------
  // Plugin instance
  // ---------------------------------------------------------------------------

  return {
    register(reg: PluginRegistrar): void {
      // Register channel adapter
      reg.channel(channelAdapter);
    },

    async start(): Promise<void> {
      if (!cfg.enabled) {
        ctx.log.info("GitHub polling is disabled (enabled: false in config)");
        return;
      }

      ctx.log.info("Starting GitHub polling...");

      const pollInterval = cfg.pollIntervalSeconds * 1000;

      // Start polling loop
      state.timer = setInterval(() => {
        pollGitHubNotifications();
      }, pollInterval);

      ctx.log.info(`GitHub polling started (interval: ${cfg.pollIntervalSeconds}s)`);
      ctx.log.info(`Respond to: ${cfg.respondTo}`);
      ctx.log.info(`Include full thread: ${cfg.includeFullThread}`);
    },

    async stop(): Promise<void> {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      ctx.log.info("GitHub polling stopped");
    },
  };
}
