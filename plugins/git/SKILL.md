# Git Tool — Usage Guide

Run git commands in your workspace. All commands operate on `/workspace` — the same directory where you read and write files.

## ⚠️ Critical: Path Handling

**The git tool runs on the gateway host, NOT inside your sandbox container.**

Your `/workspace` inside the container is a bind mount of the host's `~/.beige/agents/<name>/workspace/`. The git tool executes on the host with that directory as its working directory.

### ✅ DO: Use Relative Paths (or cd first)

```sh
# From the workspace root, use relative paths:
git status
git add src/foo.ts
git commit -m "feat: add feature"
git -C myrepo status          # ✅ relative path to subdirectory
git log myrepo

# Or cd into the directory first — the tool client captures your cwd:
cd /workspace/myrepo
git status                    # ✅ runs in myrepo on the host
git add .
git push
```

### ❌ DO NOT: Use Absolute Container Paths

```sh
# These will FAIL because /workspace/... doesn't exist on the host:
git status /workspace/myrepo          # ❌ WRONG
git add /workspace/myrepo/src/foo.ts  # ❌ WRONG
git -C /workspace/myrepo status       # ❌ WRONG
```

The host has no `/workspace` directory — that path only exists inside your container.

## ⚠️ Critical: Always Clone with SSH

**Always use SSH URLs for cloning.** The git tool authenticates via a per-agent SSH key. HTTPS URLs will fail unless an explicit HTTPS token is also configured in `auth.token`.

```sh
# ✅ SSH — always works with default config
git clone git@github.com:myorg/myrepo.git

# ❌ HTTPS — fails unless auth.token is configured
git clone https://github.com/myorg/myrepo.git
```

If you accidentally try to clone via HTTPS with SSH-only auth, the tool will block it immediately and show you the correct SSH URL to use instead.

### Working with Subdirectories

```sh
# Clone creates /workspace/myrepo
git clone git@github.com:myorg/myrepo.git myrepo

# Work relative to workspace root:
git -C myrepo status          # ✅ Works
git add myrepo/src/foo.ts     # ✅ Works

# Or cd first:
cd /workspace/myrepo
git status                    # ✅ Works
git add .
git push
```

## Calling Convention

```sh
/tools/bin/git <subcommand> [args...]
```

## Common Workflows

### Clone a repository

```sh
# Clone into a subdirectory (SSH — always use this form)
git clone git@github.com:myorg/myrepo.git myrepo

# Clone into workspace root
git clone git@github.com:myorg/myrepo.git .
```

### Check status and stage files

```sh
git status
git add .
git add src/foo.ts tests/foo.test.ts
```

### Commit

```sh
git commit -m "feat: add new feature"
git commit -m "fix: correct edge case in parser"
```

### Push and pull

```sh
git push origin main
git pull
git pull origin main
```

### Branches

```sh
git checkout -b feat/my-feature
git branch -a
git checkout main
```

### View history and diffs

```sh
git log --oneline
git log --oneline -20
git diff
git diff --staged
git show HEAD
```

### Fetch and rebase

```sh
git fetch origin
git rebase origin/main
```

### Stash

```sh
git stash push
git stash pop
git stash list
```

## Permission Errors

When a subcommand is not permitted:

```
Permission denied: subcommand 'push' is not allowed for this agent.
Permitted subcommands: status, diff, log, fetch, pull
```

When force-push is blocked:

```
Permission denied: force-push is not allowed for this agent.
```

When an HTTPS clone is attempted with SSH-only auth:

```
Auth mismatch: cannot clone 'https://github.com/myorg/myrepo.git' because the
remote uses HTTPS but this agent is configured for SSH authentication only.

Use the SSH URL instead:
  git clone git@github.com:myorg/myrepo.git
```

`git config` is always blocked and cannot be enabled.

## Tips

- Always `git status` before committing to confirm what is staged
- Use `git diff --staged` to review exactly what will be committed
- Paths in git output are relative to `/workspace`
- Each call is stateless — git state (branch, index, stash) persists in `/workspace/.git` or `/workspace/<repo>/.git` between calls
