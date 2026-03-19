# Agent-to-Agent Tool

Invoke another Beige agent (or the same agent as a sub-agent) and hold a multi-turn conversation with it. Each call returns the target agent's full response plus a session key for follow-up turns.

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `targets` | `undefined` (no calls permitted) | Map of callable agent names to their config. Each key is a target agent name; value is an object with optional `maxDepth`. The special key `"SELF"` resolves to the calling agent's own name at runtime. When absent or empty, all calls are rejected. |
| `targets.<name>.maxDepth` | inherits top-level `maxDepth` | Maximum nesting depth for calls to this specific target. Overrides the top-level default when set. |
| `maxDepth` | `1` | Default maximum nesting depth for targets that don't specify their own. `0` = all calls blocked. `1` = agents may call agents, but sub-agents may not call further. |

No calls are permitted until `targets` is explicitly configured — installing the tool changes nothing until you opt in. When any config is provided (even just `maxDepth`), the `targets` map must still be set to allow calls.

## Prerequisites

No external dependencies. The tool uses beige's internal agent manager and session store.

## The `SELF` Keyword

The special target key `"SELF"` resolves to the calling agent's name at runtime, enabling sub-agent patterns without hardcoding agent names:

- When **coder** calls the tool, `"SELF"` → `"coder"`
- When **reviewer** calls the tool, `"SELF"` → `"reviewer"`

This is particularly useful in the top-level config — every agent with this tool gets the ability to create sub-agents of itself.

## Depth Limiting

| `maxDepth` | What is allowed |
|---|---|
| `0` | No agent-to-agent calls at all for this target |
| `1` *(default)* | Agents may call agents; sub-agents may **not** call further agents |
| `2` | Two levels of nesting; agents at depth 2 may not call further agents |

Each target can override the default `maxDepth` independently. For example, you might allow deep nesting for sub-agents (`SELF: { maxDepth: 3 }`) while keeping cross-agent calls shallow.

## Config Examples

**Basic setup** — coder and reviewer can call each other:
```json5
tools: {
  "agent-to-agent": {
    path: "~/.beige/toolkits/beige-toolkit/tools/agent-to-agent",
    target: "gateway",
    config: {
      targets: {
        reviewer: {},
        coder: {},
      },
      maxDepth: 1,
    },
  },
},

agents: {
  coder:    { tools: ["agent-to-agent"] },
  reviewer: { tools: ["agent-to-agent"] },
},
```

**Sub-agent support** — every agent can call itself:
```json5
config: {
  targets: {
    "SELF": { maxDepth: 2 },
    reviewer: {},
  },
},
```

### Per-Agent Configuration (toolConfigs)

Since beige supports per-agent `toolConfigs` overrides (deep-merged with the top-level tool config), different agents can have different target lists:

```json5
tools: {
  "agent-to-agent": {
    path: "~/.beige/toolkits/beige-toolkit/tools/agent-to-agent",
    target: "gateway",
    config: {
      // Baseline: every agent can call itself as a sub-agent
      targets: {
        "SELF": {},
      },
      maxDepth: 1,
    },
  },
},

agents: {
  // coder can additionally call reviewer
  coder: {
    tools: ["agent-to-agent"],
    toolConfigs: {
      "agent-to-agent": {
        targets: {
          reviewer: {},
        },
      },
    },
  },

  // reviewer can additionally call coder, with deeper nesting
  reviewer: {
    tools: ["agent-to-agent"],
    toolConfigs: {
      "agent-to-agent": {
        targets: {
          coder: { maxDepth: 2 },
        },
      },
    },
  },

  // assistant gets only the baseline (SELF sub-agents)
  assistant: {
    tools: ["agent-to-agent"],
  },
},
```

> **Note:** `toolConfigs` values are deep-merged with the top-level config. In the example above, coder's effective targets are `{ "SELF": {}, reviewer: {} }` — the baseline `SELF` entry is preserved and `reviewer` is added.

## Security Model

| Concern | How it is handled |
|---|---|
| **Default deny** | No calls permitted unless `targets` is configured. |
| **Target-level control** | Only explicitly listed targets can be called. |
| **Per-agent overrides** | Use `toolConfigs` to grant different agents different targets. |
| **SELF keyword** | Enables sub-agent patterns; resolves to caller's own name at runtime. |
| **Per-target depth cap** | Each target can have its own `maxDepth` to prevent runaway recursion. |
| **Unknown targets** | Calls to non-existent agents are rejected immediately. |
| **Session integrity** | Resuming a session with a mismatched `--target` is rejected. |

## Error Reference

| Error | Cause |
|---|---|
| `--target <agent> is required` | No `--target` flag provided and `--info` not used |
| `No targets configured` | Config has no `targets` key or it's empty |
| `Target agent 'X' is not in the configured targets` | Target not in the `targets` config (after SELF resolution) |
| `Agent call depth limit reached` | Session is at `maxDepth` for this target |
| `Unknown agent 'X'` | Target not defined in beige config |
| `Session 'X' not found` | `--session` key doesn't exist |
| `Session 'X' belongs to agent 'Y'` | Session was created for a different target |
| `No message provided` | No message text or file given |

## Implementation Details

- **Target**: Gateway (runs on the host, not in the sandbox)
- **No dependencies**: Uses beige's internal agent manager
- **Session persistence**: Sessions persist across gateway restarts in `~/.beige/sessions/`
