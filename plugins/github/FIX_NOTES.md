# GitHub Tool PR Creation Issue - Investigation

## Problem Statement

When running `github pr create`, the command fails with:
```
could not determine the current branch: could not determine current branch: failed to run git: fatal: not a git repository (or any of the parent directories): .git
```

## Root Cause Analysis

The `gh pr create` command internally runs `git` commands to:
1. Detect the current branch
2. Read `.git/config` to discover the repository
3. Get the upstream remote

When `gh` is run with a `cwd` parameter that points to a git repository, it should work correctly. However, if the `cwd` is not set correctly, or if `gh` tries to run `git` commands from a different directory, it fails.

## Current Implementation

The GitHub tool sets the `cwd` as:
```typescript
const cwd = sessionContext?.workspaceDir ?? process.cwd();
```

This should work correctly when:
- The agent is in a session (has `sessionContext.workspaceDir`)
- The workspace directory contains a git repository
- The repository is properly cloned and initialized

## Potential Issues

1. **Session context not passed**: When running from command line or tests, `sessionContext` might not have `workspaceDir`
2. **Gateway working directory**: The gateway might be running from a different directory than the agent's workspace
3. **Git tool blocking**: The git tool permanently blocks `git config`, which might interfere with `gh`'s internal git calls

## Solution Options

### Option 1: Improve Error Handling
Add better error messages that guide the user to clone a repo first:
```typescript
if (result.stderr.includes("could not determine the current branch")) {
  return {
    output: `Failed to determine current branch. Please ensure you're in a git repository by running: git clone <url> <directory>`,
    exitCode: result.exitCode,
  };
}
```

### Option 2: Validate Repository Before Running
Before running `gh pr create`, check if `.git` exists in the cwd:
```typescript
if (subcommand === "pr" && rest[0] === "create") {
  if (cwd && !existsSync(joinPath(cwd, ".git"))) {
    return {
      output: `No git repository found in working directory. Please clone a repository first: git clone <url> <directory>`,
      exitCode: 1,
    };
  }
}
```

### Option 3: Add Repository Discovery Helper
Add a command to help users discover the current repository:
```typescript
// Add to commands:
"  github repo               — Show current repository from .git/config",
```

### Option 4: Document Proper Usage
Update documentation to show the correct workflow:
```bash
# 1. Clone the repository
git clone https://github.com/owner/repo.git myrepo

# 2. Make changes and commit
cd myrepo
git add .
git commit -m "feat: add feature"

# 3. Push the branch
git push -u origin feature-branch

# 4. Create the PR
github pr create --title "feat: add feature" --body "Description"
```

## Recommended Solution

**Option 1 + Option 2**: Improve error handling and validate repository before running PR creation.

This provides:
1. Clear error messages
2. Early validation
3. Guidance for users
4. Minimal code changes
