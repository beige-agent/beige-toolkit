# GitHub Tool — Usage Guide

Interact with GitHub using the `gh` CLI. All commands are forwarded verbatim to `gh` running on the gateway host.

## ⚠️ Critical: Path Handling

**The github tool runs on the gateway host, NOT inside your sandbox container.**

Your `/workspace` inside the container is a bind mount of the host's `~/.beige/agents/<name>/workspace/`. The github tool executes on the host with that directory as its working directory.

This matters for commands like `pr create` that read `.git/config` to discover the repository.

### ✅ DO: cd into the repo before running repo-aware commands

```sh
# Clone first (use git clone with SSH — see below)
git clone git@github.com:myorg/myrepo.git myrepo

# Then cd in — the tool client captures your cwd and the gateway uses it:
cd /workspace/myrepo
github pr create --title "..." --body "..."   # ✅ gh runs in myrepo on the host
github pr list                                 # ✅ reads .git/config correctly
```

### ✅ DO: Use --repo flag for operations that don't need a local clone

```sh
github issue list --repo myorg/myrepo
github pr view 42 --repo myorg/myrepo
github pr create --repo myorg/myrepo --title "..." --body "..."
```

### ❌ DO NOT: Use absolute container paths

```sh
# These will FAIL because /workspace/... doesn't exist on the host:
github pr create -R /workspace/myrepo   # ❌ WRONG
```

## ⚠️ Critical: `github repo clone` Uses HTTPS by Default

`github repo clone myorg/myrepo` is a thin wrapper around `git clone`. The protocol it uses depends on the `git_protocol` setting in gh's config on the gateway host (`gh config get git_protocol`). **The default is HTTPS.**

This means:
- `github repo clone myorg/myrepo` → clones with `https://github.com/myorg/myrepo.git` by default
- This will **fail** if the git tool is configured for SSH-only auth (no HTTPS token)
- The remote in the resulting repo will be HTTPS, so subsequent `git push` will also fail

**Use `git clone` with an SSH URL instead:**

```sh
# ✅ Always reliable — use git clone with SSH
git clone git@github.com:myorg/myrepo.git myrepo

# ⚠️ Only works if gh's git_protocol is set to ssh on the gateway host
github repo clone myorg/myrepo
```

If you need to use `github repo clone` and your gateway has `gh config set git_protocol ssh` configured, it will produce an SSH remote and work correctly. But since you cannot verify or change that config from inside the sandbox, **prefer `git clone git@github.com:...` for predictable behaviour.**

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
github pr create --repo myorg/myrepo --title "feat: add new feature" --body "What this PR does"

# Checkout a PR locally
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

## Typical Workflow: Create a PR

```sh
# 1. Clone with SSH (always — see above)
git clone git@github.com:myorg/myrepo.git myrepo

# 2. Create a branch
cd /workspace/myrepo
git checkout -b feat/my-feature

# 3. Make changes and commit
# ... edit files in /workspace/myrepo/ ...
git add .
git commit -m "feat: implement feature"

# 4. Push the branch
git push -u origin feat/my-feature

# 5. Create the PR (cd ensures gh runs in the right directory)
github pr create --title "feat: implement feature" --body "Description"
```

## Permission Errors

When a subcommand is not permitted:

```
Permission denied: subcommand 'api' is not allowed for this agent.
Permitted subcommands: repo, issue, pr
```

`repo delete` is permanently blocked and cannot be enabled.

## Tips

- Always `cd /workspace/myrepo` before running repo-aware commands like `pr create`
- Use `--repo owner/repo` for operations that don't need a local clone
- The `api` subcommand is blocked by default — request opt-in via `allowedCommands`
- For the full `gh` command reference, see the [gh docs](https://cli.github.com/manual/)
