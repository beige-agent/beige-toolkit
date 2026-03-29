/**
 * git tool
 *
 * Runs git commands against the agent's workspace on the gateway host.
 *
 * ── Why gateway-side ─────────────────────────────────────────────────────────
 *
 * The agent's /workspace inside the Docker container is a bind mount of
 * ~/.beige/agents/<name>/workspace/ on the gateway host. Both sides see the
 * same files. Running git on the gateway host means:
 *
 *   1. The SSH private key never needs to enter the container — it lives at
 *      ~/.beige/agents/<name>/ssh/id_ed25519 on the host and is used directly
 *      by the git subprocess spawned by this handler.
 *   2. The agent cannot read the key via exec/cat — the ssh/ directory is
 *      never mounted into the container (only workspace/ and launchers/ are).
 *
 * ── Authentication ───────────────────────────────────────────────────────────
 *
 * Two modes, configured via config.auth.mode:
 *
 *   "ssh" (default)
 *     Uses <agentDir>/ssh/id_ed25519 and <agentDir>/ssh/known_hosts as
 *     defaults. Both can be overridden with sshKeyPath / sshKnownHostsPath
 *     in config — useful for shared deploy keys or non-standard locations.
 *     Provision the per-agent default with:
 *       ssh-keygen -t ed25519 -C "beige-<name>-agent" \
 *         -f ~/.beige/agents/<name>/ssh/id_ed25519 -N ""
 *       ssh-keyscan github.com > ~/.beige/agents/<name>/ssh/known_hosts
 *
 *   "https"
 *     Uses a PAT from config.auth.token. Injects it via a transient
 *     GIT_ASKPASS helper script that is created, used, and deleted within
 *     the single git invocation. No credential store is touched.
 *
 * SSH invocations always set IdentitiesOnly=yes so the gateway operator's
 * own ~/.ssh/ keys and any loaded ssh-agent keys are completely ignored.
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 *
 * Permanently blocked (cannot be enabled by any config):
 *   git config            — prevents SSH command override or identity spoofing
 *   git push --force      — unless allowForcePush: true in config
 *   git push --force-with-lease — same
 *   git filter-branch / git fast-import — history rewriting
 *   git archive --remote  — arbitrary remote read
 *
 * allowedCommands controls the subcommand allowlist (default: safe set).
 * deniedCommands adds extra blocks; deny beats allow.
 *
 * ── Workspace ────────────────────────────────────────────────────────────────
 *
 * Every git invocation is scoped to the agent's workspace via:
 *   git -C <workspaceDir> <subcommand> [args...]
 *
 * workspaceDir comes from sessionContext.workspaceDir injected by the gateway
 * socket server. If absent (e.g. in tests), it falls back to cwd.
 *
 * ── Dependency injection ─────────────────────────────────────────────────────
 *
 * createHandler accepts an optional second argument for testing:
 *   { executor? }
 *
 * The executor replaces the real git spawn. Tests inject a stub.
 */

import { spawn } from "child_process";
import { resolveBin } from "../_shared/resolve-bin.ts";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: string[],
  config?: Record<string, unknown>,
  sessionContext?: SessionContext
) => Promise<{ output: string; exitCode: number }>;

interface SessionContext {
  sessionKey?: string;
  channel?: string;
  agentName?: string;
  agentDir?: string;
  workspaceDir?: string;
  /**
   * Relative working directory from workspace root (e.g. "repos/myrepo").
   * Populated by the tool-client from the container's cwd when the agent
   * invokes git from a subdirectory of /workspace (e.g. via cd+exec).
   */
  cwd?: string;
}

export interface GitAuthConfig {
  /**
   * Authentication mode. Controls which credentials are set for each git
   * invocation. Three options:
   *
   * "ssh" (default)
   *   Uses the per-agent SSH key for all git operations. HTTPS remotes will
   *   fail unless a token is also provided (see below).
   *   If `token` is also set, both SSH and HTTPS credentials are active
   *   simultaneously — git uses whichever matches the remote URL. This is
   *   the recommended configuration when you have repos using both protocols.
   *
   * "https"
   *   Uses a PAT via GIT_ASKPASS for all git operations. SSH remotes will
   *   still work if the gateway operator's ssh-agent is active, but this
   *   tool deliberately blocks that fallback (IdentitiesOnly=yes is not set
   *   in this mode, so system SSH keys may be used).
   *
   * "dual"
   *   Explicitly activates both SSH key and HTTPS token credentials.
   *   Equivalent to setting mode="ssh" with a token — provided for clarity
   *   when you know you have repos using both protocols.
   */
  mode?: "ssh" | "https" | "dual";

