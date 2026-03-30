# Quick Test Guide for Websearch Plugin

## 1. First: Restart Beige Agent

The websearch plugin won't be visible until Beige agent is restarted.

```bash
# Option A: Via Beige admin interface (restart agent)
# Option B: Kill process and let it restart
beige restart
```

Verify plugin is registered:
```bash
beige tools list | grep websearch
```

Expected output:
```
websearch
  └─ websearch/
      └── SKILL.md
```

## 2. Test Plugin Discovery

```bash
# Check if plugin is visible
beige tools run --tool websearch --help

# Expected: Should show usage or "Unknown tool" if not registered
```

## 3. Set Up Test API Keys

```bash
# Get free Tavily key: https://app.tavily.com
# Get free Brave key: https://brave.com/search/api/

# Set for current session (shell)
export TAVILY_API_KEY="your_tavily_key_here"
export BRAVE_API_KEY="your_brave_key_here"

# Verify keys work
curl -H "Authorization: Bearer $TAVILY_API_KEY" \
  https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d '{"query":"test","max_results":1}'

curl -H "X-Subscription-Token: $BRAVE_API_KEY" \
  "https://api.search.brave.com/res/v1/web/search?q=test&count=1"
```

## 4. Test 1: Basic Search with Tavily

```bash
# Test Tavily search
beige websearch search "rust ownership system" --provider tavily --count 3

# Expected output: 3 results with titles, URLs, snippets
```

Expected output format:
```
🔍 Search: "rust ownership system" (via Tavily)

✅ Found 3 results

1. What is ownership in Rust?
   https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html
   The ownership model ensures that memory is safely managed...

2. What does Box<dyn T> mean in Rust?
   https://stackoverflow.com/questions/285296/what-does-box-dyn-t-mean-in-rust
   Box<dyn T> is a smart pointer type...

3. Understanding Rust's Ownership Model
   https://blog.logrocket.com/understanding-rust-ownership-model
   ...

---

Provider: Tavily
Results: 3
Query time: 1.2s
Providers tried: 1
```

## 5. Test 2: Basic Search with Brave

```bash
# Test Brave search
beige websearch search "cloudflare workers" --provider brave --count 3

# Expected output: 3 results with titles, URLs, descriptions
```

## 6. Test 3: Priority Fallback (Tavily → Brave)

```bash
# Test priority fallback (Tavily should fail if we use invalid key)
export TAVILY_API_KEY="invalid_key"
export BRAVE_API_KEY="your_brave_key"

beige websearch search "test query" --format json

# Expected: Tavily fails (auth error), Brave succeeds (returns results)
# JSON output should show: provider: "brave", providersTried: 2
```

## 7. Test 4: AI-Optimized JSON Output

```bash
# Test AI-optimized output
beige websearch search "typescript best practices" --provider tavily --format json --ai-optimized

# Expected: JSON with metadata fields:
# - wordCount (for context sizing)
# - hasCodeBlocks (for formatting)
# - provider, queryTime, providersTried
# - timestamp
```

Expected JSON structure:
```json
{
  "query": "typescript best practices",
  "provider": "tavily",
  "providerPriority": [...],
  "results": [
    {
      "title": "TypeScript Best Practices",
      "url": "https://...",
      "snippet": "...",
      "content": "...",
      "metadata": {
        "provider": "tavily",
        "wordCount": 1234,
        "hasCodeBlocks": true
      }
    }
  ],
  "totalResults": 5,
  "queryTime": 1200,
  "providersTried": 1,
  "timestamp": "2026-03-30T12:00:00Z"
}
```

## 8. Test 5: Local Content Extraction

```bash
# Test local extraction
beige websearch extract "https://docs.rust-lang.org/book/ch04-01-what-is-ownership.html"

# Expected: Clean Markdown content extracted using Mozilla Readability
```

Expected output:
```
# Understanding Rust's Ownership Model

The ownership model ensures that memory is safely managed...

[Full Markdown content extracted from article]

(Extracted in 2341ms)
```

## 9. Test 6: Circuit Breaker Behavior

```bash
# Trigger circuit breaker (3 consecutive failures)
export TAVILY_API_KEY="invalid_key"

for i in {1..5}; do
  echo "Attempt $i"
  beige websearch search "test" --provider tavily 2>&1 | grep -i "circuit\|open"
  sleep 0.5
done

# Expected: First 3 attempts fail, 4th shows "Circuit breaker is OPEN"
# Wait 60 seconds
# Subsequent attempts should succeed again
```

## 10. Test 7: Cache Effectiveness

```bash
# Test cache (same query twice should hit cache)
beige websearch search "cache test 1" --provider tavily
beige websearch search "cache test 2" --provider tavily

# Expected: First call hits API, second call returns cached results (faster)
# Logs should show: "🔄 Cache hit for: cache test 2"
```

## 11. Test 8: Answer with Citations

```bash
# Test AI-generated answer
beige websearch answer "what is the latest version of Node.js?" --provider tavily

# Expected: Direct answer with source citations (Tavily)
```

