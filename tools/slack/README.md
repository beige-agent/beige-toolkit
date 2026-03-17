# slack

Interact with Slack workspaces via the [`slackcli`](https://github.com/username/slackcli) binary installed on the gateway host. Agents pass `slackcli` arguments directly; the tool enforces a permission layer before executing anything.

**Requires:** `slackcli` installed and authenticated on the gateway host.

---

## Quick start

```sh
# List your channels and DMs
/tools/bin/slack conversations list

# Read recent messages from a channel
/tools/bin/slack conversations read C1234567890 --limit 20

# Send a message (if permitted)
/tools/bin/slack messages send --recipient-id C1234567890 --message "Deploy complete ✓"

# Add a reaction
/tools/bin/slack messages react --channel-id C1234567890 --timestamp 1234567890.123 --emoji thumbsup

# List authenticated workspaces
/tools/bin/slack auth list
```

---

## Available commands

All `slackcli` subcommands are available subject to the configured allow/deny lists.

### `conversations`

```sh
slack conversations list [--types <types>] [--limit <n>] [--exclude-archived] [--workspace <id>]
slack conversations read <channel-id> [--limit <n>] [--thread-ts <ts>] [--oldest <ts>] [--latest <ts>] [--json] [--workspace <id>]
```

### `messages`

```sh
slack messages send --recipient-id <id> --message <text> [--thread-ts <ts>] [--workspace <id>]
slack messages react --channel-id <id> --timestamp <ts> --emoji <name> [--workspace <id>]
slack messages draft --recipient-id <id> --message <text> [--thread-ts <ts>] [--workspace <id>]
```

### `auth`

```sh
slack auth list
slack auth set-default <workspace-id>
# auth login, auth logout, auth remove — blocked by default denylist
```

Run `slack <subcommand> --help` for full flag reference.

---

## Permission model

Access is controlled at the **command path** level. A command path is the leading 1–2 subcommand tokens before any flags:

| Args | Command path |
|---|---|
| `conversations list --limit 50` | `conversations list` |
| `messages send --recipient-id C1` | `messages send` |
| `messages react ...` | `messages react` |
| `auth login` | `auth login` |

**Matching is by prefix:** `"messages"` in a deny list blocks `messages send`, `messages react`, and `messages draft`. `"messages send"` blocks only send.

**Precedence:** deny beats allow. Checked in order:
1. `denyCommands` — if any entry matches → rejected immediately
2. `allowCommands` — if set and no entry matches → rejected
3. Otherwise → permitted

### Default denylist

When **no config is provided**, a built-in denylist is applied:

```
auth login, auth login-browser, auth logout, auth remove,
auth extract-tokens, auth parse-curl, update
```

These are auth-mutating and update operations that agents should not run autonomously. `messages send` is intentionally **not** in the default denylist — you must explicitly deny it if you don't want agents to send messages.

When **any config is provided** (even just `timeout`), the default denylist is replaced entirely by whatever you configure.

---

## Configuration

```json5
tools: {
  slack: {
    path: "~/.beige/toolkits/beige-toolkit/tools/slack",
    target: "gateway",
    config: {
      // Allow only specific command paths (omit to allow all)
      allowCommands: ["conversations list", "conversations read", "messages react"],

      // Always block these command paths (deny beats allow)
      denyCommands: ["messages send", "messages draft"],

      // Timeout per slackcli call in seconds (default: 30)
      timeout: 30,

      // Default workspace — appended as --workspace when not specified by agent
      workspace: "my-workspace",
    },
  },
},
```

### Config examples

**Read-only agent** (can read everything, cannot send or mutate auth):
```json5
config: {
  denyCommands: ["messages send", "messages draft", "auth login", "auth logout", "update"],
}
```

**Strictly scoped agent** (can only list channels and read history):
```json5
config: {
  allowCommands: ["conversations list", "conversations read"],
}
```

**Notification agent** (can only send messages, nothing else):
```json5
config: {
  allowCommands: ["messages send"],
}
```

**React-only agent** (can only add emoji reactions):
```json5
config: {
  allowCommands: ["messages react"],
}
```

**Full access except sending** (everything allowed except send and draft):
```json5
config: {
  denyCommands: ["messages send", "messages draft"],
}
```

---

## Workspace injection

If `config.workspace` is set, the tool automatically appends `--workspace <value>` to every call when `--workspace` is not already in the agent's args. The agent-provided value takes precedence.

```json5
config: {
  workspace: "acme-corp",
}
```

---

## Error reference

| Error | Cause |
|---|---|
| `slackcli not found on PATH` | Binary not installed or not on gateway's PATH |
| `Permission denied: command 'X' is blocked by denyCommands` | Command matched a deny entry |
| `Permission denied: command 'X' is not in allowCommands` | allowCommands is set and command not listed |
| *(empty output, exit 1)* | slackcli itself returned an error — check stderr in output |
| `(no output)` | slackcli ran successfully but produced no output |
