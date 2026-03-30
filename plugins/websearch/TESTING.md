# Websearch Plugin - Testing & Integration Guide

**Date**: 2026-03-30

## Quick Start Testing

### 1. Install Dependencies

```bash
cd /workspace/beige-toolkit
pnpm install
```

This installs:
- `@mozilla/readability` - Article extraction
- `jsdom` - DOM manipulation
- `turndown` - HTML to Markdown
- `turndown-plugin-gfm` - GitHub Flavored Markdown

### 2. Set API Keys for Testing

```bash
# Quick test setup (use your actual keys)
export TAVILY_API_KEY=your_tavily_key
export BRAVE_API_KEY=your_brave_key

# Verify keys work
curl -H "Authorization: Bearer $TAVILY_API_KEY" \
  https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d '{"query":"test","max_results":1}'
```

### 3. Type Check

```bash
pnpm check plugins/websearch/index.ts
```

Fix any TypeScript errors before proceeding.

### 4. Basic Functionality Test

```bash
# Test 1: Basic search with Tavily
echo "Test 1: Tavily search"
beige websearch search "rust ownership system" --provider tavily --count 3

# Expected: 3 results with titles, URLs, snippets

# Test 2: Basic search with Brave
echo "Test 2: Brave search"
beige websearch search "cloudflare workers" --provider brave --count 3

# Expected: 3 results with titles, URLs, descriptions

# Test 3: Answer with Tavily
echo "Test 3: Tavily answer"
beige websearch answer "what is the latest version of Node.js?"

# Expected: Direct answer with source citations

# Test 4: Extract local content
echo "Test 4: Local extraction"
beige websearch extract "https://docs.rust-lang.org/book/ch04-01-what-is-ownership.html"

# Expected: Clean Markdown content from the URL

# Test 5: Priority fallback
echo "Test 5: Priority fallback (invalid key first, valid second)"
export TAVILY_API_KEY=invalid_key
export TAVILY_API_KEY_2=valid_key
echo "Config: tavily1 (invalid, weight=1), tavily2 (valid, weight=2)"
beige websearch search "test query"

# Expected: tavily1 fails (auth error), tavily2 succeeds (returns results)
```

### 5. Output Format Tests

```bash
# Test JSON format
echo "Test 6: JSON output"
beige websearch search "react hooks" --provider tavily --format json

# Expected: Valid JSON with metadata

# Test Markdown format
echo "Test 7: Markdown output"
beige websearch search "typescript generics" --provider tavily --format markdown

# Expected: Markdown with frontmatter and sections
```

### 6. Robustness Tests

```bash
# Test 8: Circuit breaker (trigger multiple failures)
echo "Test 8: Circuit breaker"
export TAVILY_API_KEY=invalid_key
for i in {1..5}; do
  echo "Attempt $i"
  beige websearch search "test" --provider tavily
  sleep 1
done

# Expected: First 3 attempts fail (circuit opens), then "Circuit breaker is OPEN"
# After 1 minute: Circuit resets, attempts succeed again

# Test 9: Cache hit (same query twice)
echo "Test 9: Cache"
beige websearch search "cache test" --provider tavily
beige websearch search "cache test" --provider tavily

# Expected: First call hits API, second call returns cached (faster, logs "Cache hit")

# Test 10: Content extraction timeout
echo "Test 10: Slow page (should timeout)"
beige websearch extract "https://httpbin.org/delay/20"

# Expected: Timeout error or success after extractionTimeout (default: 15s)
```

## Integration Examples

### Example 1: Simple Search Tool

```typescript
// src/tools/web-search.ts
import { beige } from '@matthias-hausberger/beige';

export async function webSearch(query: string): Promise<string> {
  const result = await beige.tools.run({
    tool: 'websearch',
    command: 'search',
    args: [query, '--format', 'json', '--ai-optimized'],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Websearch failed: ${result.output}`);
  }

  const data = JSON.parse(result.output);
  return `Found ${data.totalResults} results:\n${data.results.map(r =>
    `- ${r.title}: ${r.url}`
  ).join('\n')}`;
}

