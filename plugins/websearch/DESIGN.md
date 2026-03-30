# Websearch Plugin Design for Beige Toolkit

**Date**: 2026-03-30
**Requirements**: Multi-provider web search with content extraction, provider priority, and robust error handling

## Requirements

From user (Matthias):

1. ✅ **AT LEAST as good as OpenCode "web fetch" ability**
2. ✅ **Include Brave Search**
3. ✅ **Include Tavily Search**
4. ✅ **Easily search online**
5. ✅ **Fetch contents in readable format for AI**
6. ✅ **Search provider priority** (list of providers in order, e.g., tavily1, tavily2, brave)

## Core Features

### 1. Multi-Provider Architecture

**Providers to support**:
- **Tavily Search** (AI-optimized, rich snippets, answer API)
- **Brave Search** (privacy-focused, independent index)
- **Exa** (semantic search, similar pages, code context)
- **WebSearchAPI** (Google-powered, generous free tier)

**Provider capabilities**:
```typescript
interface SearchProvider {
  name: string;
  id: string;
  apiKeyEnvVar: string;
  supports: {
    search: boolean;      // Basic web search
    answer: boolean;      // AI-generated direct answers
    extract: boolean;     // Content extraction
    content: boolean;     // Include full content in results
    similar: boolean;     // Find similar pages
    code: boolean;       // Code examples
  };
  maxResults: number;
  freeTier: number;     // Free requests/month
  paidRate: string;      // Cost per 1K requests
}
```

### 2. Provider Priority System

**Priority configuration**:
```typescript
interface ProviderPriority {
  provider: string;      // "tavily", "brave", "exa", "websearchapi"
  weight: number;         // 1 = highest priority, 10 = lowest
  apiKey?: string;        // Optional override for specific provider instance
  enabled: boolean;       // Allow disabling specific providers
}
```

**Configuration example**:
```json
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true },
          { "provider": "tavily", "weight": 2, "enabled": true, "apiKey": "BACKUP_KEY" },
          { "provider": "brave", "weight": 3, "enabled": true },
          { "provider": "exa", "weight": 4, "enabled": false }
        ],
        "fallbackBehavior": "try-all",  // or "fail-fast"
        "maxProvidersToTry": 3,
        "timeoutSeconds": 30
      }
    }
  }
}
```

**Priority execution logic**:
```
For each query:
  1. Try provider with weight 1 (highest priority)
  2. On error/failure, try provider with weight 2
  3. Continue until maxProvidersToTry reached
  4. Return first successful result, or aggregate all failures
```

### 3. Unified Search Interface

**Commands**:
```bash
# Basic search (tries providers in priority order)
websearch search "cloudflare workers deployment"

# Search with specific provider
websearch search "rust ownership" --provider tavily

# Search with content extraction
websearch search "typescript async" --content

# Search with max results
websearch search "node.js streams" --count 5

# AI-generated direct answer
websearch answer "what is latest react version?"

# Extract content from URL
websearch extract "https://docs.rust-lang.org/book/"

# Find similar pages (Exa only)
websearch similar "https://blog.example.com/great-article"

# Find code examples (Exa only)
websearch code "react hooks state management"
```

### 4. Content Extraction & Formatting

**Two extraction modes**:

#### Mode A: Provider-Provided Extraction (Fast)
```typescript
// For Tavily, WebSearchAPI with includeRawContent
interface SearchResultWithContent {
  title: string;
  url: string;
  snippet: string;
  content?: string;      // Provider-extracted content
  age?: string;
}
```

#### Mode B: Local Extraction (Robust)
```typescript
// For Brave, or when provider doesn't extract
// Uses Mozilla Readability + Turndown (like Juan's websearch)
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

async function extractLocal(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ...",
    },
  });
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article?.content) {
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    return turndown.turndown(article.content);
  }

  throw new Error("Could not extract readable content");
}
```

