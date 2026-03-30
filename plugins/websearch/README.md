# Websearch Plugin

Multi-provider web search with automatic provider fallback, local content extraction, and AI-optimized output formats.

## Installation

Install this tool individually:

```bash
beige tools install github:matthias-hausberger/beige-toolkit/plugins/websearch
```

Or install all tools:

```bash
# From npm
beige tools install npm:@matthias-hausberger/beige-toolkit

# From GitHub
beige tools install github:matthias-hausberger/beige-toolkit
```

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `providerPriority` | *(see config schema)* | Array of providers with weights (1=highest priority). Supports `tavily`, `brave`, `exa`, `websearchapi`. Multiple instances of same provider allowed (e.g., `tavily1`, `tavily2` for backup keys). |
| `fallbackBehavior` | `try-all` | How to handle provider failures: `"try-all"` continues to next provider, `"fail-fast"` stops on first error. |
| `maxProvidersToTry` | `3` | Maximum number of providers to attempt before giving up. |
| `timeoutSeconds` | `30` | Request timeout in seconds for all provider API calls. |
| `maxResults` | `10` | Default maximum number of results to return per provider (1-20). |
| `enableCache` | `true` | Enable in-memory request caching. |
| `cacheTTLSeconds` | `300` | Cache time-to-live in seconds (default: 5 minutes). |
| `enableLocalExtraction` | `true` | Use local content extraction for providers without built-in content. |
| `extractionTimeout` | `15` | Content extraction timeout in seconds. |
| `extractionMaxResults` | `3` | Maximum number of results to extract content from (to avoid hitting rate limits). |
| `defaultFormat` | `readable` | Default output format: `"readable"`, `"json"`, `"markdown"`. |
| `aiOptimized` | `false` | Output optimized for AI consumption (JSON with rich metadata when `true`). |
| `maxRetries` | `3` | Maximum retry attempts for failed requests. |
| `retryDelayMs` | `1000` | Delay between retries in milliseconds (exponential backoff: delay * 2^attempt). |

## Prerequisites