// Usage
const results = await webSearch('rust async await');
console.log(results);
```

### Example 2: Research Assistant with AI

```typescript
// src/tools/research-assistant.ts
import { beige } from '@matthias-hausberger/beige';

export async function research(question: string): Promise<string> {
  // Step 1: Get search results in AI-optimized format
  const searchResult = await beige.tools.run({
    tool: 'websearch',
    command: 'search',
    args: [question, '--format', 'json', '--ai-optimized'],
  });

  if (searchResult.exitCode !== 0) {
    throw new Error(`Search failed: ${searchResult.output}`);
  }

  const searchData = JSON.parse(searchResult.output);

  // Step 2: Build context for LLM
  const context = searchData.results
    .filter(r => r.content) // Only use results with content
    .slice(0, 3) // Top 3 results for context
    .map(r => `## ${r.title}\n${r.content}`)
    .join('\n\n');

  // Step 3: Ask AI with context
  const aiResult = await beige.llm.complete({
    prompt: `Answer this question based on the search results below:\n\n${context}\n\nQuestion: ${question}`,
    model: 'claude-3-5-sonnet-4-1-20250214',
  });

  return aiResult;
}

// Usage
const answer = await research('What is cloudflare workers?');
console.log(answer);
```

### Example 3: Batch Research

```typescript
// src/tools/batch-research.ts
import { beige } from '@matthias-hausberger/beige';

const queries = [
  'rust ownership',
  'typescript generics',
  'cloudflare workers',
];

export async function batchResearch(): Promise<Map<string, any>> {
  const results = new Map<string, any>();

  for (const query of queries) {
    try {
      const result = await beige.tools.run({
        tool: 'websearch',
        command: 'search',
        args: [query, '--provider', 'tavily', '--count', '5', '--format', 'json'],
      });

      if (result.exitCode === 0) {
        results.set(query, JSON.parse(result.output));
      }
    } catch (err) {
      console.error(`Failed to search "${query}":`, err);
      results.set(query, { error: err.message });
    }
  }

  return results;
}

// Usage
const findings = await batchResearch();
for (const [query, data] of findings.entries()) {
  console.log(`\n=== ${query} ===`);
  if ('error' in data) {
    console.log(`ERROR: ${data.error}`);
  } else {
    console.log(`Found ${data.totalResults} results`);
  }
}
```

### Example 4: Content Extraction Pipeline

```typescript
// src/tools/extract-and-summarize.ts
import { beige } from '@matthias-hausberger/beige';

export async function extractAndSummarize(url: string): Promise<string> {
  // Step 1: Extract content
  const extractResult = await beige.tools.run({
    tool: 'websearch',
    command: 'extract',
    args: [url],
  });

  if (extractResult.exitCode !== 0) {
    throw new Error(`Extraction failed: ${extractResult.output}`);
  }

  // Step 2: Summarize with AI
  const summary = await beige.llm.complete({
    prompt: `Summarize the following content in 3-5 bullet points:\n\n${extractResult.output}`,
    model: 'claude-3-5-sonnet-4-1-20250214',
  });

  return summary;
}

// Usage
const summary = await extractAndSummarize('https://docs.rust-lang.org/book/');
console.log(summary);
```

### Example 5: Multi-Provider Fallback

```typescript
// src/tools/fallback-search.ts
import { beige } from '@matthias-hausberger/beige';

