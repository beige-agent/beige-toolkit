# Websearch Plugin

Multi-provider web search with automatic provider fallback, local content extraction, and AI-optimized output formats.

## Overview

The websearch plugin provides robust web search capabilities with:
- **Multi-provider support**: Tavily, Brave, Exa, WebSearchAPI
- **Provider priority system**: Configure providers in order of preference
- **Automatic fallback**: Try next provider on failure
- **Local content extraction**: Mozilla Readability + Turndown for Markdown
- **AI-optimized output**: JSON with metadata for AI consumption
- **Circuit breaker pattern**: Prevent cascading failures
- **In-memory caching**: Deduplicate identical queries
- **Retry with exponential backoff**: Handle transient errors

## Setup

### Get API Keys

#### Tavily Search (Primary)
1. Visit https://app.tavily.com
2. Create an account
3. Generate an API key from dashboard
4. Set as `TAVILY_API_KEY` environment variable

**Free tier**: 1,000 requests/month
**Features**: AI-optimized search, rich snippets, direct answers, content extraction

#### Brave Search (Primary)
1. Visit https://brave.com/search/api/
2. Create an account and choose a Search plan
3. Generate an API key from dashboard
4. Set as `BRAVE_API_KEY` environment variable

**Free tier**: ~2,000 requests/month
**Features**: Privacy-focused, independent index, no tracking

#### Exa (Optional)
1. Visit https://dashboard.exa.ai
2. Create an account
3. Generate an API key from dashboard
4. Set as `EXA_API_KEY` environment variable

**Free tier**: 1,000 requests/month
**Features**: Semantic/neural search, similar pages, code context, answers

#### WebSearchAPI (Optional)
1. Visit https://websearchapi.ai
2. Create an account
3. Generate an API key from dashboard
4. Set as `WEBSEARCHAPI_KEY` environment variable

**Free tier**: 2,000 requests/month
**Features**: Google-powered search, generous quota, answers

### Configure Plugin

Add to your agent configuration:

```json
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true },
          { "provider": "tavily", "weight": 2, "enabled": true, "apiKey": "TAVILY_API_KEY_2" },
          { "provider": "brave", "weight": 3, "enabled": true },
          { "provider": "exa", "weight": 4, "enabled": false },
          { "provider": "websearchapi", "weight": 5, "enabled": false }
        ],
        "fallbackBehavior": "try-all",
        "maxProvidersToTry": 3,
        "timeoutSeconds": 30
      }
    }
  }
}
```

Or use environment variables (simpler):

```bash
export TAVILY_API_KEY=your_tavily_key
export BRAVE_API_KEY=your_brave_key
# ... others optional
```

## Configuration Options

### Provider Priority System

**`providerPriority`** (Array of ProviderPriority)

Ordered list of providers to try for each search. Lower `weight` = higher priority.

```json
{
  "providerPriority": [
    { "provider": "tavily", "weight": 1, "enabled": true },
    { "provider": "tavily", "weight": 2, "enabled": true, "apiKey": "TAVILY_API_KEY_2" },
    { "provider": "brave", "weight": 3, "enabled": true },
    { "provider": "exa", "weight": 4, "enabled": false },
    { "provider": "websearchapi", "weight": 5, "enabled": false }
  ]
}
```

**Behavior**:
1. Try provider with weight 1 (highest priority)
2. On error/failure, try provider with weight 2
3. Continue until `maxProvidersToTry` reached
4. Return first successful result, or aggregate all failures

**Provider identifiers**:
- `tavily` - Tavily Search (AI-optimized, rich snippets, answers)
- `brave` - Brave Search (privacy-focused, independent index)
- `exa` - Exa (semantic search, similar pages, code)
- `websearchapi` - WebSearchAPI (Google-powered, generous quota)

### Fallback Behavior

**`fallbackBehavior`** ("try-all" | "fail-fast", default: "try-all")

How to handle provider failures:

