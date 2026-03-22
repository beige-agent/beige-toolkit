# Git Tool — Usage Guide

Run git commands in your workspace. All commands operate on `/workspace` — the same directory where you read and write files.

## Calling Convention

```sh
/tools/bin/git <subcommand> [args...]
```

## Common Workflows

### Check status and stage files

```sh
/tools/bin/git status
/tools/bin/git add .
/tools/bin/git add src/foo.ts tests/foo.test.ts
```

### Commit

```sh
/tools/bin/git commit -m "feat: add new feature"
/tools/bin/git commit -m "fix: correct edge case in parser"
```

### Push and pull

```sh
/tools/bin/git push origin main
/tools/bin/git pull
/tools/bin/git pull origin main
```

### Clone a repository

```sh
# Clone into /workspace (must be empty or the . form)
/tools/bin/git clone https://github.com/myorg/myrepo.git .

# Clone into a subdirectory
/tools/bin/git clone https://github.com/myorg/myrepo.git myrepo
```

### Branches

```sh
/tools/bin/git checkout -b feat/my-feature
/tools/bin/git branch -a
/tools/bin/git checkout main
```

### View history and diffs

```sh
/tools/bin/git log --oneline
/tools/bin/git log --oneline -20
/tools/bin/git diff
/tools/bin/git diff --staged
/tools/bin/git show HEAD
```

### Fetch and rebase

```sh
/tools/bin/git fetch origin
/tools/bin/git rebase origin/main
```

### Stash

```sh
/tools/bin/git stash push
/tools/bin/git stash pop
/tools/bin/git stash list
```

## Permission Errors

When a subcommand is not permitted:

```
Permission denied: subcommand 'push' is not allowed for this agent.
Permitted subcommands: status, diff, log, fetch, pull
```

Use only the subcommands listed.

When a remote URL is not in the allowed list:

```
Permission denied: remote 'https://github.com/other/repo' does not match any allowed remote pattern.
Allowed patterns: github.com/myorg/*
```

When force-push is blocked:

```
Permission denied: force-push is not allowed for this agent.
```

`git config` is always blocked and cannot be enabled.

## Tips

- Always `git status` before committing to confirm what is staged
- Use `git diff --staged` to review exactly what will be committed
- The tool runs in your workspace directory — paths in git output are relative to `/workspace`
- Each call is stateless — git state (branch, index, stash) persists in `/workspace/.git` between calls