export async function searchWithFallback(query: string): Promise<any> {
  // Configure priority: Tavily1 (primary), Tavily2 (backup), Brave (fallback)
  const config = {
    'plugins.websearch.config': {
      'providerPriority': [
        { 'provider': 'tavily', 'weight': 1, 'enabled': true },
        { 'provider': 'tavily', 'weight': 2, 'enabled': true, 'apiKey': 'TAVILY_API_KEY_2' },
        { 'provider': 'brave', 'weight': 3, 'enabled': true },
      ],
      'maxProvidersToTry': 3,
      'fallbackBehavior': 'try-all',
      'enableCache': true,
    },
  };

  // Use temporary config (or persist in your agent config)
  const result = await beige.tools.run({
    tool: 'websearch',
    command: 'search',
    args: [query, '--format', 'json', '--ai-optimized'],
    config,
  });

  if (result.exitCode !== 0) {
    throw new Error(`All providers failed: ${result.output}`);
  }

  const data = JSON.parse(result.output);

  // Check which provider succeeded
  const providerUsed = data.provider;
  console.log(`Search completed using: ${providerUsed}`);
  console.log(`Providers tried: ${data.providersTried}`);

  return data.results;
}
```

## Beige Agent Configuration

### Simple Configuration (Environment Variables)

```json
// beige-agent config
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true },
          { "provider": "brave", "weight": 2, "enabled": true }
        ],
        "enableCache": true,
        "enableLocalExtraction": true,
        "defaultFormat": "json",
        "aiOptimized": true
      }
    }
  },
  "env": {
    "TAVILY_API_KEY": "your_tavily_key_here",
    "BRAVE_API_KEY": "your_brave_key_here"
  }
}
```

### Advanced Configuration (Backup Keys, High Availability)

```json
// beige-agent config
{
  "plugins": {
    "websearch": {
      "config": {
        "providerPriority": [
          { "provider": "tavily", "weight": 1, "enabled": true },
          { "provider": "tavily", "weight": 2, "enabled": true, "apiKey": "TAVILY_API_KEY_2" },
          { "provider": "tavily", "weight": 3, "enabled": true, "apiKey": "TAVILY_API_KEY_3" },
          { "provider": "brave", "weight": 4, "enabled": true }
        ],
        "maxProvidersToTry": 4,
        "fallbackBehavior": "try-all",
        "enableCache": true,
        "cacheTTLSeconds": 600,
        "timeoutSeconds": 30,
        "extractionTimeout": 20,
        "extractionMaxResults": 5,
        "maxRetries": 3,
        "retryDelayMs": 2000,
        "defaultFormat": "json",
        "aiOptimized": true
      }
    }
  },
  "env": {
    "TAVILY_API_KEY": "your_primary_tavily_key",
    "TAVILY_API_KEY_2": "your_backup_tavily_key",
    "TAVILY_API_KEY_3": "your_tertiary_tavily_key",
    "BRAVE_API_KEY": "your_brave_key"
  }
}
```

## Performance Tuning

### For Speed (Low Latency)

```json
{
  "plugins": {
    "websearch": {
      "config": {
        "fallbackBehavior": "fail-fast",
        "maxProvidersToTry": 1,
        "timeoutSeconds": 15,
        "maxRetries": 1,
        "retryDelayMs": 500,
        "enableCache": true,
        "cacheTTLSeconds": 60
      }
    }
  }
}
```

**Trade-off**: Faster responses, but fewer results on provider failure.

### For Cost (Low API Usage)

```json
{
  "plugins": {
    "websearch": {
      "config": {
        "enableCache": true,
        "cacheTTLSeconds": 1800,
        "extractionMaxResults": 2,
        "maxProvidersToTry": 2
      }
    }
  }
}
```

**Trade-off**: Slower on cache miss, but significantly lower API costs.

### For Reliability (High Availability)

```json
{
  "plugins": {
    "websearch": {
      "config": {
        "fallbackBehavior": "try-all",
        "maxProvidersToTry": 5,
        "timeoutSeconds": 45,
        "maxRetries": 5,
        "retryDelayMs": 3000,
        "enableCache": true,
        "cacheTTLSeconds": 300
      }
    }
  }
}
```

**Trade-off**: Higher latency on failure, but maximum reliability.

## Troubleshooting

### Plugin Not Loading

**Symptom**: `beige websearch` returns "Unknown tool"

**Solution**:
```bash
# Check plugin is registered
pnpm list

# Check plugin files exist
ls -la beige-toolkit/plugins/websearch/

# Check plugin.json is valid
cat beige-toolkit/plugins/websearch/plugin.json | jq .
```

### All Providers Failing

**Symptom**: `All search providers failed`

**Debug Steps**:
```bash
# 1. Verify API keys are set
echo "Tavily: ${TAVILY_API_KEY:0:8}..."
echo "Brave: ${BRAVE_API_KEY:0:8}..."

