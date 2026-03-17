# GitHub Tool

Interact with GitHub using the `gh` CLI. The tool routes all commands to the
[GitHub CLI](https://cli.github.com/) running on the gateway host — no token
configuration is needed inside Beige; authentication is managed by `gh` itself.

## Requirements

- `gh` must be installed on the **gateway host** (not inside the agent sandbox)
- `gh` must be authenticated: run `gh auth login` on the host before starting Beige

## Usage

```sh
/tools/bin/github <subcommand> [args...]
```

Every invocation is forwarded verbatim to `gh`. The full `gh` command surface is available — see `gh help` or the [gh docs](https://cli.github.com/manual/) for all flags.

## Examples

### Repositories

```sh
# List your repositories
/tools/bin/github repo list

# List repos for an org
/tools/bin/github repo list myorg --limit 50

# View a specific repo
/tools/bin/github repo view myorg/myrepo
```

### Issues

```sh
# List open issues
/tools/bin/github issue list --repo myorg/myrepo

# View a specific issue
/tools/bin/github issue view 42 --repo myorg/myrepo

# Create an issue
/tools/bin/github issue create --repo myorg/myrepo \
  --title "Bug: something is broken" \
  --body "Description of the problem"
```

### Pull Requests

```sh
# List open PRs
/tools/bin/github pr list --repo myorg/myrepo

# View a PR
/tools/bin/github pr view 17 --repo myorg/myrepo

# Create a PR
/tools/bin/github pr create --repo myorg/myrepo \
  --title "feat: add new feature" \
  --body "What this PR does"
```

### Releases

```sh
# List releases
/tools/bin/github release list --repo myorg/myrepo

# View a release
/tools/bin/github release view v1.2.0 --repo myorg/myrepo
```

### Workflow Runs

```sh
# List workflow runs
/tools/bin/github run list --repo myorg/myrepo

# View a specific run
/tools/bin/github run view 12345678 --repo myorg/myrepo
```

### Raw API

```sh
# Make a raw GitHub API call
/tools/bin/github api repos/myorg/myrepo

# POST to the API
/tools/bin/github api repos/myorg/myrepo/issues \
  --method POST \
  --field title="My Issue" \
  --field body="Issue body"
```

## Access Control

Restrict which top-level `gh` subcommands an agent may use via the tool's
`config` block in `config.json5`:

| Config field | Type | Default | Description |
|---|---|---|---|
| `allowedCommands` | `string \| string[]` | all commands except `api` | Only these subcommands are permitted. |
| `deniedCommands` | `string \| string[]` | *(none)* | Always blocked. Deny beats allow. |

`api` is excluded from the default set because it allows arbitrary HTTP methods and GraphQL mutations against any GitHub endpoint. To enable it, set it explicitly in `allowedCommands`:

```json5
config: {
  allowedCommands: ["repo", "issue", "pr", "api"],
},
```

**Example — read-only agent** (list and view, no mutations):

```json5
tools: {
  "github-readonly": {
    path: "~/.beige/toolkits/beige-toolkit/tools/github",
    target: "gateway",
    config: {
      allowedCommands: ["repo", "issue", "pr", "release", "run", "api"],
      deniedCommands: [],
    },
  },
},
```

**Example — issue triage bot** (issues only):

```json5
tools: {
  github: {
    path: "~/.beige/toolkits/beige-toolkit/tools/github",
    target: "gateway",
    config: {
      allowedCommands: ["issue"],
    },
  },
},
```

When a denied subcommand is called, the tool exits with code `1` and prints:

```
Permission denied: subcommand 'repo' is not allowed for this agent.
Permitted subcommands: issue, pr
```

## Notes

- The tool inherits the gateway process's environment, so `gh` picks up
  `~/.config/gh/` automatically.
- No GitHub token is stored in Beige config. Authentication lives entirely in `gh`.
- The tool is stateless — each invocation spawns a fresh `gh` process.
- Output format flags (`--json`, `--jq`, `--template`) work as normal.
- Interactive prompts are disabled since stdin is not wired up; always pass
  all required flags explicitly.

## Implementation Details

- **Target**: Gateway (runs on the host, not in the sandbox)
- **Dependency**: `gh` CLI — must be installed on the gateway host
- **Protocol**: Tool launcher calls back to gateway via Unix socket
- **Source**: `tools/github/index.ts`