**For AI consumption (Markdown + metadata)**:
```typescript
interface AIReadableResult {
  // Core content
  title: string;
  content: string;         // Markdown format
  url: string;

  // Metadata
  provider: string;
  timestamp: string;
  age?: string;
  publishedDate?: string;

  // Quality indicators
  contentLength: number;
  hasCodeBlocks: boolean;
  snippet: string;         // For quick scanning

  // Citations
  sources?: Array<{
    title: string;
    url: string;
    relevanceScore?: number;
  }>;
}
```

### 5. Error Handling & Fallback

**Error types**:
```typescript
enum SearchErrorType {
  AUTH_FAILED = "auth_failed",
  RATE_LIMITED = "rate_limited",
  TIMEOUT = "timeout",
  NETWORK_ERROR = "network_error",
  INVALID_RESPONSE = "invalid_response",
  NO_RESULTS = "no_results",
  PROVIDER_DOWN = "provider_down",
}

interface SearchError extends Error {
  type: SearchErrorType;
  provider: string;
  retryable: boolean;
  statusCode?: number;
  details?: string;
}
```

**Fallback strategy**:
```typescript
async function searchWithFallback(
  query: string,
  priority: ProviderPriority[]
): Promise<SearchResult[]> {
  const errors: SearchError[] = [];

  for (const { provider, weight } of priority.sort((a, b) => a.weight - b.weight)) {
    try {
      const results = await searchProvider(provider, query);
      ctx.log.info(
        `✅ Success with ${provider} (priority ${weight}): ${results.length} results`
      );
      return results;
    } catch (err) {
      const searchErr = err as SearchError;
      errors.push(searchErr);

      ctx.log.warn(
        `⚠️  ${provider} (priority ${weight}) failed: ${searchErr.type}` +
          (searchErr.retryable ? " - retryable" : " - not retryable")
      );

      // Don't retry if error is not retryable
      if (!searchErr.retryable) {
        break;
      }
    }
  }

  // All providers failed
  ctx.log.error(`❌ All providers failed for query: ${query}`);
  throw new AggregateSearchError("All search providers failed", errors);
}
```

### 6. Robustness Features

**Circuit breaker pattern**:
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.resetTimeout) {
        throw new Error("Circuit breaker is OPEN");
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
    }
  }
}
```

**Request deduplication**:
```typescript
const recentQueries = new Map<string, SearchResult[]>();

async function search(query: string): Promise<SearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();

  // Check cache
  if (recentQueries.has(normalizedQuery)) {
    ctx.log.info(`🔄 Cache hit for: ${query}`);
    return recentQueries.get(normalizedQuery)!;
  }

  // Execute search
  const results = await searchWithFallback(query, providerPriority);

  // Cache results (with TTL)
  recentQueries.set(normalizedQuery, results);
  setTimeout(() => recentQueries.delete(normalizedQuery), 5 * 60 * 1000);

  return results;
}
```

**Timeout & retry with exponential backoff**:
```typescript
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const timeout = 2 ** (attempt - 1) * 1000; // 1s, 2s, 4s

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response;
    } catch (err) {
      lastError = err as Error;
      ctx.log.warn(
        `Attempt ${attempt}/${maxRetries} failed: ${err.message}, retrying in ${timeout}ms`
      );
    }
  }

  throw lastError;
}
```

## API Integration

### Tavily Search

```typescript
async function searchTavily(
  query: string,
  options: { count: number; content: boolean }
): Promise<SearchResult[]> {
  const response = await fetchJSON("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey('tavily')}`,
    },
    body: JSON.stringify({
      query,
      max_results: options.count,
      include_raw_content: options.content ? "markdown" : false,
      search_depth: "basic",
    }),
  });

  return response.results.map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    content: r.raw_content,
    provider: "tavily",
  }));
}