# 2. Test API keys directly
curl -H "Authorization: Bearer $TAVILY_API_KEY" \
  https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d '{"query":"test","max_results":1}'

curl -H "X-Subscription-Token: $BRAVE_API_KEY" \
  "https://api.search.brave.com/res/v1/web/search?q=test&count=1"

# 3. Check plugin logs
# (Beige logs should show which provider failed and why)
```

### Circuit Breaker Stuck Open

**Symptom**: `Circuit breaker is OPEN for tavily` persists

**Solution**:
```bash
# Wait 1 minute for circuit to reset
sleep 60

# Or force reset by restarting agent
beige restart

# Or disable circuit breaker (modify maxRetries to 0)
```

### Content Extraction Timeout

**Symptom**: `HTTP 408: Request Timeout` on simple pages

**Debug**:
```bash
# Test with longer timeout
beige websearch extract "https://example.com"  # May need to increase extractionTimeout

# Test if provider has built-in content
beige websearch search "site:example.com test" --provider tavily --format json
# Tavily provides content, no need for local extraction

# Consider curl-impersonate for bot protection
```

## Integration Checklist

- [ ] Plugin installed and dependencies loaded
- [ ] API keys configured (at least one provider)
- [ ] Type checking passes
- [ ] Basic search works with primary provider
- [ ] Fallback works (test with invalid primary key)
- [ ] Circuit breaker triggers correctly
- [ ] Cache works (same query twice)
- [ ] Content extraction works
- [ ] JSON format is valid and parseable
- [ ] Markdown format is readable
- [ ] AI-optimized output has metadata
- [ ] Integrated with Beige agent config
- [ ] Error messages are clear and actionable
- [ ] Performance meets requirements (latency, cost)

## Migration from Juan's websearch CLI

If you were using Juan's websearch CLI as a subprocess:

### Before
```typescript
// Old way
import { exec } from 'child_process';

async function search(query: string): Promise<any> {
  const { stdout } = await exec(`websearch search "${query}" --json`);
  return JSON.parse(stdout);
}
```

### After
```typescript
// New way
import { beige } from '@matthias-hausberger/beige';

async function search(query: string): Promise<any> {
  const result = await beige.tools.run({
    tool: 'websearch',
    command: 'search',
    args: [query, '--format', 'json', '--ai-optimized'],
  });

  return JSON.parse(result.output);
}
```

**Benefits**:
- No subprocess overhead
- Native Beige integration
- Better error handling and logging
- Circuit breaker and caching built-in
- AI-optimized output format

## Production Deployment

### Environment Variables (Recommended)

```bash
# Production setup
export TAVILY_API_KEY="${TAVILY_PROD_KEY}"
export TAVILY_API_KEY_2="${TAVILY_BACKUP_KEY}"
export BRAVE_API_KEY="${BRAVE_PROD_KEY}"

# Deploy Beige agent with config
beige deploy --config production.json
```

### Monitoring

```typescript
// Track provider health
const healthChecks = {
  tavily: { success: 0, failure: 0 },
  brave: { success: 0, failure: 0 },
};

// After each search
if (data.provider === 'tavily') healthChecks.tavily.success++;
else if (data.provider === 'tavily' && result.exitCode !== 0) healthChecks.tavily.failure++;

// Log provider health periodically
console.log('Provider health:', healthChecks);
```

### Cost Tracking

```typescript
// Track API usage
const usage = {
  tavily: { search: 0, extract: 0 },
  brave: { search: 0 },
  cacheHits: 0,
};

// Increment counters
usage.tavily.search++;
if (cached) usage.cacheHits++;

// Report daily
console.log('Daily usage:', usage);
```

## Next Steps

1. **Test with real API keys**: Run all test scenarios
2. **Validate functionality**: Ensure all features work as expected
3. **Integrate with Beige**: Update agent config
4. **Monitor in production**: Track provider health and costs
5. **Gather feedback**: Note any issues or improvements needed

---

**Plugin location**: `/workspace/beige-toolkit/plugins/websearch/`
**Full documentation**: See SKILL.md for comprehensive guide
