# GitHub Polling Plugin — Usage Guide

Monitor GitHub notifications for mentions and PR activity via periodic API polling.

## ⚠️ Important: Polling, Not Webhooks

This plugin uses **API polling**, not webhooks:
- No public endpoint needed
- No Cloudflare Workers required
- Similar to Telegram plugin's long-polling approach
- Default polling interval: 60 seconds

## Configuration

### Enable Polling

Polling is **disabled by default**. Add to agent config:

```json5
{
  tools: {
    "github-polling": {
      config: {
        enabled: true,
        username: "your-github-username",
        agentMapping: {
          default: "assistant"
        }
      }
    }
  }
}
```

### Respond To Modes

```json5
{
  "respondTo": "mentions"  // Only @mentions (default)
  // or
  "respondTo": "all"      // All notifications
  // or
  "respondTo": "watched"  // Only watched repos/PRs
}
```

### Polling Interval

```json5
{
  "pollIntervalSeconds": 60   // Default: 60s
  // Minimum: 30s
  // Maximum: 3600s (1 hour)
}
```

### Full Thread Context

```json5
{
  "includeFullThread": true  // Default: true
}
```

When `true`, includes complete comment thread for issues and PRs in session context.

### Watched Repositories

```json5
{
  "watchedRepos": [
    "owner/repo",
    "org/project"
  ]
}
```

### Watched PRs/Issues

```json5
{
  "watchedPrs": [42, 1337, 9000]
}
```

### Agent Routing

```json5
{
  "agentMapping": {
    "default": "assistant",
    "owner/repo": "specialized-agent"
  }
}
```

Different repos can route to different agents.

## Session Context

When a notification arrives, the agent receives:

```
GitHub Event: IssueComment

Repository: owner/repo
URL: https://github.com/owner/repo

Subject: Issue title
Subject Type: IssueComment
Subject URL: https://api.github.com/...

Notification Reason: mention
Last Updated: 2026-03-28T20:30:00Z

---
Issue #123: Issue title
State: open
URL: https://github.com/.../issues/123

Comments (3):

---

@alice (2026-03-28T20:00:00Z):

Comment text...

---

@bob (2026-03-28T20:15:00Z):

@yourname Can you review this?

---

You can reply to this by using the GitHub tool:
- Comment on issue/PR: gh issue comment <number> <comment>
- Create issue: gh issue create --repo <repo> --title <title> --body <body>
- Merge PR: gh pr merge <number>

What would you like to do?
```

## Replying to Notifications

Use the GitHub tool to respond:

```bash
# Comment on issue
gh issue comment 123 "Thanks for the feedback!"

# Comment on PR
gh pr comment 456 "Looks good, but can you update the docs?"

# Create new issue
gh issue create --repo owner/repo --title "Bug found" --body "..."

# Merge PR
gh pr merge 456 --merge

# Add label
gh issue edit 123 --add-label "priority-high"

# Close issue
gh issue close 123 --comment "Fixed in PR #456"
```

## Session Keys

Sessions are keyed as:
- Issue: `github:owner/repo:issues/123`
- PR: `github:owner/repo:pull/456`

Multiple events on same issue/PR steer the same session.

## Rate Limits

- **5,000 requests/hour** (GitHub API)
- **60 requests/hour** with default 60s polling
- **1.2% of rate limit** used by default

For faster polling or multiple agents:
- Increase `pollIntervalSeconds`
- Use shared token across agents

## Troubleshooting

### Polling not starting

Check config has `"enabled": true`:
```json5
{
  "enabled": true  // Must be explicitly enabled
}
```

### Too many notifications

Change `respondTo`:
```json5
{
  "respondTo": "mentions"  // Instead of "all"
}
```

### Rate limit errors

Increase polling interval:
```json5
{
  "pollIntervalSeconds": 120  // Or 300
}
```

### GitHub CLI not found

Install on gateway host:
```bash
# macOS
brew install gh

# Linux
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh

# Authenticate
gh auth login
```

## Best Practices

1. **Start with `respondTo: "mentions"`**: Most conservative mode
2. **Use 60s polling by default**: Good balance of responsiveness and API usage
3. **Enable full thread context**: Helps agent understand conversation context
4. **Route repos to specialized agents**: Different repos, different behaviors
5. **Monitor logs**: Check gateway logs for polling activity and errors

## Examples

### Personal Mention Responder

```json5
{
  tools: {
    "github-polling": {
      config: {
        enabled: true,
        username: "matthias-hausberger",
        respondTo: "mentions",
        pollIntervalSeconds: 60,
        includeFullThread: true,
        agentMapping: {
          default: "assistant"
        }
      }
    }
  }
}
```

### Repo Monitor

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
        agentMapping: {
          default: "assistant",
          "my-org/important-project": "project-bot"
        }
      }
    }
  }
}
```

### Critical PR Watcher

```json5
{
  tools: {
    "github-polling": {
      config: {
        enabled: true,
        username: "matthias-hausberger",
        respondTo: "watched",
        watchedPrs: [42, 1337],
        pollIntervalSeconds: 30,
        agentMapping: {
          default: "assistant"
        }
      }
    }
  }
}
```