async function answerTavily(query: string): Promise<AnswerResult> {
  const response = await fetchJSON("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey('tavily')}`,
    },
    body: JSON.stringify({
      query,
      include_answer: "advanced",
      max_results: 5,
    }),
  });

  return {
    answer: response.answer,
    citations: response.results.map((r: any) => ({
      title: r.title,
      url: r.url,
    })),
  };
}
```

### Brave Search

```typescript
async function searchBrave(
  query: string,
  options: { count: number; content: boolean }
): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(options.count));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": getApiKey('brave'),
    },
  });

  const results = response.data.web?.results || [];

  // Brave doesn't provide content extraction - do it locally
  if (options.content && results.length > 0) {
    const contents = await Promise.all(
      results.slice(0, 3).map(r => extractLocal(r.url))
    );
    results.forEach((r, i) => {
      r.content = contents[i];
    });
  }

  return results.map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    content: r.content,
    age: r.age,
    provider: "brave",
  }));
}
```

### Local Content Extraction (Mozilla Readability)

```typescript
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function extractContent(url: string): Promise<ExtractedContent> {
  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.content) {
    throw new Error("Could not extract readable content");
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);

  return {
    title: article.title || null,
    content: turndown.turndown(article.content),
    url,
    extractedAt: new Date().toISOString(),
    wordCount: article.textContent?.split(/\s+/).length || 0,
  };
}
```

## Output Formats

### For Human Reading

```
🔍 Search: "cloudflare workers deployment" (via Tavily)

✅ Found 5 results

1. Deploying a Cloudflare Worker
   https://developers.cloudflare.com/workers/
   Build serverless applications...

   Content: [First 500 chars of extracted content...]

2. What are Cloudflare Workers?
   https://www.cloudflare.com/learning/serverless/...
   Cloudflare Workers is a serverless platform...

   Content: [First 500 chars of extracted content...]

---

Provider: Tavily
Query time: 1.2s
Sources used: 5
```

### For AI Consumption (JSON)

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

### AI-Optimized Format (Markdown with Frontmatter)

````markdown
---
query: cloudflare workers deployment
provider: tavily
results_count: 5
query_time_ms: 1200
extracted_at: 2026-03-30T12:00:00Z
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
````

## Configuration

### Environment Variables

```bash
# Primary API keys
TAVILY_API_KEY=your_tavily_key
BRAVE_API_KEY=your_brave_key
EXA_API_KEY=your_exa_key
WEBSEARCHAPI_KEY=your_websearchapi_key