Expected output:
```
Answer:
Node.js is a JavaScript runtime... (as of March 2026)

Sources:
1. Node.js Release Schedule - https://nodejs.org/en/about/releases
2. Wikipedia - Node.js - https://en.wikipedia.org/wiki/Node.js
...
```

## 12. Test 9: Multiple Output Formats

```bash
# Test different formats
beige websearch search "test" --provider tavily --format readable
beige websearch search "test" --provider tavily --format json
beige websearch search "test" --provider tavily --format markdown

# Expected: Same results in different formats
```

## 13. Test 10: Full Configuration

```bash
# Test with high-availability config
beige websearch search "test" \
  --provider tavily \
  --count 5 \
  --format json \
  --ai-optimized

# Expected: Uses all configured options
```

## Troubleshooting

### Plugin Not Found

**Symptom**: `beige tools run --tool websearch --help` returns "Unknown tool"

**Solution**:
1. Restart Beige agent: `beige restart`
2. Check plugin files exist: `ls -la beige-toolkit/plugins/websearch/`
3. Check plugin.json is valid: `cat beige-toolkit/plugins/websearch/plugin.json | jq .`
4. Verify Beige agent sees plugin: `beige tools list | grep websearch`

### All Providers Failing

**Symptom**: `All search providers failed`

**Solution**:
1. Verify API keys: `echo $TAVILY_API_KEY`
2. Test keys directly: `curl -H "Authorization: Bearer $TAVILY_API_KEY" https://api.tavily.com/search -d '{"query":"test","max_results":1}'`
3. Check network connectivity: `curl -I https://api.tavily.com/search`
4. Check provider status pages
5. Reduce `maxProvidersToTry`: Try only 1 provider first
6. Check Beige logs for specific error details

### Circuit Breaker Stuck Open

**Symptom**: `Circuit breaker is OPEN for tavily` persists

**Solution**:
1. Wait 1 minute: `sleep 60`
2. Restart Beige agent: `beige restart`
3. Or disable circuit breaker: Set `maxRetries: 0` in config
4. Verify API key is valid and not rate limited

### Content Extraction Timeout

**Symptom**: `HTTP 408: Request Timeout` or `Could not extract readable content`

**Solution**:
1. Increase `extractionTimeout`: Set to 30 seconds
2. Disable local extraction: `enableLocalExtraction: false`
3. Use provider-provided content instead
4. Check if target site is slow or has bot protection

### Dependencies Not Found

**Symptom**: Import errors for `@mozilla/readability` or `jsdom`

**Solution**:
```bash
# Install dependencies in beige-toolkit
cd /workspace/beige-toolkit
pnpm install

# Verify installation
ls node_modules/@mozilla/readability
ls node_modules/jsdom
```

## Success Criteria

Plugin is working correctly when:
- [ ] Plugin is registered (`beige tools list | grep websearch`)
- [ ] Basic search with Tavily works
- [ ] Basic search with Brave works
- [ ] Priority fallback works (Tavily → Brave)
- [ ] Circuit breaker triggers correctly
- [ ] Cache hit works (second call faster)
- [ ] JSON output is valid and parseable
- [ ] Local content extraction works
- [ ] Answer with citations works
- [ ] Error messages are clear and actionable
- [ ] Beige integration is native (not subprocess)

## Quick Test Commands

```bash
# Run all tests
./test-websearch.sh

# Individual tests
beige websearch search "rust ownership system" --provider tavily --count 3
beige websearch search "rust ownership system" --provider brave --count 3
beige websearch answer "what is the latest version of Node.js?" --provider tavily
beige websearch extract "https://docs.rust-lang.org/book/"
beige websearch search "cache test" --provider tavily --format json --ai-optimized
```

## Next Steps After Testing

1. ✅ If all tests pass - Create PR for beige-toolkit
2. ⚠️ If some tests fail - Fix issues, document in SKILL.md
3. 📝 Update README.md with real-world examples
4. 🚀 Deploy to production Beige agent with proper config

## Integration Example

Once plugin is working, integrate with Beige:

```typescript
// In your Beige agent code
import { beige } from '@matthias-hausberger/beige';

async function search(query: string): Promise<any> {
  const result = await beige.tools.run({
    tool: 'websearch',
    command: 'search',
    args: [query, '--format', 'json', '--ai-optimized'],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Websearch failed: ${result.output}`);
  }

  const data = JSON.parse(result.output);

  // Use AI-optimized output
  const context = data.results
    .filter(r => r.content)
    .slice(0, 3) // Top 3 results for context
    .map(r => `## ${r.title}\n${r.content}`)
    .join('\n\n');

  // Ask LLM with context
  const answer = await beige.llm.complete({
    prompt: `Answer this question based on the search results below:\n\n${context}\n\nQuestion: ${query}`,
    model: 'claude-3-5-sonnet-4-1-20250214',
  });

  return answer;
}
```

---

**Remember**: The websearch plugin won't be available until Beige agent is restarted!