| Requirement | Details |
|---|---|
| Tavily API key (optional) | Get one at [app.tavily.com](https://app.tavily.com). Free tier covers 1,000 requests/month. |
| Brave API key (optional) | Get one at [brave.com/search/api](https://brave.com/search/api/). Free tier covers ~2,000 queries/month. |
| Exa API key (optional) | Get one at [dashboard.exa.ai](https://dashboard.exa.ai). Free tier covers 1,000 requests/month. |
| WebSearchAPI key (optional) | Get one at [websearchapi.ai](https://websearchapi.ai). Free tier covers 2,000 requests/month. |

## Config Examples

### Basic setup with Tavily and Brave:

```json5
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true },
          { "provider": "brave", "weight": 2, "enabled": true }
        ]
      }
    }
  }
}
```

### High availability with backup keys:

```json5
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true, "apiKey": "TAVILY_API_KEY_1" },
          { "provider": "tavily", "weight": 2, "enabled": true, "apiKey": "TAVILY_API_KEY_2" },
          { "provider": "brave", "weight": 3, "enabled": true }
        ],
        "maxProvidersToTry": 3,
        "fallbackBehavior": "try-all",
        "enableCache": true,
        "cacheTTLSeconds": 300
      }
    }
  }
}
```

### Cost-optimized with longer cache and fewer providers:

```json5
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true }
        ],
        "maxProvidersToTry": 1,
        "fallbackBehavior": "fail-fast",
        "enableCache": true,
        "cacheTTLSeconds": 1800
      }
    }
  }
}
```

### AI-optimized output for direct LLM consumption:

```json5
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true }
        ],
        "enableLocalExtraction": true,
        "defaultFormat": "json",
        "aiOptimized": true,
        "enableCache": true
      }
    }
  }
}
```

## Usage

The websearch plugin provides a `websearch` tool that agents can use to perform web searches.

### Basic search (tries providers in priority order)

```
websearch search <query>
```

### Search with specific provider

```
websearch search <query> --provider tavily
websearch search <query> --provider brave
```

### Limit results

```
websearch search <query> --count 5
```

### Custom output format

```
websearch search <query> --format json
websearch search <query> --format markdown
```

### AI-generated direct answer

```
websearch answer <query>
```

### Extract content from URL

```
websearch extract <url>
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `search <query>` | Search web (tries providers in priority order) |
| `search <query> --provider <name>` | Use specific provider (`tavily`, `brave`, `exa`, `websearchapi`) |
| `search <query> --count <n>` | Limit results (1-20, default: 10) |
| `search <query> --format <fmt>` | Output format: `readable`, `json`, `markdown` |
| `answer <query>` | Get AI-generated direct answer with citations (Tavily) |
| `extract <url>` | Extract content from URL (local extraction) |

## Architecture

Multi-provider search with automatic fallback:

```
Query Request
    ↓
Check Cache (normalized)
    ↓ hit → Return Cached Results
    ↓ miss → Try Provider 1 (weight=1)
    ↓ Success → Return Results
    ↓ Failure (retryable) → Retry with exponential backoff (3x)
    ↓ Failure (non-retryable) or Exhausted Retries
    ↓ Try Provider 2 (weight=2)
    ↓ Success → Return Results
    ↓ Failure → Try Provider 3 (weight=3)
    ↓ Continue until maxProvidersToTry
    ↓ All Failed → Return Aggregate Error
```

Each provider has a circuit breaker that:
- Opens after 3 consecutive failures
- Remains open for 1 minute
- Prevents cascading failures
- Resets on success or after timeout

## Features

- ✅ **Multi-provider support**: Tavily, Brave, Exa (planned), WebSearchAPI (planned)
- ✅ **Provider priority system**: Weight-based priority with automatic fallback
- ✅ **Automatic fallback**: Try next provider on failure (configurable)
- ✅ **Local content extraction**: Mozilla Readability + Turndown for Markdown
- ✅ **Circuit breaker pattern**: Prevent cascading failures
- ✅ **Request deduplication**: In-memory caching with configurable TTL
- ✅ **Retry with exponential backoff**: Handle transient errors gracefully
- ✅ **AI-optimized output**: JSON format with rich metadata for LLM consumption
- ✅ **Multiple output formats**: Human-readable, JSON, Markdown

## Comparison: This Plugin vs Juan's websearch CLI

| Feature | Juan's websearch CLI | This Plugin (Beige) |
|---------|-------------------|-------------|
| **Multi-provider** | ✅ Yes (5 providers) | ⚠️ Yes (2 implemented, 2 planned) |
| **Priority system** | ❌ No (manual `-p` flag) | ✅ Yes (weight-based, automatic) |
| **Automatic fallback** | ❌ No (manual switching) | ✅ Yes (configurable: try-all/fail-fast) |
| **Circuit breaker** | ❌ No | ✅ Yes (per-provider) |
| **Local extraction** | ✅ Yes (Readability) | ✅ Yes (Readability) |
| **Error handling** | ⚠️ Basic | ✅ Advanced (retries, types, health tracking) |
| **Caching** | ❌ No | ✅ Yes (in-memory, TTL) |
| **Deduplication** | ❌ No | ✅ Yes |
| **Retry with backoff** | ❌ No | ✅ Yes (exponential) |
| **AI-optimized output** | ❌ No | ✅ Yes (JSON + metadata) |
| **Provider health tracking** | ❌ No | ✅ Yes (circuit breaker state) |
| **Rate limit awareness** | ❌ No | ✅ Yes (error type detection) |
| **Command-line tool** | ✅ Yes | ❌ No (agent plugin) |
| **Beige integration** | ❌ No | ✅ Native plugin |

**Key advantages over Juan's CLI**:
1. Automatic fallback vs manual provider switching
2. Circuit breaker prevents provider down from causing total failure
3. Caching reduces API costs and improves performance
4. AI-optimized JSON format for direct LLM consumption
5. Better error handling with retry detection
6. Provider health tracking and rate limit awareness
7. Native Beige plugin integration (not CLI subprocess)

## License

MIT
