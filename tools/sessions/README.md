# sessions

Browse and search your own conversation history. An agent can list its past sessions, read full message histories, and search across sessions by pattern.

Access is strictly scoped to the calling agent — an agent cannot read another agent's sessions.

---

## Quick start

```sh
# List your sessions
/tools/bin/sessions list

# Read a full session
/tools/bin/sessions get tui:coder:default

# Search across all your sessions
/tools/bin/sessions grep "auth module"

# Check what you're allowed to do
/tools/bin/sessions list --format json
```

---

## Commands

### `sessions list`

List all sessions for the calling agent, newest first. Tool-initiated sessions (sub-agent calls from `agent-to-agent`) are excluded by default.

```sh
sessions list
sessions list --include-active        # also show the currently running session
sessions list --format json           # machine-readable output
```

**Example output:**

```
3 sessions for agent 'coder':

  tui:coder:default          2026-03-17 22:14  (most recent)
  tui:coder:20260316-183000  2026-03-16 18:30
  tui:coder:20260315-091200  2026-03-15 09:12
```

---

### `sessions get <key>`

Print the full message history of a session. Long sessions (> 50 messages) are truncated to the first 5 and last 5 messages by default.

```sh
sessions get tui:coder:default
sessions get tui:coder:default --all           # show all messages without truncation
sessions get tui:coder:default --format json   # machine-readable output
```

**Example output:**

```
Session: tui:coder:default
Messages: 8

[1] user
  Can you refactor the auth module?

[2] assistant
  Sure. I'll start by reading the current implementation...
  [tool: exec]

[3] tool
  Exit code: 0
  ...
```

Tool calls within assistant messages are shown as `[tool: name]` inline. Tool results appear as separate `tool` role messages.

---

### `sessions grep <pattern>`

Search message content across your sessions. Searches the N most recent sessions (default: 100). Stops after finding M matches (default: 50).

```sh
sessions grep "auth module"
sessions grep /TypeError/                          # regex syntax
sessions grep "refactor" --session tui:coder:s1   # single session only
sessions grep "bug" --max-sessions 20             # search fewer sessions
sessions grep "TODO" --max-matches 100            # collect more matches
sessions grep "deploy" --format json              # machine-readable output
```

**Pattern syntax:**
- Plain string → case-insensitive substring match: `sessions grep "auth module"`
- `/regex/flags` → regular expression: `sessions grep /TypeError/i`

**Example output:**

```
3 matches for 'auth module':

  tui:coder:default  [msg 1]  user: Can you refactor the auth module?
  tui:coder:default  [msg 7]  assistant: The auth module now uses JWT...
  tui:coder:20260316  [msg 3]  user: revisit the auth module structure

(searched 12 of 12 sessions)
```

If the session limit was reached before searching all sessions:

```
(searched 100 of 203 sessions — use --max-sessions to search more)
```

---

## Flags reference

| Flag | Applies to | Default | Description |
|---|---|---|---|
| `--include-active` | `list` | off | Include the currently running session |
| `--all` | `get` | off | Show all messages; disable truncation |
| `--session <key>` | `grep` | — | Search within one session only |
| `--max-sessions <n>` | `grep` | `100` | Maximum sessions to search (newest first) |
| `--max-matches <n>` | `grep` | `50` | Stop after N total matches |
| `--format json` | all | text | Machine-readable JSON output |

---

## Security model

| Concern | How it is handled |
|---|---|
| **Agent scoping** | Every operation is filtered to the calling agent's sessions. The agent name comes from `BEIGE_AGENT_NAME` (injected by beige ≥ 0.1.3). |
| **Ownership check** | Before reading any session file, the tool verifies `sessionStore.getEntry(key).agentName === callerAgent`. A mismatch returns a permission error. |
| **No cross-agent access** | There is no config option to allow reading another agent's sessions. |
| **Read-only** | The tool never writes, modifies, or deletes sessions. |
| **No raw file paths** | File paths are never exposed in output — only session keys and message content. |

---

## JSON output

All commands accept `--format json` for structured output suitable for further processing.

**`sessions list --format json`**
```json
{
  "agentName": "coder",
  "sessions": [
    {
      "index": 1,
      "sessionFile": "...",
      "sessionId": "...",
      "createdAt": "2026-03-17T22:14:00.000Z",
      "firstMessage": "Can you refactor...",
      "active": false
    }
  ]
}
```

**`sessions get <key> --format json`**
```json
{
  "key": "tui:coder:default",
  "agentName": "coder",
  "totalMessages": 8,
  "truncated": false,
  "omitted": 0,
  "messages": [
    { "index": 1, "role": "user", "text": "Can you refactor the auth module?", "timestamp": "..." },
    { "index": 2, "role": "assistant", "text": "Sure. [tool: exec]", "timestamp": "..." }
  ]
}
```

**`sessions grep <pattern> --format json`**
```json
{
  "pattern": "auth module",
  "agentName": "coder",
  "matchCount": 3,
  "matchLimitHit": false,
  "sessionLimitNote": null,
  "matches": [
    { "sessionKey": "tui:coder:default", "messageIndex": 1, "role": "user", "snippet": "...auth module...", "timestamp": "..." }
  ]
}
```

---

## Error reference

| Error | Cause |
|---|---|
| `agent identity unknown` | `BEIGE_AGENT_NAME` not set — requires beige ≥ 0.1.3 |
| `session store unavailable` | Tool not running in gateway context |
| `subcommand required` | No subcommand provided |
| `unknown subcommand 'X'` | First argument is not `list`, `get`, or `grep` |
| `session key required` | `get` called without a key argument |
| `session 'X' not found` | Key not in the session map |
| `Permission denied: session 'X' belongs to agent 'Y'` | Session exists but owned by a different agent |
| `Session file ... no longer exists on disk` | Session was registered but the file was deleted |
| `pattern required` | `grep` called without a pattern |
| `Invalid regex 'X'` | `/pattern/` syntax used but the regex is malformed |