  /**
   * Absolute path to SSH private key.
   * Defaults to <agentDir>/ssh/id_ed25519 when not set.
   */
  sshKeyPath?: string;

  /**
   * Absolute path to known_hosts file.
   * Defaults to <agentDir>/ssh/known_hosts when not set.
   */
  sshKnownHostsPath?: string;

  /**
   * HTTPS PAT (Personal Access Token).
   * Used when mode is "https" or "dual".
   * When mode is "ssh" and this is set, dual credentials are activated
   * automatically — no need to change mode explicitly.
   * Can use ${ENV_VAR} for injection by the config system.
   */
  token?: string;

  /**
   * HTTPS username. Defaults to "x-access-token".
   * Can use ${ENV_VAR} for injection.
   */
  user?: string;
}

export interface GitIdentityConfig {
  /** Git author/committer name. Can use ${ENV_VAR} for injection. */
  name?: string;
  /** Git author/committer email. Can use ${ENV_VAR} for injection. */
  email?: string;
}

export interface GitConfig {
  /**
   * Full path to the git binary (e.g. "/opt/homebrew/bin/git").
   * When not set, falls back to "git" (must be on PATH).
   */
  binPath?: string;
  allowedCommands?: string | string[];
  deniedCommands?: string | string[];
  /** Allow --force and --force-with-lease on push. Default: false. */
  allowForcePush?: boolean;
  identity?: GitIdentityConfig;
  auth?: GitAuthConfig;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Executor = (
  args: string[],
  env: Record<string, string>,
  cwd: string
) => Promise<ExecResult>;

export interface GitContext {
  executor?: Executor;
}

// ---------------------------------------------------------------------------
// Default allowed subcommands
// ---------------------------------------------------------------------------

/**
 * Safe default set — covers normal read/write workflow without any destructive
 * or auth-mutating operations.
 *
 * Notably absent: "config", "filter-branch", "fast-import", "archive",
 * "bisect", "gc", "reflog" (mutation), "clean" (destructive).
 */
const DEFAULT_ALLOWED: readonly string[] = [
  "clone",
  "pull",
  "push",
  "fetch",
  "add",
  "commit",
  "status",
  "diff",
  "log",
  "show",
  "checkout",
  "branch",
  "merge",
  "rebase",
  "stash",
  "remote",
  "tag",
  "mv",
  "rm",
  "restore",
  "reset",
  "rev-parse",
  "ls-files",
  "shortlog",
  "worktree",
];

/**
 * Subcommands that are permanently blocked regardless of config.
 * No config option can re-enable these.
 */
const ALWAYS_BLOCKED: readonly string[] = [
  "config",          // could override SSH command, user identity, credential helper
  "filter-branch",   // history rewriting
  "fast-import",     // history rewriting
  "archive",         // --remote flag allows arbitrary remote reads
];

// ---------------------------------------------------------------------------
// Arg helpers
// ---------------------------------------------------------------------------

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Extract the first non-flag token from args — the git subcommand.
 * git accepts global flags before the subcommand (e.g. -C, --no-pager).
 * We skip known global flags and their values to find the real subcommand.
 *
 * Known value-taking global flags: -C, --git-dir, --work-tree, -c,
 * --namespace, --super-prefix, --config-env.
 */
export function extractSubcommand(args: string[]): string | null {
  const valueTaking = new Set(["-C", "--git-dir", "--work-tree", "-c", "--namespace"]);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") return args[i + 1] ?? null;
    if (valueTaking.has(arg)) {
      i += 2; // skip flag and its value
      continue;
    }
    if (arg.startsWith("-")) {
      i++;
      continue;
    }
    return arg;
  }
  return null;
}

/**
 * Check whether args contain a force-push flag.
 */
export function hasForcePushFlag(args: string[]): boolean {
  return args.some(
    (a) =>
      a === "--force" ||
      a === "-f" ||
      a === "--force-with-lease" ||
      a.startsWith("--force-with-lease=")
  );
}

/**
 * Extract the remote URL from clone args.
 *
 * git clone [options] <url> [dir]
 *
 * Handles value-taking flags (--depth, --branch, --origin, etc.) so their
 * values are not mistaken for the URL. The URL is the first positional
 * argument after the "clone" subcommand token and any flags.
 */
