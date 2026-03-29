# GitHub Tool — Usage Guide

Interact with GitHub using the `gh` CLI. All commands are forwarded verbatim to `gh` running on the gateway host.

## ⚠️ Critical: Path Handling

**The `github` tool runs on the gateway host, NOT inside your sandbox container.**

Your `/workspace` inside the container is a bind mount of the host's `~/.beige/agents/<name>/workspace/`. The `github` tool executes on the host with that directory as its working directory.

This matters for commands like `pr create` that read `.git/config` to discover the repository.

### ✅ DO: `cd` into the repo before running repo-aware commands

```sh
# Clone first (use git clone with SSH — see below)
git clone git@github.com:myorg/myrepo.git myrepo

# Then cd in — the tool client captures your cwd and the gateway uses it:
cd /workspace/myrepo
github pr create --title "..." --body "..."   # ✅ gh runs in myrepo on the host
github pr list                                 # ✅ reads .git/config correctly
```

### ✅ DO: Use `--repo` for operations that don't need a local clone

```sh
github issue list --repo myorg/myrepo
github pr view 42 --repo myorg/myrepo
github pr create --repo myorg/myrepo --title "..." --body "..."
```

### ❌ DON'T: Use absolute container paths

```sh
# These will FAIL because /workspace/... doesn't exist on the gateway host:
github pr create -R /workspace/myrepo   # ❌ WRONG
```

## ⚠️ Critical: `github repo clone` Uses HTTPS by Default

`github repo clone myorg/myrepo` wraps `git clone`. The protocol depends on `gh config get git_protocol` on the gateway host — the default is **HTTPS**, which will fail if the git tool requires SSH.

**Always prefer `git clone` with an SSH URL instead:**

```sh
# ✅ Always reliable
git clone git@github.com:myorg/myrepo.git myrepo

# ⚠️ Only works if gh's git_protocol is set to ssh on the host
github repo clone myorg/myrepo
```

## Calling Convention

```sh
/tools/bin/github <subcommand> [args...]
```

Interactive prompts are disabled — always pass all required flags explicitly.
Output format flags (`--json`, `--jq`, `--template`) work as normal.

## Examples

### Repositories

```sh
# List your repositories
github repo list

# List repos for an org
github repo list myorg --limit 50

# View a specific repo
github repo view myorg/myrepo
```

### Issues

```sh
# List open issues
github issue list --repo myorg/myrepo

# View a specific issue
github issue view 42 --repo myorg/myrepo

# Create an issue
github issue create --repo myorg/myrepo \
  --title "Bug: something is broken" \
  --body "Description of the problem"
```

### Pull Requests

```sh
# List open PRs
github pr list --repo myorg/myrepo

# View a PR
github pr view 17 --repo myorg/myrepo

# Create a PR (from within a cloned repo)
cd /workspace/myrepo
github pr create --title "feat: add new feature" --body "What this PR does"

# Create a PR (explicit repo, no local clone needed)
github pr create --repo myorg/myrepo \
  --title "feat: add new feature" \
  --body "What this PR does"

# Check out a PR locally
github pr checkout 17
```

### Releases

```sh
# List releases
github release list --repo myorg/myrepo
```

### Workflow Runs

```sh
# List workflow runs
github run list --repo myorg/myrepo
```

### Search

```sh
github search repos "beige agent"
github search issues "label:bug" --repo myorg/myrepo
github search prs "is:open review-requested:@me"
github search commits "fix:" --repo myorg/myrepo
```

## Typical Workflow: Create a PR

```sh
# 1. Clone with SSH
git clone git@github.com:myorg/myrepo.git myrepo

# 2. Create a feature branch
cd /workspace/myrepo
git checkout -b feat/my-feature

# 3. Make changes and commit
git add .
git commit -m "feat: implement my feature"

# 4. Push the branch
git push -u origin feat/my-feature

# 5. Open the PR (cwd ensures gh resolves the correct repo)
github pr create --title "feat: implement my feature" --body "Description"
```

## Polling Channel Adapter

When `polling.enabled: true` is set in the plugin config, the GitHub plugin also acts as a **channel adapter**: it polls your GitHub notifications and automatically creates agent sessions for relevant activity. You do not call the tool to use this — it runs automatically in the background.

When the polling adapter routes a notification to you, your session context will contain:

```
GitHub Event: <type>

Repository: owner/repo
URL: https://github.com/owner/repo

Subject: <title>
Subject Type: Issue | PullRequest | PullRequestReviewComment | ...
Subject URL: https://api.github.com/repos/owner/repo/issues/42

Notification Reason: mention | review_requested | team_mention | ...
Last Updated: <timestamp>

---

You can reply to this by using the GitHub tool:
- Comment on issue/PR: github issue comment <number> <comment>
- Create issue: github issue create --repo <repo> --title <title> --body <body>
- Merge PR: github pr merge <number>

What would you like to do?
```

Respond by using the `github` tool to take action — commenting, reviewing, merging, etc.

### Session keys

Polling sessions are keyed as `github:<owner>/<repo>:<issues|pull>/<number>`. Multiple notifications for the same PR or issue are grouped into the same session.

## Permission Errors

```
Permission denied: subcommand 'api' is not allowed for this agent.
Permitted subcommands: repo, issue, pr
```

`repo delete` is permanently blocked and cannot be enabled regardless of configuration.

## Tips

- Always `cd /workspace/myrepo` before `github pr create` — the cwd is how `gh` finds the repo.
- Use `--repo owner/repo` for read-only operations where you don't need a local clone.
- The `api` subcommand is blocked by default — it must be added to `allowedCommands` explicitly.
- For the full `gh` subcommand reference, see the [gh manual](https://cli.github.com/manual/).
