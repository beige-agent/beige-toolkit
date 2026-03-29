# GitHub Tool

Interact with GitHub using the [`gh` CLI](https://cli.github.com/). Routes all commands to `gh` running on the gateway host. Repository deletion (`repo delete`) is permanently blocked regardless of configuration.

The plugin also includes an optional **polling channel adapter** that monitors GitHub notifications and routes them to agents automatically — no webhooks or extra infrastructure required.

## Installation

Install this tool individually:

```bash
beige tools install github:matthias-hausberger/beige-toolkit/tools/github
```

Or install all tools from the toolkit:

```bash
# From npm
beige tools install npm:@matthias-hausberger/beige-toolkit

# From GitHub
beige tools install github:matthias-hausberger/beige-toolkit
```

## Configuration

### Tool configuration

| Key | Default | Description |
|-----|---------|-------------|
| `token` | *(none)* | GitHub token for authentication. Passed to `gh` via `GH_TOKEN`. Accepts classic PATs (`ghp_…`) and fine-grained PATs (`github_pat_…`). When absent, `gh` uses its locally stored auth. |
| `allowedCommands` | all except `api` | Whitelist of top-level `gh` subcommands (e.g. `"repo"`, `"issue"`, `"pr"`). Set explicitly to include `"api"` for raw API access. |
| `deniedCommands` | *(none)* | Blacklist of top-level `gh` subcommands. Always blocked, even if listed in `allowedCommands`. Deny beats allow. |

All `gh` subcommands are permitted by default **except `api`**, which is excluded because it allows arbitrary HTTP methods and GraphQL mutations. When `allowedCommands` is set explicitly, it fully replaces the default list.

### Polling configuration

Polling is **disabled by default**. It must be explicitly enabled.

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `polling.enabled` | No | `false` | Set to `true` to start the polling loop at gateway startup. |
| `polling.username` | When enabled | `""` | Your GitHub username. Used for mention detection (`@username` in comment bodies). |
| `polling.pollIntervalSeconds` | No | `60` | How often to query the notifications API, in seconds. |
| `polling.respondTo` | No | `"mentions"` | Notification filter mode: `"mentions"`, `"all"`, or `"watched"`. See [Polling modes](#polling-modes) below. |
| `polling.includeFullThread` | No | `true` | When `true`, the full comment thread for the issue or PR is included in the agent's session context. |
| `polling.agentMapping` | When enabled | `{ default: "assistant" }` | Maps repository names (`"owner/repo"`) to agent names. The `default` key is required and serves as the fallback for any repo not explicitly listed. |
| `polling.watchedRepos` | No | `[]` | Repositories to watch when `respondTo` is `"watched"` (e.g. `["owner/repo"]`). |
| `polling.watchedPrs` | No | `[]` | PR or issue numbers to watch globally when `respondTo` is `"watched"` (e.g. `[42, 1337]`). |

#### Polling modes

| Mode | Behaviour |
|------|-----------|
| `"mentions"` | Only notifications where the configured `username` is directly `@mentioned`, team-mentioned, or has a review requested. For issue and PR review comments, the comment body is fetched to verify the mention. |
| `"all"` | All unread GitHub notifications, regardless of reason. |
| `"watched"` | Only notifications for repos listed in `watchedRepos` or PR/issue numbers listed in `watchedPrs`. Falls back to `"mentions"` behaviour when both lists are empty. |

## Prerequisites

| Requirement | Details |
|---|---|
| `gh` CLI | Must be installed on the **gateway host** ([install guide](https://cli.github.com/)). |
| Authentication | Either set `token` in config, or run `gh auth login` on the gateway host. |

## Config Examples

**Minimal — tool only, host-level auth:**
```json5
{
  tools: { github: {} },
  agents: {
    assistant: { tools: ["github"] },
  },
}
```

**Token in config, restricted to specific subcommands:**
```json5
{
  tools: {
    github: {
      config: {
        token: "ghp_yourPersonalAccessToken",
        allowedCommands: ["repo", "issue", "pr", "release", "run"],
      },
    },
  },
}
```

**Polling enabled — responds to mentions, routes by repo:**
```json5
{
  tools: {
    github: {
      config: {
        token: "ghp_yourToken",
        polling: {
          enabled: true,
          username: "your-github-username",
          pollIntervalSeconds: 60,
          respondTo: "mentions",
          includeFullThread: true,
          agentMapping: {
            default: "assistant",
            "myorg/infra": "devops",
            "myorg/frontend": "frontend",
          },
        },
      },
    },
  },
  agents: {
    assistant: { tools: ["github"] },
    devops:    { tools: ["github"] },
    frontend:  { tools: ["github"] },
  },
}
```

**Polling enabled — watch specific repos and PRs only:**
```json5
{
  tools: {
    github: {
      config: {
        polling: {
          enabled: true,
          username: "your-github-username",
          respondTo: "watched",
          watchedRepos: ["myorg/myrepo"],
          watchedPrs: [42, 99],
          agentMapping: { default: "assistant" },
        },
      },
    },
  },
}
```

**Per-agent tokens using `pluginConfigs`:**
```json5
{
  tools: {
    github: {
      config: {
        allowedCommands: ["repo", "issue", "pr"],
      },
    },
  },
  agents: {
    // Read-only triage bot with its own PAT
    triage: {
      tools: ["github"],
      pluginConfigs: {
        github: { token: "ghp_readOnlyToken", allowedCommands: ["issue"] },
      },
    },
    // DevOps agent with a fine-grained PAT and full access
    devops: {
      tools: ["github"],
      pluginConfigs: {
        github: {
          token: "github_pat_11AABBCC_devopsToken",
          allowedCommands: ["repo", "issue", "pr", "release", "run", "api"],
        },
      },
    },
    // Default agent inherits baseline config and host gh auth
    assistant: { tools: ["github"] },
  },
}
```

## How Polling Works

When `polling.enabled` is `true`, the plugin starts a background loop at gateway startup:

1. Every `pollIntervalSeconds` seconds, it calls `gh api notifications` to fetch unread notifications since the last check.
2. Each notification is checked for relevance according to `respondTo`:
   - `"mentions"`: skips notifications unless the `reason` is `mention`, `team_mention`, or `review_requested`. For comment-type subjects it also fetches the comment body and checks for `@username`.
   - `"all"`: all notifications pass.
   - `"watched"`: only notifications from repos in `watchedRepos` or PR/issue numbers in `watchedPrs` pass; falls back to `"mentions"` logic when both lists are empty.
3. Relevant notifications are deduplicated (already-seen IDs are tracked in memory) and grouped by session key (`github:<owner>/<repo>:<issues|pull>/<number>`).
4. For each group:
   - If a session with that key is already active, the notifications are injected via `steerSession`.
   - Otherwise a new session is created via `ctx.prompt`, routed to the agent determined by `agentMapping`.
5. The last-check timestamp advances after each successful poll.

The loop runs entirely on the gateway host using the same `gh` binary as the tool commands.

## Error Reference

| Error | Cause |
|---|---|
| `Permission denied: subcommand 'X' is not allowed` | Subcommand blocked by `allowedCommands` / `deniedCommands` config. |
| `Permission denied: 'repo delete' is permanently blocked` | Repository deletion is hard-blocked and cannot be re-enabled. |
| `gh` error in output | `gh` is not installed or not authenticated on the gateway host. |
| Polling not triggering | `polling.enabled` is not `true`, or `gh` lacks the `notifications` API scope (needs `notifications` OAuth scope or a PAT with `notifications` permission). |

## Implementation Details

- **Target**: Gateway (runs on the host, not in the sandbox).
- **Dependency**: `gh` CLI for all operations, including notification polling.
- **Stateless tool**: Each `github` tool invocation spawns a fresh `gh` process.
- **Token precedence**: `config.token` → `GH_TOKEN` env var → `~/.config/gh/` host auth.
- **Polling state**: Held in memory; resets on gateway restart (last-check timestamp reverts to 5 minutes ago, seen-ID set clears).
- **Session keys**: `github:<owner>/<repo>:<issues|pull>/<number>` — scoped to the specific PR or issue across its full lifetime.
