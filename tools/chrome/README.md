# Chrome Tool

Control a Chrome browser from within Beige agents. Wraps [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) — giving agents full access to navigation, DOM inspection, JavaScript evaluation, screenshots, network monitoring, performance analysis, and more.

Each agent gets its own **persistent Chrome profile** — cookies, logins, and localStorage survive gateway restarts.

## Prerequisites

| Requirement | Details |
|---|---|
| Google Chrome | Installed on the gateway host (stable channel by default) |
| Node.js + `npx` | Required to run `chrome-devtools-mcp` |

## Default Configuration

- All MCP tools are permitted (no allow/deny restrictions)
- Browser launches on first use (lazy start)
- Idle timeout: 30 minutes (auto-closes, respawns on next call)
- Channel: `stable`
- Headless: `false` (visible browser window)
- Google usage statistics: disabled

## Configuration

```json5
tools: {
  chrome: {
    path: "~/.beige/toolkits/beige-toolkit/tools/chrome",
    target: "gateway",
    config: {
      // Launch in slim mode (only navigate/evaluate/screenshot). Default: false.
      slim: false,

      // Run Chrome headlessly. Default: false.
      headless: false,

      // Chrome channel: "stable" | "beta" | "dev" | "canary". Default: "stable".
      channel: "stable",

      // Viewport: "WxH". Default: unset.
      viewport: "1280x720",

      // Kill browser after N minutes idle. Default: 30.
      idleTimeoutMinutes: 30,

      // chrome-devtools-mcp npm version. Default: "latest".
      version: "latest",

      // Only these MCP tool names are callable (omit = allow all).
      allowTools: ["take_snapshot", "navigate_page", "take_screenshot"],

      // These MCP tool names are always blocked (deny beats allow).
      denyTools: ["evaluate_script"],

      // Timeout per MCP call in seconds. Default: 60.
      timeout: 60,

      // Opt out of Google usage statistics. Default: true.
      noUsageStatistics: true,

      // Proxy server. Optional.
      proxyServer: "http://proxy:8080",

      // Accept insecure TLS certs. Default: false.
      acceptInsecureCerts: false,
    },
  },
},
```

### Config Examples

**Read-only browser agent** (can inspect but not interact):
```json5
config: {
  allowTools: ["take_snapshot", "take_screenshot", "list_pages",
               "list_console_messages", "list_network_requests"],
}
```

**Slim headless agent** (minimal token usage, no visible window):
```json5
config: {
  slim: true,
  headless: true,
}
```

**No JavaScript evaluation** (automation without script injection):
```json5
config: {
  denyTools: ["evaluate_script"],
}
```

### Per-Agent Configuration (toolConfigs)

Beige supports per-agent `toolConfigs` overrides that are deep-merged with the top-level tool config. This lets you share one Chrome tool definition but give each agent different capabilities:

```json5
tools: {
  chrome: {
    path: "~/.beige/toolkits/beige-toolkit/tools/chrome",
    target: "gateway",
    config: {
      // Baseline: headless, standard timeout
      headless: true,
      timeout: 60,
    },
  },
},

agents: {
  // QA agent — full browser access, visible window, longer timeout
  qa: {
    tools: ["chrome"],
    toolConfigs: {
      chrome: {
        headless: false,        // override: visible browser for debugging
        timeout: 120,           // override: longer timeout for complex tests
      },
    },
  },

  // Scraper agent — headless (inherits baseline), slim mode, restricted tools
  scraper: {
    tools: ["chrome"],
    toolConfigs: {
      chrome: {
        slim: true,             // added: minimal tool set
        allowTools: ["take_snapshot", "navigate_page", "take_screenshot"],
      },
    },
  },

  // Reporter agent — read-only, no interaction tools
  reporter: {
    tools: ["chrome"],
    toolConfigs: {
      chrome: {
        allowTools: ["take_snapshot", "take_screenshot", "list_pages",
                     "list_console_messages", "list_network_requests"],
        denyTools: ["evaluate_script", "click", "fill", "fill_form"],
      },
    },
  },

  // Default agent — uses baseline config as-is (headless, 60s timeout)
  assistant: {
    tools: ["chrome"],
  },
},
```

> **Note:** `toolConfigs` values are deep-merged with the top-level config. In the example above, the QA agent's effective config is `{ headless: false, timeout: 120 }` — the overrides replace the baseline values, while other baseline settings are preserved.

## Browser Process Lifecycle

- **Lazy start**: Browser only starts on the first tool call.
- **Persistent per agent**: One process per agent, reused across all calls.
- **Idle timeout**: Process killed after `idleTimeoutMinutes` of inactivity (default: 30). Next call respawns it.
- **Crash recovery**: If Chrome crashes, the next call starts a fresh browser automatically.
- **Profile persistence**: `~/.beige/browser-profiles/<agentName>/` is never deleted — logins and storage survive restarts.

## Security Model

| Concern | How it is handled |
|---|---|
| **Per-agent isolation** | Each agent has its own Chrome profile. No cookie or session sharing. |
| **Tool allowlist/denylist** | `allowTools` / `denyTools` restrict callable MCP tools. Deny beats allow. |
| **No default denylist** | All tools permitted by default — access is gated by the agent having `chrome` in its `tools` list. |
| **Profile never auto-deleted** | Delete `~/.beige/browser-profiles/<agentName>/` manually to reset. |
| **Usage statistics** | Disabled by default (`noUsageStatistics: true`). |

## Error Reference

| Error | Cause |
|---|---|
| `agent identity unknown` | `BEIGE_AGENT_NAME` not set — requires beige ≥ 0.1.3 |
| `failed to start chrome-devtools-mcp` | `npx` not found, or Chrome not installed |
| `process exited unexpectedly` | Chrome crashed — next call respawns |
| `Permission denied: tool 'X' is blocked by denyTools` | Tool is in the denylist |
| `Permission denied: tool 'X' is not in allowTools` | allowTools is set and tool not listed |
| `MCP request timed out` | Tool call exceeded `timeout` seconds |

## Implementation Details

- **Target**: Gateway (runs on the host, not in the sandbox)
- **Dependency**: Chrome, Node.js, `npx`
- **Protocol**: MCP (Model Context Protocol) over stdio to `chrome-devtools-mcp`