export function extractCloneUrl(args: string[]): string | null {
  // Flags that consume the next token as a value
  const valueTakingFlags = new Set([
    "--depth", "--branch", "-b", "--origin", "-o", "--upload-pack", "-u",
    "--reference", "--reference-if-able", "--separate-git-dir",
    "--jobs", "-j", "--filter", "--recurse-submodules",
    "--shallow-since", "--shallow-exclude",
  ]);

  let pastSubcmd = false;
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (!pastSubcmd) {
      pastSubcmd = true; // skip "clone"
      continue;
    }
    if (valueTakingFlags.has(arg)) {
      skipNext = true;
      continue;
    }
    // --flag=value form — skip entirely
    if (arg.startsWith("--") && arg.includes("=")) continue;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auth — build SSH env or HTTPS askpass
// ---------------------------------------------------------------------------

/**
 * Build the GIT_SSH_COMMAND string for SSH authentication.
 * Always sets IdentitiesOnly=yes to prevent fallback to operator's own keys.
 */
function buildSshCommand(keyPath: string, knownHostsPath: string): string {
  return [
    "ssh",
    "-i", keyPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsPath}`,
    "-o", "BatchMode=yes",       // never prompt interactively
    "-o", "PasswordAuthentication=no", // SSH key only, no password fallback
  ].join(" ");
}

/**
 * Write a transient GIT_ASKPASS helper script to a temp file.
 * Returns the path; caller must delete it after the git call.
 *
 * The script echoes the token when git asks for a password.
 * For username, it echoes the user (default: x-access-token).
 */
function writeAskpassScript(token: string, user: string): string {
  const id = randomBytes(8).toString("hex");
  const path = join(tmpdir(), `beige-git-askpass-${id}.sh`);

  const script = [
    "#!/bin/sh",
    // git calls GIT_ASKPASS with the prompt as $1
    // "Username" prompt → echo the user
    // anything else (password prompt) → echo the token
    `case "$1" in`,
    `  Username*) echo ${JSON.stringify(user)} ;;`,
    `  *)         echo ${JSON.stringify(token)} ;;`,
    `esac`,
    "",
  ].join("\n");

  writeFileSync(path, script, { mode: 0o700 });
  return path;
}

interface AuthEnv {
  env: Record<string, string>;
  /** Cleanup function — removes any temp files written for this invocation. */
  cleanup: () => void;
}

/**
 * Build the env additions and cleanup function for the configured auth mode.
 * Returns an object with env vars to merge into the git subprocess env and
 * a cleanup() to call after the process exits.
 */
export function buildAuthEnv(
  config: GitConfig,
  sessionContext: SessionContext
): AuthEnv {
  const auth = config.auth ?? {};
  const mode = auth.mode ?? "ssh";

  // Determine which credential types to activate.
  // "dual" mode, or "ssh" mode with a token present, both activate dual credentials.
  const wantSsh  = mode === "ssh" || mode === "dual";
  const wantHttps = mode === "https" || mode === "dual" || (mode === "ssh" && !!auth.token);

  const env: Record<string, string> = {};
  const cleanupFns: Array<() => void> = [];

  // ── HTTPS credentials ─────────────────────────────────────────────────────
  if (wantHttps) {
    const token = auth.token ?? "";
    const user = auth.user ?? "x-access-token";

    if (!token) {
      if (mode === "https" || mode === "dual") {
        console.warn(
          `[git tool] ${mode} mode: token is not configured. ` +
          `Push/clone to HTTPS remotes will fail.`
        );
      }
    } else {
      const askpassPath = writeAskpassScript(token, user);
      env.GIT_ASKPASS = askpassPath;
      cleanupFns.push(() => {
        try { unlinkSync(askpassPath); } catch { /* already gone */ }
      });
    }
  }

  // ── SSH credentials ───────────────────────────────────────────────────────
  if (wantSsh) {
    const agentDir = sessionContext.agentDir;
    if (!agentDir && (!auth.sshKeyPath || !auth.sshKnownHostsPath)) {
      console.warn(
        "[git tool] SSH mode: sessionContext.agentDir is not set and no explicit " +
        "sshKeyPath/sshKnownHostsPath configured. " +
        "This usually means the tool is being called outside a normal agent session. " +
        "SSH authentication will fail."
      );
    }

    const sshDir = agentDir ? join(agentDir, "ssh") : "";
    const keyPath = auth.sshKeyPath
      ? resolve(auth.sshKeyPath)
      : join(sshDir, "id_ed25519");
    const knownHostsPath = auth.sshKnownHostsPath
      ? resolve(auth.sshKnownHostsPath)
      : join(sshDir, "known_hosts");

    env.GIT_SSH_COMMAND = buildSshCommand(keyPath, knownHostsPath);
  }

  env.GIT_TERMINAL_PROMPT = "0";

  return {
    env,
    cleanup: () => { for (const fn of cleanupFns) fn(); },
  };
}

// ---------------------------------------------------------------------------
// Identity env
// ---------------------------------------------------------------------------

export function buildIdentityEnv(identity: GitIdentityConfig | undefined): Record<string, string> {
  if (!identity) return {};

  const env: Record<string, string> = {};

  if (identity.name) {
    env.GIT_AUTHOR_NAME = identity.name;
    env.GIT_COMMITTER_NAME = identity.name;
  }
  if (identity.email) {
    env.GIT_AUTHOR_EMAIL = identity.email;
    env.GIT_COMMITTER_EMAIL = identity.email;
  }

  return env;
}

// ---------------------------------------------------------------------------
// Real executor
// ---------------------------------------------------------------------------

/**
 * Resolve the full path to the git binary.
 *
 * Priority:
 *   1. Explicit binPath from config
 *   2. Auto-detect via resolveBin() (which → common paths → bare name)
 */
function resolveGitBin(config: GitConfig): string {
  const raw = config as Record<string, unknown>;
  if (typeof raw.binPath === "string" && raw.binPath.trim()) {
    return raw.binPath.trim();
  }
  return resolveBin("git");
}

export const createExecutor = (bin: string): Executor => (args, env, cwd) =>
  new Promise((resolve_) => {
    // Merge with a clean env: inherit PATH and locale vars from the gateway
    // process but do NOT pass through SSH_AUTH_SOCK, SSH_AGENT_PID, or any
    // credential-related vars. Explicitly add the auth env we computed.
    const cleanEnv: Record<string, string> = {};

    // Passthrough: only what git actually needs from the host env
    const passthrough = [
      "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP",
      "LANG", "LC_ALL", "LC_CTYPE", "TERM",
    ];
    for (const key of passthrough) {
      const val = process.env[key];
      if (val !== undefined) cleanEnv[key] = val;
    }

    // Explicitly block SSH agent and credential passthrough
    // (these are NOT in our passthrough list, so they won't appear — but
    // be explicit for documentation purposes and defence in depth)
    delete cleanEnv.SSH_AUTH_SOCK;
    delete cleanEnv.SSH_AGENT_PID;
    delete cleanEnv.GIT_SSH_COMMAND; // we set our own below
    delete cleanEnv.GIT_ASKPASS;     // we set our own below

    // Prevent git from reading the operator's system or global git config
    // (~/.gitconfig). Without this, git finds the gateway operator's
    // credential helper (e.g. macOS Keychain) via HOME and silently
    // authenticates as the operator instead of the configured agent identity.
    // GIT_CONFIG_NOSYSTEM suppresses /etc/gitconfig; GIT_CONFIG_GLOBAL
    // (git ≥ 2.32) redirects the per-user config to /dev/null.
    cleanEnv.GIT_CONFIG_NOSYSTEM = "1";
    cleanEnv.GIT_CONFIG_GLOBAL = "/dev/null";

    // Apply our computed auth/identity env on top
    Object.assign(cleanEnv, env);

    // Disable git's interactive prompts globally
    cleanEnv.GIT_TERMINAL_PROMPT = cleanEnv.GIT_TERMINAL_PROMPT ?? "0";

    const proc = spawn(bin, args, {
      env: cleanEnv,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      resolve_({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve_({
        stdout: "",
        stderr: `Failed to spawn git (${bin}): ${err.message}. Is git installed on the gateway host? If git is not on PATH, set binPath in the git tool config (e.g. binPath: "/opt/homebrew/bin/git").`,
        exitCode: 1,
      });
    });
  });

/** Default executor using bare "git" — for backward compatibility. */
export const defaultExecutor: Executor = createExecutor("git");

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

function usageText(allowedCmds: Set<string>): string {
  const permitted = allowedCmds.size > 0
    ? [...allowedCmds].join(", ")
    : "(none)";
  return [
    "Usage: git <subcommand> [args...]",
    "",
    "Runs git in the agent's workspace on the gateway host.",
    "",
    "Examples:",
    "  git status",
    "  git add .",
    "  git commit -m 'feat: add feature'",
    "  git push origin main",
    "  git pull",
    "  git log --oneline",
    "",
    `Permitted subcommands: ${permitted}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// createHandler
