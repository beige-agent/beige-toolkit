# GitHub Polling Plugin

Poll GitHub notifications for mentions and PR activity via periodic API polling. No webhooks or infrastructure required.

## Overview

The GitHub polling plugin monitors your GitHub notifications and routes relevant events to agents for intelligent response. It uses periodic API polling (similar to Telegram's long-polling approach), making it simple to deploy with zero infrastructure.

## Features

- **Zero infrastructure**: No webhooks, no public endpoints, no Cloudflare Workers needed
- **Periodic polling**: Polls GitHub notifications API every N seconds (default: 60s)
- **Flexible filtering**:
  - `mentions`: Only respond to @mentions and review requests (default)
  - `all`: Respond to all notifications
  - `watched`: Only respond to watched repos/PRs
- **Full thread context**: Include complete comment thread in session context for issues and PRs
- **Watched entities**: Configure specific repos and PRs to monitor
- **Session steering**: Multiple events on same issue/PR are steered together
- **Multi-agent routing**: Route events to different agents based on repo

## Installation

Install this plugin into your beige toolkit:

```bash
cd /path/to/beige-toolkit
pnpm add ./plugins/github-polling
```

## Configuration

### Required Settings

| Setting | Type | Description |
|----------|-------|-------------|
| `enabled` | boolean | Enable GitHub polling. **Default: `false`** (must be explicitly enabled) |
| `username` | string | Your GitHub username (for @mention detection) |
| `agentMapping` | object | Agent routing: `{ default: "agentName", "owner/repo": "otherAgent" }` |

### Optional Settings

| Setting | Type | Default | Description |
|----------|-------|----------|-------------|
| `token` | string | - | GitHub PAT (optional if `gh` is already authenticated on host) |
| `pollIntervalSeconds` | number | `60` | Polling interval in seconds (min: 30, max: 3600) |
| `respondTo` | string | `"mentions"` | What to respond to: `"mentions"`, `"all"`, or `"watched"` |
| `includeFullThread` | boolean | `true` | Include full comment thread in session context |
| `watchedRepos` | string[] | `[]` | Repositories to watch: `["owner/repo", "org/project"]` |
| `watchedPrs` | number[] | `[]` | PR/issue IDs to watch globally: `[123, 456]` |

### Example Configuration

```json5
{
  tools: {
    "github-polling": {
      config: {
        // Enable polling (must be explicitly enabled)
        enabled: true,

        // Your GitHub username
        username: "matthias-hausberger",

        // Polling interval (optional, default: 60 seconds)
        pollIntervalSeconds: 60,

        // What to respond to (optional, default: "mentions")
        respondTo: "mentions",

        // Include full comment thread (optional, default: true)
        includeFullThread: true,

        // Watch specific repos (optional)
        watchedRepos: [
          "matthias-hausberger/beige-toolkit",
          "my-org/my-project"
        ],

        // Watch specific PRs globally (optional)
        watchedPrs: [42, 1337],

        // Agent routing per repo
        agentMapping: {
          default: "assistant",
          "matthias-hausberger/beige-toolkit": "beige-developer",
          "my-org/my-project": "project-bot"
        }
      }
    }
  }
}
```

## Respond To Modes

### `mentions` (Default)

Only respond to:
- Direct @mentions in comments
- Review requests
- Team mentions

Best for: Personal agent that responds when specifically mentioned.

### `all`

Respond to all GitHub notifications including:
- @mentions
- Comments on issues/PRs you're watching
- Assignments
- State changes
- CI/CD status updates

Best for: Highly active agent that participates in all repo activity.

### `watched`

Only respond to notifications from:
- Repositories in `watchedRepos` list
- PRs/issues in `watchedPrs` list

If no watched repos/PRs are configured, falls back to `mentions` mode.

Best for: Monitoring specific repositories or critical PRs.

## Session Context

Each notification creates or steers a session with the following context:

```
GitHub Event: IssueComment

Repository: matthias-hausberger/beige-toolkit
URL: https://github.com/matthias-hausberger/beige-toolkit

Subject: Add GitHub polling plugin
Subject Type: IssueComment
Subject URL: https://api.github.com/repos/...

Notification Reason: mention
Last Updated: 2026-03-28T20:30:00Z

---
Issue #123: Add GitHub polling plugin
State: open
URL: https://github.com/.../issues/123

Comments (3):

---

@alice (2026-03-28T20:00:00Z):

This would be a great feature to add!

---

@bob (2026-03-28T20:15:00Z):

@matthias-hausberger Can you review this proposal?

---

@matthias-hausberger (2026-03-28T20:25:00Z):

Sure, I'll take a look.

---
@charlie (2026-03-28T20:30:00Z):

@matthias-hausberger What do you think about the approach?

---

You can reply to this by using the GitHub tool:
- Comment on issue/PR: gh issue comment <number> <comment>
- Create issue: gh issue create --repo <repo> --title <title> --body <body>
- Merge PR: gh pr merge <number>

What would you like to do?
```

## Session Keys

Sessions are keyed by repository and issue/PR number:

- Issue: `github:owner/repo:issues/123`
- PR: `github:owner/repo:pull/456`

This allows multiple events on the same issue/PR to be steered together, giving the agent full context of the conversation.

## Agent Actions

When an agent receives a GitHub event, it can:

1. **Reply to comments**:
   ```bash
   gh issue comment 123 "Thanks for the feedback! I'll look into it."
   ```

2. **Create issues**:
   ```bash
   gh issue create --repo owner/repo --title "Bug: ..." --body "..."
   ```

3. **Merge PRs**:
   ```bash
   gh pr merge 456 --merge
   ```

4. **Add labels**:
   ```bash
   gh issue edit 123 --add-label "priority-high"
   ```

5. **Close issues**:
   ```bash
   gh issue close 123 --comment "Fixed in PR #456"
   ```

## Rate Limits

GitHub API rate limits:
- **5,000 requests/hour** for authenticated users
- **60 requests/hour** with default 60s polling interval

This leaves plenty of headroom (1.2% of rate limit) for typical usage.

For multiple agents or faster polling, consider:
- Increasing `pollIntervalSeconds` (e.g., 120s or 300s)
- Using a single token shared across agents
- Implementing exponential backoff on errors

## Prerequisites

| Requirement | Details |
|---|---|
| `gh` CLI | Must be installed on the **gateway host** ([install guide](https://cli.github.com/)) |
| Authentication | Either set `token` in config, or run `gh auth login` on the host |

## Examples

### Example 1: Personal Mention Responder

```json5
{
  tools: {
    "github-polling": {
      config: {
        enabled: true,
        username: "matthias-hausberger",
        respondTo: "mentions",
        pollIntervalSeconds: 60,
        agentMapping: {
          default: "assistant"
        }
      }
    }
  }
}
```

Responds only when @mentioned, with 60s polling interval.

### Example 2: Repo-Specific Monitor

```json5
{
  tools: {
    "github-polling": {
      config: {
        enabled: true,
        username: "matthias-hausberger",
        respondTo: "watched",
        watchedRepos: [
          "my-org/important-project"
        ],
        includeFullThread: true,
        agentMapping: {
          default: "assistant",
          "my-org/important-project": "project-bot"
        }
      }
    }
  }
}
```

Monitors a specific repository with a dedicated agent.

### Example 3: Critical PR Watcher

```json5
{
  tools: {
    "github-polling": {
      config: {
        enabled: true,
        username: "matthias-hausberger",
        respondTo: "watched",
        watchedPrs: [42, 1337, 9000],
        pollIntervalSeconds: 30,
        agentMapping: {
          default: "assistant"
        }
      }
    }
  }
}
```

Watches specific PRs with faster 30s polling interval.

## Troubleshooting

### "GitHub polling is disabled"

Add `"enabled": true` to your plugin configuration.

### "Failed to fetch notifications"

1. Ensure `gh` CLI is installed on the gateway host
2. Check GitHub authentication (`gh auth status`)
3. Verify `token` is set if not using host-level auth

### Too many notifications

Adjust the `respondTo` setting:
- Use `"mentions"` instead of `"all"`
- Configure `watchedRepos` to filter to specific repos

### Rate limit errors

Increase `pollIntervalSeconds`:
- From 60s → 120s or 300s
- Reduces API calls by half or more

## Security

- **Token scope**: Use fine-grained PATs with minimal permissions (notifications:read, issues:write, pull_requests:write)
- **No repo deletion**: The GitHub tool permanently blocks `repo delete` commands
- **Audit logging**: All GitHub actions are logged to the gateway

## See Also

- [GitHub Tool](../github/README.md) - Tool for interacting with GitHub repositories
- [Telegram Plugin](../telegram/README.md) - Similar channel adapter pattern (long-polling)