# Optional: Provider-specific backup keys
TAVILY_API_KEY_2=your_backup_tavily_key
BRAVE_API_KEY_2=your_backup_brave_key
```

### Plugin Config

```json
{
  "plugins": {
    "websearch": {
      "config": {
        // Provider priority (highest priority first)
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true },
          { "provider": "tavily", "weight": 2, "enabled": true, "apiKey": "TAVILY_API_KEY_2" },
          { "provider": "brave", "weight": 3, "enabled": true },
          { "provider": "exa", "weight": 4, "enabled": false },
          { "provider": "websearchapi", "weight": 5, "enabled": false }
        ],

        // Fallback behavior
        "fallbackBehavior": "try-all",  // "try-all" or "fail-fast"

        // How many providers to try before giving up
        "maxProvidersToTry": 3,

        // Request timeout
        "timeoutSeconds": 30,

        // Result limits
        "maxResults": 10,
        "maxResultsPerProvider": 5,

        // Content extraction settings
        "enableLocalExtraction": true,
        "extractionTimeout": 15,
        "extractionMaxResults": 3,

        // Caching
        "enableCache": true,
        "cacheTTLSeconds": 300,

        // Retry settings
        "maxRetries": 3,
        "retryDelayMs": 1000,

        // Output format
        "defaultFormat": "readable",  // "readable", "json", "markdown"
        "aiOptimized": false
      }
    }
  }
}
```

## Comparison: This Plugin vs Juan's websearch

| Feature | Juan's websearch | This Plugin (Beige) |
|---------|-------------------|------------------------|
| **Multi-provider** | ✅ Yes (5 providers) | ✅ Yes (4 providers) |
| **Priority system** | ❌ No | ✅ Yes (weight-based) |
| **Fallback** | ❌ No (manual -p flag) | ✅ Yes (automatic) |
| **Local extraction** | ✅ Yes (Readability) | ✅ Yes (Readability) |
| **Error handling** | ⚠️ Basic | ✅ Advanced (circuit breaker, retries) |
| **Caching** | ❌ No | ✅ Yes (in-memory) |
| **Circuit breaker** | ❌ No | ✅ Yes |
| **AI-optimized output** | ❌ No | ✅ Yes (JSON + metadata) |
| **Provider health tracking** | ❌ No | ✅ Yes |
| **Rate limit awareness** | ❌ No | ✅ Yes |
| **Deduplication** | ❌ No | ✅ Yes |
| **Brave Search** | ✅ Yes | ✅ Yes |
| **Tavily Search** | ✅ Yes | ✅ Yes |
| **Tavily Answer** | ✅ Yes | ✅ Yes |
| **OpenCode integration** | ❌ N/A | ✅ Compatible design |

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
- [ ] Plugin structure and config handling
- [ ] Provider interface and base class
- [ ] Error types and handling
- [ ] Basic logging

### Phase 2: Tavily Integration (Week 1-2)
- [ ] Tavily search API
- [ ] Tavily answer API
- [ ] Local extraction fallback
- [ ] Tests

### Phase 3: Brave Integration (Week 2)
- [ ] Brave search API
- [ ] Local extraction for Brave
- [ ] Error handling for Brave
- [ ] Tests

### Phase 4: Provider Priority System (Week 2-3)
- [ ] Priority configuration
- [ ] Fallback logic
- [ ] Circuit breaker implementation
- [ ] Provider health tracking

### Phase 5: Content Extraction (Week 3)
- [ ] Mozilla Readability integration
- [ ] Turndown Markdown conversion
- [ ] Browser headers
- [ ] Timeout handling

### Phase 6: Robustness Features (Week 3-4)
- [ ] Request deduplication
- [ ] In-memory caching
- [ ] Retry with exponential backoff
- [ ] Request timeout handling

### Phase 7: AI Optimization (Week 4)
- [ ] JSON output format
- [ ] Markdown with frontmatter
- [ ] Metadata enrichment
- [ ] Relevance scoring

### Phase 8: Documentation & Testing (Week 4)
- [ ] SKILL.md documentation
- [ ] Unit tests
- [ ] Integration tests
- [ ] Examples

## Dependencies

```json
{
  "dependencies": {
    "@mozilla/readability": "^0.6.0",
    "jsdom": "^29.0.1",
    "turndown": "^7.2.2",
    "turndown-plugin-gfm": "^1.0.2"
  },
  "devDependencies": {
    "@types/jsdom": "^28.0.1",
    "@types/turndown": "^5.0.6",
    "vitest": "^2.0.0"
  }
}
```

## Success Criteria

- [ ] ✅ Multi-provider support (Tavily, Brave, Exa, WebSearchAPI)
- [ ] ✅ Provider priority system with weights
- [ ] ✅ Automatic fallback on failure
- [ ] ✅ Local content extraction (Mozilla Readability)
- [ ] ✅ Markdown output for AI consumption
- [ ] ✅ Circuit breaker pattern
- [ ] ✅ Request deduplication
- [ ] ✅ In-memory caching
- [ ] ✅ Retry with exponential backoff
- [ ] ✅ Error handling with retry detection
- [ ] ✅ Provider health tracking
- [ ] ✅ Rate limit awareness
- [ ] ✅ Multiple output formats (human-readable, JSON, markdown)
- [ ] ✅ AI-optimized output with metadata
- [ ] ✅ At least as robust as OpenCode web fetch

---

**Next Step**: Implement Phase 1 (Core Infrastructure)