// ---------------------------------------------------------------------------

export function createHandler(
  rawConfig: Record<string, unknown>,
  context: GitContext = {}
): ToolHandler {
  const config = rawConfig as GitConfig;
  const executor = context.executor ?? createExecutor(resolveGitBin(config));

  // Resolve allowed set once at startup
  const allowedSet = new Set<string>(
    config.allowedCommands !== undefined
      ? toArray(config.allowedCommands)
      : DEFAULT_ALLOWED
  );
  for (const cmd of toArray(config.deniedCommands)) {
    allowedSet.delete(cmd);
  }
  // Always blocked — remove even if someone put them in allowedCommands
  for (const cmd of ALWAYS_BLOCKED) {
    allowedSet.delete(cmd);
  }

  const allowForcePush = config.allowForcePush ?? false;
  const identityConfig = config.identity;

  return async (
    args: string[],
    _toolConfig?: Record<string, unknown>,
    sessionContext?: SessionContext
  ): Promise<{ output: string; exitCode: number }> => {
    // ── No args ─────────────────────────────────────────────────────────────
    if (args.length === 0) {
      return { output: usageText(allowedSet), exitCode: 1 };
    }

    // ── Extract subcommand ───────────────────────────────────────────────────
    const subcommand = extractSubcommand(args);

    if (!subcommand) {
      return { output: usageText(allowedSet), exitCode: 1 };
    }

    // ── Always-blocked check ─────────────────────────────────────────────────
    if (ALWAYS_BLOCKED.includes(subcommand)) {
      return {
        output: `Permission denied: 'git ${subcommand}' is permanently blocked. ` +
          `This subcommand cannot be enabled through configuration.`,
        exitCode: 1,
      };
    }

    // ── Allowlist check ──────────────────────────────────────────────────────
    if (!allowedSet.has(subcommand)) {
      const permitted = [...allowedSet].join(", ") || "(none)";
      return {
        output: `Permission denied: subcommand '${subcommand}' is not allowed for this agent.\n` +
          `Permitted subcommands: ${permitted}`,
        exitCode: 1,
      };
    }

    // ── Force-push check ─────────────────────────────────────────────────────
    if (subcommand === "push" && hasForcePushFlag(args) && !allowForcePush) {
      return {
        output: "Permission denied: force-push is not allowed for this agent.\n" +
          "Set allowForcePush: true in the git tool config to enable it.",
        exitCode: 1,
      };
    }

    // ── Clone protocol/auth mismatch check ──────────────────────────────────
    if (subcommand === "clone") {
      const url = extractCloneUrl(args);

      // Protocol/auth mismatch check: if the URL is HTTPS but the configured
      // auth mode has no HTTPS token, the clone will fail with a confusing
      // "terminal prompts disabled" error. Catch it here and give a clear
      // message — including the equivalent SSH URL the agent should use instead.
      if (url) {
        const isHttps = url.startsWith("https://") || url.startsWith("http://");
        const authMode = config.auth?.mode ?? "ssh";
        const hasToken = !!config.auth?.token;
        const httpsWillWork = authMode === "https" || authMode === "dual" || (authMode === "ssh" && hasToken);

        if (isHttps && !httpsWillWork) {
          // Attempt to suggest an SSH equivalent for github.com URLs.
          const sshUrl = url.replace(/^https:\/\/github\.com\//, "git@github.com:");
          const hasSshSuggestion = sshUrl !== url; // only if the replacement actually changed it
          return {
            output:
              `Auth mismatch: cannot clone '${url}' because the remote uses HTTPS ` +
              `but this agent is configured for SSH authentication only (no HTTPS token is set).\n\n` +
              (hasSshSuggestion
                ? `Use the SSH URL instead:\n  git clone ${sshUrl}\n\n`
                : "") +
              `Or configure HTTPS authentication by setting auth.mode = "https" (or "dual") ` +
              `and providing a token in the git tool config.`,
            exitCode: 1,
          };
        }
      }
    }

    // ── Resolve working directory ────────────────────────────────────────────
    // The workspace dir on the gateway host is the same directory that is
    // mounted at /workspace inside the container.
    //
    // If the agent invoked git from a subdirectory of /workspace (e.g. via
    // `cd /workspace/myrepo && git status`), the tool-client captures the
    // container's cwd as a relative path ("myrepo") and the gateway puts it
    // in sessionContext.cwd. We join it with workspaceDir so that git runs
    // in the correct subdirectory on the host — this is essential for agents
    // that clone repos into the workspace and then operate inside them.
    const workspaceRoot = sessionContext?.workspaceDir ?? process.cwd();
    const cwd = sessionContext?.cwd
      ? join(workspaceRoot, sessionContext.cwd)
      : workspaceRoot;

    // ── Auth mode / remote protocol sanity check ─────────────────────────────
    // When the repository has an HTTPS remote but the tool has no HTTPS token
    // configured, push/fetch/pull will fail with a confusing "terminal prompts
    // disabled" error. Detect this upfront and produce a clear, actionable error.
    // Skip the check entirely if HTTPS credentials will be available (mode is
    // "https", "dual", or "ssh" with a token set).
    if (subcommand === "push" || subcommand === "fetch" || subcommand === "pull") {
      const authMode = config.auth?.mode ?? "ssh";
      const hasToken = !!config.auth?.token;
      const httpsWillWork = authMode === "https" || authMode === "dual" || (authMode === "ssh" && hasToken);

      if (!httpsWillWork) {
        // Extract the remote name from the args: first non-flag positional after
        // the subcommand, defaulting to "origin".
        const positionals = args.filter((a) => !a.startsWith("-"));
        // positionals[0] is the subcommand itself; [1] is the remote name if given.
        const remoteName = positionals[1] ?? "origin";
        const remoteUrlResult = await executor(
          ["remote", "get-url", remoteName],
          { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
          cwd
        );
        if (remoteUrlResult.exitCode === 0) {
          const remoteUrl = remoteUrlResult.stdout.trim();
          if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
            const sshUrl = remoteUrl.replace(/^https:\/\/github\.com\//, "git@github.com:");
            const hasSshSuggestion = sshUrl !== remoteUrl;
            return {
              output:
                `Auth mismatch: the remote '${remoteName}' uses an HTTPS URL (${remoteUrl}) ` +
                `but this agent has no HTTPS token configured.\n\n` +
                (hasSshSuggestion
                  ? `To fix this, switch the remote to SSH:\n  git remote set-url ${remoteName} ${sshUrl}\n\n`
                  : "") +
                `Or configure HTTPS authentication by setting auth.mode = "https" (or "dual") ` +
                `and providing a token in the git tool config.`,
              exitCode: 1,
            };
          }
        }
      }
    }

    // ── Build auth env ───────────────────────────────────────────────────────
    const { env: authEnv, cleanup } = buildAuthEnv(config, sessionContext ?? {});

    // ── Build ceiling env ────────────────────────────────────────────────────
    // Prevent git from traversing up past the workspace into a parent git
    // repository (e.g. when the workspace lives inside a pnpm monorepo or
    // any other git-tracked parent directory on the gateway host).
    // GIT_CEILING_DIRECTORIES tells git to stop its .git search at or above
    // the listed paths, so only repos rooted inside the workspace are found.
    const ceilingEnv: Record<string, string> = {
      GIT_CEILING_DIRECTORIES: cwd,
    };

    // ── Build identity env ───────────────────────────────────────────────────
    const identityEnv = buildIdentityEnv(identityConfig);

    // ── Merge all env additions ──────────────────────────────────────────────
    const env = { ...authEnv, ...identityEnv, ...ceilingEnv };

    // ── Execute ──────────────────────────────────────────────────────────────
    let result: ExecResult;
    try {
      result = await executor(args, env, cwd);
    } finally {
      cleanup();
    }

    if (result.exitCode === 0) {
      const out = [result.stdout, result.stderr].filter((s) => s.trim()).join("\n");
      return { output: out || "(no output)", exitCode: 0 };
    }

    const out = [result.stdout, result.stderr].filter((s) => s.trim()).join("\n");
    return {
      output: out || `git exited with code ${result.exitCode}`,
      exitCode: result.exitCode,
    };
  };
}

// ── Plugin adapter ───────────────────────────────────────────────────────────
// Wraps the legacy createHandler as a plugin for the v2 plugin system.

import type {
  PluginInstance,
  PluginContext,
  PluginRegistrar,
} from "@matthias-hausberger/beige";
import { readFileSync } from "fs";
import { join as joinPath } from "path";

export function createPlugin(
  config: Record<string, unknown>,
  _ctx: PluginContext
): PluginInstance {
  const manifestPath = joinPath(import.meta.dirname!, "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const handler = createHandler(config);

  return {
    register(reg: PluginRegistrar): void {
      reg.tool({
        name: manifest.name,
        description: manifest.description,
        commands: manifest.commands,
        handler,
      });
    },
  };
}