- **`try-all`**: Continue trying providers until `maxProvidersToTry` exhausted
- **`fail-fast`**: Stop on first error (don't try next provider)

Use `fail-fast` if you want faster responses at the cost of fewer results.

### Result Limits

**`maxResults`** (number, default: 10, min: 1, max: 20)

Maximum number of results to return per provider.

```json
{ "maxResults": 10 }
```

### Caching

**`enableCache`** (boolean, default: true)

Enable in-memory request caching with TTL.

**`cacheTTLSeconds`** (number, default: 300, min: 0)

Cache time-to-live in seconds. Identical queries within this window return cached results.

```json
{
  "enableCache": true,
  "cacheTTLSeconds": 300
}
```

### Content Extraction

**`enableLocalExtraction`** (boolean, default: true)

Use local content extraction (Mozilla Readability) for providers that don't provide built-in extraction.

**`extractionTimeout`** (number, default: 15, min: 1)

Content extraction timeout in seconds.

**`extractionMaxResults`** (number, default: 3, min: 1)

Maximum number of results to extract content from (to avoid hitting rate limits).

```json
{
  "enableLocalExtraction": true,
  "extractionTimeout": 15,
  "extractionMaxResults": 3
}
```

### Output Format

**`defaultFormat`** ("readable" | "json" | "markdown", default: "readable")

Default output format for search results.

- **`readable`**: Human-friendly text with titles, URLs, snippets
- **`json`**: Machine-readable JSON with full metadata
- **`markdown`**: Markdown format with frontmatter for documentation

**`aiOptimized`** (boolean, default: false)

Output optimized for AI consumption (JSON with rich metadata when true).

```json
{
  "defaultFormat": "readable",
  "aiOptimized": false
}
```

### Retry & Timeout

**`timeoutSeconds`** (number, default: 30, min: 1)

Request timeout in seconds for all provider API calls.

**`maxRetries`** (number, default: 3, min: 0)

Maximum retry attempts for failed requests.

**`retryDelayMs`** (number, default: 1000, min: 0)

Delay between retries in milliseconds (exponential backoff: delay * 2^attempt).

```json
{
  "timeoutSeconds": 30,
  "maxRetries": 3,
  "retryDelayMs": 1000
}
```

## Usage

### Basic Search (Priority Order)

```
websearch search "cloudflare workers deployment"
```

Tries providers in priority order (Tavily → Tavily2 → Brave) until first success.

### Search with Specific Provider

```
websearch search "rust ownership" --provider tavily
```

Use a specific provider directly (bypasses priority system).

### Search with Result Limit

```
websearch search "typescript async await" --count 5
```

Limit number of results (1-20).

### Search with Custom Format

```
websearch search "node.js streams" --format json
```

Output format options:
- `--format readable` - Human-friendly text (default)
- `--format json` - Machine-readable JSON with metadata
- `--format markdown` - Markdown with frontmatter

### AI-Generated Direct Answer

```
websearch answer "what is the latest react version?"
```

Returns direct answer with source citations (currently Tavily-only).

### Extract Content from URL

```
websearch extract "https://docs.rust-lang.org/book/ch04-01-what-is-ownership.html"
```

Uses Mozilla Readability + Turndown to extract content as Markdown.

## Command Reference

| Command | Description |
|---------|-------------|
| `search <query>` | Search web (tries providers in priority order) |
| `search <query> --provider <name>` | Use specific provider (tavily, brave, exa, websearchapi) |
| `search <query> --count <n>` | Limit results (1-20, default: 10) |
| `search <query> --format <fmt>` | Output format: readable, json, markdown |
| `answer <query>` | Get AI-generated direct answer with citations (Tavily) |
| `extract <url>` | Extract content from URL (local extraction) |

## Output Formats

### Readable Format (Human-Friendly)

```
🔍 Search: "cloudflare workers deployment" (via Tavily)

✅ Found 5 results

1. Deploying a Cloudflare Worker
   https://developers.cloudflare.com/workers/
   Build serverless applications with Cloudflare Workers...

   Content: [First 500 chars of extracted content...]

2. What are Cloudflare Workers?
   https://www.cloudflare.com/learning/serverless/what-is-cloudflare-workers/
   Cloudflare Workers is a serverless platform...

   Content: [First 500 chars of extracted content...]

---

Provider: Tavily
Results: 5
Query time: 1.2s
Providers tried: 1
```

### JSON Format (Machine-Readable)

```json
{
  "query": "cloudflare workers deployment",
  "provider": "tavily",
  "providerPriority": [
    { "provider": "tavily", "weight": 1, "success": true }
  ],
  "results": [
    {
      "title": "Deploying a Cloudflare Worker",
      "url": "https://developers.cloudflare.com/workers/",
      "snippet": "Build serverless applications...",
      "content": "# Deploying a Worker\n\nFull markdown content...",
      "metadata": {
        "provider": "tavily",
        "age": null,
        "wordCount": 1243
      }
    }
  ],
  "totalResults": 5,
  "queryTime": 1200,
  "providersTried": 1,
  "timestamp": "2026-03-30T12:00:00Z"
}
```

### Markdown Format (Documentation-Ready)

```markdown
---
query: cloudflare workers deployment
provider: tavily
results_count: 5
query_time_ms: 1200
timestamp: 2026-03-30T12:00:00Z
---

# Search Results

## 1. Deploying a Cloudflare Worker

**URL**: https://developers.cloudflare.com/workers/
**Source**: Tavily
**Relevance**: High

```markdown
# Deploying a Worker

## Prerequisites
...

[Full content in markdown]
```

## 2. What are Cloudflare Workers?

**URL**: https://www.cloudflare.com/learning/...
**Source**: Tavily
**Relevance**: Medium

```markdown
Cloudflare Workers is a serverless...
```
```

## Provider Comparison

| Provider | Free Tier | Best For | Answer API | Content API | Unique Features |
|---------|-----------|-----------|-------------|--------------|-----------------|
| **Tavily** | 1,000/month | General-purpose AI search | ✅ Yes | ✅ Yes | Rich snippets, fast, reliable |
| **Brave** | ~2,000/month | Privacy-focused search | ❌ No | ❌ No | Independent index, no tracking |
| **Exa** | 1,000/month | Semantic search, similar pages, code | ✅ Yes | ✅ Yes | Neural search, freshest content |
| **WebSearchAPI** | 2,000/month | Google-powered, official sources | ✅ Yes | ✅ Yes | Generous quota, canonical sources |

## Architecture

### Priority-Based Fallback

```
Query → Provider 1 (weight=1) → Success? → Return Results
                                    ↓ Failure
                            Provider 2 (weight=2) → Success? → Return Results
                                                    ↓ Failure
                                        Provider 3 (weight=3) → ... (continue)
```

### Circuit Breaker Pattern

Each provider has a circuit breaker that:
- Opens after 3 consecutive failures
- Remains open for 1 minute
- Prevents cascading failures
- Resets on success

### Request Deduplication

In-memory cache with TTL:
- Normalizes query (lowercase, trimmed)
- Returns cached results if hit
- Expires after 5 minutes (configurable)
- Reduces API usage and latency

### Content Extraction Pipeline

```
URL → Fetch (browser headers) → HTML → JSDOM → Readability → Turndown → Markdown
```

**Mozilla Readability**: Extracts main article content, removes clutter
**Turndown + GFM**: Converts HTML to clean Markdown with code block support

## Error Handling

### Error Types

| Type | Description | Retryable? |
|-------|-------------|-------------|
| `auth_failed` | API key missing or invalid | No |
| `rate_limited` | Rate limit exceeded | Yes (after delay) |
| `timeout` | Request timeout | Yes |
| `network_error` | Network error | Yes |
| `invalid_response` | Invalid API response | No |
| `no_results` | No results found | No |
| `provider_down` | Provider API is down | Yes |

### Retry Strategy

- Exponential backoff: 1s, 2s, 4s
- Max retries: 3 (configurable)
- Only retry retryable errors
- Circuit breaker prevents retry storms

## Best Practices

### Choose the Right Provider

**Use Tavily for**:
- General-purpose search
- AI-optimized results
- Rich snippets with content extraction
- Direct answers with citations

**Use Brave for**:
- Privacy-focused search
- Independent index (not Google/Bing)
- No tracking or profiling
- High free tier (~2,000/month)

**Use Exa for**:
- Semantic/neural search
- Finding similar pages to a known URL
- Finding code examples and context
- Freshest content

**Use WebSearchAPI for**:
- Google-powered results
- Official/canonical sources
- Generous free tier (2,000/month)
- Backup when other quotas run low

### Optimize for AI Consumption

Use `--format json` or enable `aiOptimized` to get:

```json
{
  "query": "...",
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "content": "...",  // Full extracted content
      "metadata": {
        "provider": "tavily",
        "wordCount": 1243,
        "hasCodeBlocks": true
      }
    }
  ],
  "totalResults": 5,
  "queryTime": 1200,
  "timestamp": "2026-03-30T12:00:00Z"
}
```

This format is ready for:
- Direct LLM consumption
- Structured data parsing
- Metadata for filtering/ranking
- Query performance tracking

### Manage API Usage

**Enable caching** to reduce duplicate queries:
```json
{ "enableCache": true, "cacheTTLSeconds": 300 }
```

**Limit content extraction** to avoid hitting rate limits:
```json
{ "extractionMaxResults": 3 }
```

**Use backup API keys** for high-volume scenarios:
```json
{
  "providerPriority": [
    { "provider": "tavily", "weight": 1, "apiKey": "TAVILY_API_KEY" },
    { "provider": "tavily", "weight": 2, "apiKey": "TAVILY_API_KEY_2" }
  ]
}
```

## API Limits & Costs

| Provider | Free Tier | Paid Rate | Notes |
|---------|-----------|------------|-------|
| Tavily | 1,000/month | ~$5-10/1K | Best general-purpose, rich snippets |
| Brave | ~2,000/month | ~$2-5/1K | Privacy-focused, independent index |
| Exa | 1,000/month | ~$5-10/1K | Semantic search, freshest content |
| WebSearchAPI | 2,000/month | ~$2-5/1K | Google-powered, generous quota |

## Troubleshooting

### No API Key Configured

**Error**: `API key not configured for Tavily. Set TAVILY_API_KEY environment variable.`

**Solution**:
```bash
export TAVILY_API_KEY=your_key
# Or add to plugin config
```

### All Providers Failed

**Error**: `All search providers failed`

**Possible causes**:
1. No API keys configured
2. All API keys are invalid
3. Network connectivity issues
4. All providers are down (unlikely)
5. Rate limits exceeded on all providers

**Solution**:
- Verify API keys are valid
- Check network connectivity
- Verify provider status pages
- Consider reducing `maxProvidersToTry`

### Circuit Breaker Open

**Error**: `Circuit breaker is OPEN for tavily`

**Meaning**: Provider has failed 3 times in quick succession

**Solution**:
- Wait 1 minute for circuit breaker to reset
- Check provider status
- Verify API key validity
- Check for rate limiting

### Content Extraction Timeout

**Error**: `HTTP 408: Request Timeout` or `Could not extract readable content`

**Possible causes**:
1. Slow website
2. Complex page (lots of scripts/ads)
3. Bot protection (Cloudflare, etc.)
4. Website is down

**Solution**:
- Increase `extractionTimeout` (default: 15s)
- Disable local extraction (`enableLocalExtraction: false`)
- Use provider-provided content instead
- Consider curl-impersonate for bot protection

## Examples

### Research a Topic

```bash
# Search with content extraction
websearch search "rust ownership system" --format markdown

# Get AI answer
websearch answer "how does rust ownership work?"

# Extract specific documentation
websearch extract "https://docs.rust-lang.org/book/"
```

### Compare Providers

```bash
# Search with Tavily
websearch search "cloudflare workers" --provider tavily

# Same search with Brave
websearch search "cloudflare workers" --provider brave

# Use AI-optimized JSON for comparison
websearch search "cloudflare workers" --format json > tavily.json
websearch search "cloudflare workers" --provider brave --format json > brave.json

# Compare results
```

### Batch Processing

```bash
#!/bin/bash
# Search multiple queries with different providers
queries=("rust ownership" "typescript generics" "cloudflare workers")

for query in "${queries[@]}"; do
  echo "=== Searching: $query ==="
  websearch search "$query" --format json --provider tavily
done
```

## Integration with AI

### Example: Feed to LLM

```typescript
const { exec } = require('child_process');

async function searchAndAnswer(question: string): Promise<string> {
  // Get search results in AI-optimized format
  const { stdout } = await exec('websearch search "' + question + '" --format json --ai-optimized');

  const data = JSON.parse(stdout);

  // Build context for LLM
  const context = data.results.map(r =>
    `## ${r.title}\n${r.content || r.snippet}\nSource: ${r.url}`
  ).join('\n\n');

  // Feed to your LLM
  const answer = await llm.complete({
    prompt: `Answer this question based on the context:\n\n${context}\n\nQuestion: ${question}`,
    model: 'your-model',
  });

  return answer;
}
```

### Example: Use Multiple Providers

```typescript
// Configure multiple Tavily keys for high-volume
const config = {
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "apiKey": "TAVILY_API_KEY" },
          { "provider": "tavily", "weight": 2, "apiKey": "TAVILY_API_KEY_2" },
          { "provider": "tavily", "weight": 3, "apiKey": "TAVILY_API_KEY_3" }
        ],
        "maxProvidersToTry": 3
      }
    }
  }
};
```

## Future Enhancements

Potential future features:

- [ ] Exa provider implementation
- [ ] WebSearchAPI provider implementation
- [ ] Persistent caching (Redis, file-based)
- [ ] Provider health monitoring dashboard
- [ ] Usage analytics and cost tracking
- [ ] Rate limit awareness per provider
- [ ] Custom ranking algorithms
- [ ] Personalized search (user history, preferences)
- [ ] curl-impersonate integration for bot protection
- [ ] Streaming responses for long queries
- [ ] Parallel provider queries (race fastest response)

## License

MIT

## Contributing

This plugin is part of the beige-toolkit ecosystem. Issues and contributions welcome at:
https://github.com/matthias-hausberger/beige-toolkit/issues
