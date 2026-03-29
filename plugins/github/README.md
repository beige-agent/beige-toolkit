# GitHub Tool

Interact with GitHub using the [`gh` CLI](https://cli.github.com/). Routes all commands to `gh` running on the gateway host. Repository deletion (`repo delete`) is permanently blocked regardless of configuration.

## Installation

Install this tool individually:

```bash
beige tools install github:matthias-hausberger/beige-toolkit/tools/github
```

Or install all tools from the toolkit:

```bash
beige tools install npm:@matthias-hausberger/beige-toolkit
```

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `token` | *(none)* | GitHub token for authentication. Passed to `gh` via `GH_TOKEN`. Accepts classic personal access tokens (`ghp_…`) and fine-grained PATs (`github_pat_…`). When absent, `gh` uses its locally stored auth. |
| `allowedCommands` | all commands except `api` | Whitelist of top-level `gh` subcommands (e.g. `"repo"`, `"issue"`, `"pr"`). Set explicitly to include `"api"` for raw API access. |
| `deniedCommands` | *(none)* | Blacklist of top-level `gh` subcommands. Always blocked, even if in `allowedCommands`. Deny beats allow. |

All `gh` subcommands are permitted by default **except `api`**, which is excluded because it allows arbitrary HTTP methods and GraphQL mutations. When `allowedCommands` is set explicitly, it fully replaces the default list.

## Authentication

The tool supports two authentication modes:

**Token in config (recommended for multi-agent setups)**

Set `token` in the agent's `pluginConfigs`. The token is forwarded to `gh` via `GH_TOKEN` and takes precedence over any credential stored on the host, so different agents can authenticate as different GitHub identities.

Both token formats work without any special configuration:
- Classic personal access tokens: `ghp_…`
- Fine-grained personal access tokens: `github_pat_…`

```json5
pluginConfigs: {
  github: {
    config: {
      token: "ghp_yourToken",
      allowedCommands: ["repo", "issue", "pr"],
    },
  },
  agents: {
    // Triage bot — issues only, dedicated read-only PAT
    triage: {
      tools: ["github"],
      pluginConfigs: {
        github: {
          token: "ghp_readOnlyTriageToken",
          allowedCommands: ["issue"],
        },
      },
    },

    // DevOps agent — full access including API, own fine-grained PAT
    devops: {
      tools: ["github"],
      pluginConfigs: {
        github: {
          token: "github_pat_11AABBCC_devopsToken",
          allowedCommands: ["repo", "issue", "pr", "release", "run", "api"],
        },
      },
    },

    // Default agent — uses baseline config and host-level gh auth
    assistant: {
      tools: ["github"],
    },
  },
},
```

**Host-level auth (zero config)**

When no `token` is configured, the tool inherits the gateway process's environment and `gh` picks up whatever auth is already present on the host (`~/.config/gh/`, `GITHUB_TOKEN` env var, etc.). Run `gh auth login` on the host once, and all agents without an explicit token will share that credential.

### GitHub Polling Configuration

**IMPORTANT**: GitHub polling is disabled by default. To enable it, you must explicitly set `polling.enabled: true` in your config.

```json5
{
  tools: {
    github: {
      config: {
        // Enable GitHub notification polling (disabled by default)
        polling: {
          enabled: true,
          username: "your-github-username",
          pollIntervalSeconds: 60,
          respondTo: "mentions",  // or "all", or "watched"
          includeFullThread: true,
          agentMapping: {
            default: "assistant",
            "owner/repo1": "specialist-agent",
            "owner/repo2": "devops-agent",
          },
          watchedRepos: ["owner/repo1", "owner/repo2"],
          watchedPrs: [123, 456],  // PR/issue numbers to watch globally
        },
      },
    },
  },
  agents: {
    assistant: {
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
      tools: ["github"],
    },
  },
}
```

#### Polling Modes

| Mode | Description |
|------|-------------|
| `mentions` | Only notifications where you're `@mentioned` or in a team mention, plus requested reviews. Default. |
| `all` | All notifications (mentions, assigned, review requests, comments). |
| `watched` | Only notifications from repositories or PRs/issue numbers in your `watchedRepos` / `watchedPrs` lists. Falls back to `mentions` if no watch lists configured. |

#### Agent Mapping

When a notification arrives for a specific repository or PR, the plugin can route it to a specialist agent:

- If the repo matches an entry in `polling.agentMapping`, that agent receives the notification
- If not found, the `polling.agentMapping.default` agent receives it

## Prerequisites

| Requirement | Details |
|---|---|
| `gh` CLI | Must be installed on the **gateway host** ([install guide](https://cli.github.com/)) |
| Authentication | Either set `token` in config, or run `gh auth login` on the host |

## Bot Commands

Users interact with the tool via the standard `gh` CLI:

| Command | Description |
|---------|-------------|
| `repo list [owner]` | List repositories |
| `repo view <owner/repo>` | View repository details |
| `repo clone <owner/repo> [dir]` | Clone a repository |
| `issue list --repo <owner/repo>` | List issues |
| `issue view <number> --repo <owner/repo>` | View an issue |
| `issue create --repo <owner/repo> --title <title> --body <body>` | Create an issue |
| `pr list --repo <owner/repo>` | List pull requests |
| `pr view <number> --repo <owner/repo>` | View a pull request |
| `pr create --repo <owner/repo> --title <title> --body <body>` | Create a pull request |
| `release list --repo <owner/repo>` | List releases |
| `run list --repo <owner/repo>` | List workflow runs |

---

## GitHub Polling Feature

### Overview

The GitHub plugin includes a **polling channel adapter** that monitors your GitHub notifications and routes relevant events to agents. This enables zero-infrastructure monitoring for GitHub activity.

### What It Does

When enabled, the plugin:

1. **Polls GitHub notifications** every `N` seconds (configurable, default: 60s)
2. **Filters notifications** based on your `respondTo` mode:
   - `mentions`: Only where you're `@mentioned` or team-mentioned, or have a review requested
   - `all`: All notifications (mentions, assignments, comments, PR reviews, etc.)
   - `watched`: Only notifications from repositories or PRs in your watchlists
3. **Routes notifications to agents** via the channel adapter:
   - Routes to the default assistant unless a specific agent is configured
   - Supports per-repository agent routing via `polling.agentMapping`
4. **Creates new sessions** for each notification group
5. **Includes full comment thread** in session context (optional)

### How It Works

```
┌─────────────────────────────────────────────┐
│ GitHub Notifications (every 60s)              │
└─────────────────────────────────────────────┘
                  ↓
         [Polling checks via gh CLI]
                  ↓
┌─────────────────────────────────────────────┐
│    Is this notification relevant?        │
│    ↓                                       │
│    Group by session (repo/PR)         │
│    ↓                                       │
│  ┌────────────────────────────────────┐   │
│  │  Which agent?                     │   │
│  │  ↓ (via agentMapping)            │   │
│  └────────────────────────────────────┘   │
│         ↓                               │
│  ┌────────────────────────────────────┐   │
│  │  Create session / Steer existing   │   │
│  │  ↓                                   │   │
│  └────────────────────────────────────┘   │
│         ↓                               │
│  [Agent receives event]                   │
└─────────────────────────────────────────────┘
```

### Why Use Polling?

- **Zero infrastructure**: No webhooks, no servers to manage
- **Multi-agent routing**: Different agents for different repos/tasks
- **No rate limit concerns**: Uses your existing `gh` auth
- **Proactive monitoring**: Get notified of activity without waiting for user messages
- **Conversation continuity**: All related events in one session with full thread context

### Configuration Reference

| Setting | Type | Default | Description |
|----------|------|-------------|-------------|
| `polling.enabled` | boolean | `false` | Enable/disable polling |
| `polling.username` | string | *(required)* | Your GitHub username for mention detection |
| `polling.pollIntervalSeconds` | number | `60` | How often to check (min: 30, max: 3600) |
| `polling.respondTo` | enum | `"mentions"` | What to respond to: `mentions` | `all` | `watched` |
| `polling.includeFullThread` | boolean | `true` | Include full comment thread in session context |
| `polling.agentMapping.default` | string | `"assistant"` | Default agent for notifications |
| `polling.watchedRepos` | string[] | `[]` | Specific repositories to watch |
| `polling.watchedPrs` | number[] | `[]` | Specific PR/issue numbers to watch |

### Example Configuration

```json5
{
  tools: {
    github: {
      config: {
        polling: {
          enabled: true,
          username: "myusername",
          pollIntervalSeconds: 90,
          respondTo: "all",
          includeFullThread: true,
          agentMapping: {
            default: "assistant",
            "owner/infra": "devops-agent",
            "owner/project": "project-agent",
          },
          watchedRepos: ["owner/infra", "owner/frontend"],
          watchedPrs: [123, 456, 789],
        },
      },
    },
  },
  agents: {
    devops: {
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
      tools: ["github"],
    },
  },
}
```

This configuration will:
- Poll every 90 seconds
- Respond to **all** notifications
- Route infra-related events to the `devops` agent
- Route project-related events to the `project` agent
- Route all other events to the default `assistant`
- Only watch `owner/infra` and `owner/frontend` repositories
- Also watch PR #123, #456, and #789 specifically

### Session Structure

Each notification group (all events for a single repo/PR) gets its own persistent session:

- Session key: `github:<owner>:<repo>:<type>:<number>`
- Context includes:
  - GitHub event type
  - Repository URL
  - Subject title and type
  - Subject URL
  - Notification reason
  - Last updated timestamp
  - Available actions (comment on issue, merge PR, etc.)
  - Full comment thread (if enabled)
- Session survives gateway restarts (persists to disk)
- Multiple threads for different repos run in parallel

## Error Reference

| Error | Cause | Solution |
|-------|--------|-----------|
| `Permission denied: subcommand 'X' is not allowed` | Subcommand blocked by allow/deny config. Add `"api"` to `allowedCommands` for raw API access. |
| `Permission denied: 'repo delete' is permanently blocked` | Repository deletion is always blocked regardless of configuration. |
| Command fails with `gh` error | `gh` is not installed or not authenticated on the gateway host. |
| Polling disabled | Set `polling.enabled: true` in your config. Disabled by default. |

## Implementation Details

- **Target**: Gateway (runs on the host, not in the sandbox)
- **Dependency**: `gh` CLI
- **Stateless**: Each `gh` invocation spawns a fresh `gh` process
- **Token precedence**: `config.token` → `GH_TOKEN` → host `~/.config/gh/`
- **Agent routing**: Per-repository agent mapping with fallback to default
