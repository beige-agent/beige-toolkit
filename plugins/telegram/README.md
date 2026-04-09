# Telegram Plugin

Telegram channel and messaging tool for Beige agents.

## What It Provides

- **Channel**: A GrammY-based Telegram bot that routes user messages to agents and supports concurrent sessions per thread
- **Tool**: `telegram` command for agents to send proactive messages, photos, albums, and files

## Configuration

Add to your `config.json5`:

```json5
{
  plugins: {
    telegram: {
      config: {
        token: "${TELEGRAM_BOT_TOKEN}",
        allowedUsers: [123456789],          // Telegram user IDs
        agentMapping: {
          default: "assistant",             // Which agent handles messages
        },
        defaults: {
          verbose: false,                   // Show tool-call notifications
          streaming: true,                  // Stream responses in real-time
        },
        // Optional: absolute host-side path to the agent workspace.
        // Defaults to <beigeDir>/agents/<defaultAgent>/workspace derived from ctx.dataDir.
        // Only needed if your setup places the workspace at a non-standard location.
        // workspaceDir: "/custom/path/to/workspace",
      },
    },
  },
  agents: {
    assistant: {
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
      tools: ["telegram"],                  // Enable the telegram tool
    },
  },
}
```

## Prerequisites

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Get your Telegram user ID (message [@userinfobot](https://t.me/userinfobot))

## Bot Commands

Users interact with the bot via these commands:

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and all available commands |
| `/new` | Start a fresh conversation (old session preserved on disk) |
| `/stop` | Abort the current operation immediately |
| `/compact` | Summarise and compress conversation history to free context tokens |
| `/status` | Show session info: agent, model, context usage, and settings |
| `/agent` | List available agents |
| `/agent <name>` | Switch to a different agent — conversation history preserved |
| `/model` | List available models for the current agent |
| `/model provider/modelId` | Switch to a different model — conversation history preserved |
| `/verbose on\|off` | Toggle tool-call notifications |
| `/v on\|off` | Shorthand for `/verbose` |
| `/streaming on\|off` | Toggle real-time response streaming |
| `/s on\|off` | Shorthand for `/streaming` |

## Switching Agent or Model

Both `/agent` and `/model` change the current session **without losing history**:

- The `.jsonl` conversation file is kept on disk untouched
- Only the in-memory pi session is disposed and recreated
- The next message picks up from the same history with the new agent/model

**`/agent <name>`**  
Switches to a different configured agent. The new agent's system prompt, tools, and skills apply from the next message. Useful for routing the same conversation to a specialist agent mid-task.

```
/agent reviewer    → now handled by the "reviewer" agent
/agent             → list all available agents
```

**`/model provider/modelId`**  
Switches to any model in the current agent's allowed list (primary or fallback). The model must be listed under the agent's `model` or `fallbackModels` config.

```
/model anthropic/claude-opus-4-5    → switch to Opus
/model zai/glm-4.7                  → switch to GLM
/model                              → list available models
```

Both overrides are stored in session metadata and persist across gateway restarts. `/new` clears them (starting fresh resets to the agent's default).

## Message Reactions

The bot reacts to every user message to communicate processing state:

| Reaction | Meaning |
|----------|---------|
| 👀 | Message received — the agent is processing it |
| 🎉 | Processing finished — no more tool calls or LLM turns coming |
| 😢 | Processing failed — an error message follows in the chat |

Reactions are set via the Bot API's `setMessageReaction`. They are silently skipped if the bot lacks reaction permissions in a channel or if the chat type doesn't support them (e.g. some supergroups).

**Steering messages** (sent while the agent is already running) get 👀 but not 🎉 — they don't own the session lifecycle.

## Concurrency & Steering

The plugin is fully non-blocking: the grammY handler returns immediately and sessions run as background tasks. This means:

- **Multiple threads run in parallel** — each chat/thread has its own session and they operate independently, simultaneously
- **Sending a message while the agent is running steers it** — exactly like pressing ESC in the TUI. The new message is injected as a steering interrupt; the agent finishes its current tool call, then processes your message. No need to wait or use `/stop` first
- **`/stop` for hard abort** — immediately aborts the current operation (LLM call + tool loop). The partial response (if any) is sent before the stop confirmation

## `/status` Output

`/status` shows the current model, context window usage, and settings:

```
Session Status

Agent: `assistant`
Chat: `123456789 / Thread: 42`
Model: `claude-sonnet-4-6`

Context
▓▓▓░░░░░░░ 38.5k / 200k (19.3%)

Settings
• Verbose: 🔇 off
• Streaming: ⚡ on
```

## `/compact` — Manual Compaction

Manually compresses the conversation history using an LLM summarisation pass:

- If a session is active when `/compact` is called, it is aborted first (built-in to pi's compaction)
- Works after a gateway restart — the session file is reloaded from disk automatically
- Shows tokens freed and the post-compaction context bar on success

```
✅ Compacted! Previous context: ~38.5k tokens.

Context now: ▓░░░░░░░░░ 4.2k / 200k (2.1%)
```

## Auto-Compaction Notifications

When the agent automatically compacts the context (threshold or overflow recovery), the bot sends a notification:

- `🗜️ Auto-compacting context…` when it starts
- `✅ Context auto-compacted (~Xk tokens).` on success
- For overflow recovery: `✅ Context auto-compacted (~Xk tokens). Retrying your request…`

## Error Handling

LLM errors (invalid API key, rate limits, model unavailable, etc.) are forwarded to the chat with user-friendly messages:

| Error | Message shown |
|-------|--------------|
| Invalid API key / 401 | 🔑 There's an API key issue. Please check the configuration. |
| Rate limited | ⏳ The AI is a bit busy right now. I've automatically switched to a backup model. |
| All models failed | ❌ All AI models failed. Last error: … |
| Context too long | 📏 This conversation is getting too long for the AI's memory. |
| Network issue | 🌐 Network connection issue. Please try again. |

## Inbound Media

When a user sends a photo, video, audio, voice message, or document to the bot, it is automatically downloaded to `<workspaceDir>/media/inbound/` on the host. The agent receives a message like:

```
[Image sent to chat: media/inbound/photo-2026-04-07_12-00-00.jpg]
Caption: look at this
```

The path is workspace-relative so the agent can read it using its standard file tools.

## Tool Usage

Agents can send messages, photos, albums, and files proactively using the `telegram` tool.

### Path Resolution

All file path arguments (for `sendPhoto`, `sendAlbum`, `sendDocument`) are resolved in this order:

1. **`/workspace/…`** — sandbox-relative paths are rebased onto the real host workspace root
2. **Relative paths** (e.g. `media/outbound/report.pdf`) — resolved against the workspace root
3. **Absolute paths** (not under `/workspace`) — used as-is (already a host path)
4. **`http://` / `https://` URLs** — sent directly via URL, no local file I/O

### `sendMessage`

Send a text message to a chat. Messages longer than 4096 characters are automatically split.

```
telegram sendMessage <chatId> <text>
telegram sendMessage <chatId> --thread <threadId> <text>
```

```bash
telegram sendMessage 123456789 Build completed successfully!
telegram sendMessage -1001234567890 --thread 42 Deployment finished.
```

### `sendPhoto`

Send a single raster image (JPEG, PNG, WebP, or GIF). SVG and other vector formats are rejected with a clear error — use `sendDocument` for those instead.

```
telegram sendPhoto <chatId> <photoPath> [caption]
telegram sendPhoto <chatId> --thread <threadId> <photoPath> [caption]
```

```bash
# Workspace-relative path
telegram sendPhoto 123456789 media/outbound/chart.png "Q1 results"

# Sandbox path (automatically remapped to host workspace)
telegram sendPhoto 123456789 /workspace/screenshot.jpg

# Public URL
telegram sendPhoto 123456789 https://example.com/banner.jpg "Check this out"
```

### `sendAlbum`

Send multiple photos as a single **grouped album** (Telegram media group). The user sees a grid/strip of images in one chat message rather than individual messages.

```
telegram sendAlbum <chatId> <path1> <path2> [... pathN] [--caption <text>]
telegram sendAlbum <chatId> --thread <threadId> <path1> <path2> [... pathN] [--caption <text>]
```

- Telegram limits each media group to **2–10 items**. Larger albums are automatically split into consecutive batches of ≤10.
- The `--caption` is applied to the **first photo of the first batch** only (Telegram's restriction).
- All paths follow the same resolution rules as `sendPhoto`. Each file is validated as a raster image before uploading.

```bash
# Simple 3-photo album
telegram sendAlbum 123456789 photo1.jpg photo2.jpg photo3.jpg

# With caption
telegram sendAlbum 123456789 photo1.jpg photo2.jpg photo3.jpg --caption "Holiday snaps 🌴"

# Large album — auto-split into batches of 10
telegram sendAlbum 123456789 p01.jpg p02.jpg p03.jpg p04.jpg p05.jpg p06.jpg p07.jpg p08.jpg p09.jpg p10.jpg p11.jpg p12.jpg

# To a forum thread
telegram sendAlbum -1001234567890 --thread 5 img1.png img2.png --caption "Results"
```

### `sendDocument`

Send any file as a Telegram document attachment (PDF, zip, SVG, spreadsheet, etc.). The file is delivered as-is without Telegram processing it.

```
telegram sendDocument <chatId> <filePath> [caption]
telegram sendDocument <chatId> --thread <threadId> <filePath> [caption]
```

```bash
# Workspace-relative path
telegram sendDocument 123456789 media/outbound/report.pdf "Monthly report"

# Sandbox path
telegram sendDocument 123456789 /workspace/export.zip

# Public URL
telegram sendDocument 123456789 https://example.com/data.csv "Latest dataset"
```

## Session Model

- Each Telegram chat gets a persistent session (survives gateway restarts)
- Forum topics (threads) each get their own independent session
- `/new` starts a fresh session; old conversation is preserved on disk
- Verbose and streaming settings are persisted per-session
- `/compact` and `/status` work even after a gateway restart — sessions are lazily restored from disk on demand
