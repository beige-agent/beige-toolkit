/**
 * Websearch Plugin for Beige Toolkit
 *
 * Multi-provider web search with:
 *   - Provider priority system (Tavily, Brave, Exa, WebSearchAPI)
 *   - Automatic fallback on failure
 *   - Local content extraction (Mozilla Readability)
 *   - AI-optimized output formats
 *   - Circuit breaker pattern
 *   - Request deduplication
 *   - In-memory caching
 *
 * Config (passed via pluginConfigs or plugins.websearch.config):
 *   providerPriority: Array of providers with weights (1=highest priority)
 *   fallbackBehavior: "try-all" | "fail-fast"
 *   maxProvidersToTry: Max number of providers to attempt (default: 3)
 *   timeoutSeconds: Request timeout (default: 30)
 *   maxResults: Default max results (default: 10)
 *   enableCache: Enable in-memory caching (default: true)
 *   cacheTTLSeconds: Cache TTL in seconds (default: 300)
 *   enableLocalExtraction: Use local extraction for providers without content (default: true)
 *   defaultFormat: "readable" | "json" | "markdown" (default: "readable")
 *   aiOptimized: Output optimized for AI consumption (default: false)
 */

import type {
  PluginInstance,
  PluginContext,
  PluginRegistrar,
  ToolResult,
} from "@matthias-hausberger/beige";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProviderPriority {
  provider: string;
  weight: number;
  enabled: boolean;
  apiKey?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  age?: string;
  publishedDate?: string;
  provider: string;
  relevanceScore?: number;
}

interface AnswerResult {
  answer: string;
  citations: Array<{
    title: string;
    url: string;
  }>;
}

interface ExtractedContent {
  title: string | null;
  content: string;
  url: string;
  extractedAt: string;
  wordCount: number;
  hasCodeBlocks: boolean;
}

interface AIReadableResult {
  title: string;
  content: string;
  url: string;
  provider: string;
  timestamp: string;
  age?: string;
  publishedDate?: string;
  contentLength: number;
  hasCodeBlocks: boolean;
  snippet: string;
  sources?: Array<{
    title: string;
    url: string;
    relevanceScore?: number;
  }>;
}

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

interface WebsearchConfig {
  providerPriority?: ProviderPriority[];
  fallbackBehavior?: "try-all" | "fail-fast";
  maxProvidersToTry?: number;
  timeoutSeconds?: number;
  maxResults?: number;
  enableCache?: boolean;
  cacheTTLSeconds?: number;
  enableLocalExtraction?: boolean;
  extractionTimeout?: number;
  extractionMaxResults?: number;
  defaultFormat?: "readable" | "json" | "markdown";
  aiOptimized?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface ProviderConfig {
  name: string;
  id: string;
  apiKeyEnvVar: string;
  supports: {
    search: boolean;
    answer: boolean;
    extract: boolean;
    content: boolean;
    similar: boolean;
    code: boolean;
  };
  maxResults: number;
  freeTier: number;
  paidRate?: string;
}

// ── Provider Registry ───────────────────────────────────────────────────────

const PROVIDERS: Record<string, ProviderConfig> = {
  tavily: {
    name: "Tavily",
    id: "tavily",
    apiKeyEnvVar: "TAVILY_API_KEY",
    supports: { search: true, answer: true, extract: false, content: true, similar: false, code: false },
    maxResults: 10,
    freeTier: 1000,
    paidRate: "~$5-10/1K",
  },
  brave: {
    name: "Brave Search",
    id: "brave",
    apiKeyEnvVar: "BRAVE_API_KEY",
    supports: { search: true, answer: false, extract: false, content: false, similar: false, code: false },
    maxResults: 20,
    freeTier: 2000,
    paidRate: "~$2-5/1K",
  },
  exa: {
    name: "Exa",
    id: "exa",
    apiKeyEnvVar: "EXA_API_KEY",
    supports: { search: true, answer: true, extract: false, content: true, similar: true, code: true },
    maxResults: 10,
    freeTier: 1000,
    paidRate: "~$5-10/1K",
  },
  websearchapi: {
    name: "WebSearchAPI",
    id: "websearchapi",
    apiKeyEnvVar: "WEBSEARCHAPI_KEY",
    supports: { search: true, answer: true, extract: false, content: true, similar: false, code: false },
    maxResults: 10,
    freeTier: 2000,
    paidRate: "~$2-5/1K",
  },
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CACHE_TTL_MS = 300000; // 5 minutes
const DEFAULT_MAX_PROVIDERS_TO_TRY = 3;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Circuit Breaker ─────────────────────────────────────────────────────────

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly failureThreshold = 3;
  private readonly resetTimeout = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>, provider: string): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime < this.resetTimeout) {
        throw new Error(`Circuit breaker is OPEN for ${provider}`);
      }
      this.state = "half-open";
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
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.lastFailureTime = 0;
  }
}

// ── Request Cache ────────────────────────────────────────────────────────────

class RequestCache {
  private cache = new Map<string, { results: any; timestamp: number }>();
  private readonly ttl: number;

  constructor(ttlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.ttl = ttlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.results as T;
  }

  set(key: string, results: any): void {
    this.cache.set(key, { results, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// ── Content Extraction ─────────────────────────────────────────────────────

// Lazy load content extraction dependencies
let readability: typeof import("@mozilla/readability").Readability | null = null;
let JSDOM: typeof import("jsdom").JSDOM | null = null;
let TurndownService: any = null;

async function initContentExtraction(): Promise<void> {
  if (readability && JSDOM && TurndownService) return;

  const [
    { Readability: ReadabilityClass },
    { JSDOM: JSDOMClass },
    { default: Turndown },
  ] = await Promise.all([
    import("@mozilla/readability"),
    import("jsdom"),
    import("turndown"),
  ]);

  const { default: gfm } = await import("turndown-plugin-gfm");

  readability = ReadabilityClass as any;
  JSDOM = JSDOMClass as any;
  TurndownService = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced" });
  (TurndownService as any).use(gfm);
}

async function extractContentLocal(
  url: string,
  timeoutMs: number = 15000
): Promise<ExtractedContent> {
  await initContentExtraction();

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const dom = new JSDOM!(html, { url });
  const reader = new readability!(dom.window.document);
  const article = reader.parse();

  if (!article?.content) {
    throw new Error("Could not extract readable content");
  }

  const content = (TurndownService as any).turndown(article.content);
  const textContent = article.textContent || "";

  return {
    title: article.title || null,
    content: content,
    url,
    extractedAt: new Date().toISOString(),
    wordCount: textContent.split(/\s+/).length,
    hasCodeBlocks: /```[\s\S]*?[\w]*[\s]*\n([\s\S]*?)\n```/.test(content),
  };
}

// ── Plugin Entry Point ──────────────────────────────────────────────────────

export function createPlugin(
  config: Record<string, unknown>,
  ctx: PluginContext
): PluginInstance {
  const cfg = config as WebsearchConfig;

  // Resolve provider priority
  const providerPriority: ProviderPriority[] = cfg.providerPriority || [
    { provider: "tavily", weight: 1, enabled: true },
    { provider: "brave", weight: 2, enabled: true },
  ];

  const fallbackBehavior = cfg.fallbackBehavior || "try-all";
  const maxProvidersToTry = cfg.maxProvidersToTry || DEFAULT_MAX_PROVIDERS_TO_TRY;
  const timeoutMs = (cfg.timeoutSeconds || 30) * 1000;
  const maxResults = cfg.maxResults || DEFAULT_MAX_RESULTS;
  const enableCache = cfg.enableCache !== false;
  const cache = new RequestCache((cfg.cacheTTLSeconds || 300) * 1000);
  const enableLocalExtraction = cfg.enableLocalExtraction !== false;
  const extractionTimeout = cfg.extractionTimeout || 15;
  const extractionMaxResults = cfg.extractionMaxResults || 3;
  const defaultFormat = cfg.defaultFormat || "readable";
  const aiOptimized = cfg.aiOptimized || false;
  const maxRetries = cfg.maxRetries || DEFAULT_MAX_RETRIES;
  const retryDelayMs = cfg.retryDelayMs || DEFAULT_RETRY_DELAY_MS;

  // Circuit breakers for each provider
  const circuitBreakers = new Map<string, CircuitBreaker>();

  // ── Provider implementations ─────────────────────────────────────────────

  async function getApiKey(providerId: string, customKey?: string): string {
    const key = customKey || process.env[PROVIDERS[providerId].apiKeyEnvVar];
    if (!key) {
      throw new SearchError(
        `API key not configured for ${PROVIDERS[providerId].name}. Set ${PROVIDERS[providerId].apiKeyEnvVar} environment variable.`,
        SearchErrorType.AUTH_FAILED,
        providerId,
        true
      );
    }
    return key;
  }

  async function searchTavily(
    query: string,
    options: { count: number; content: boolean }
  ): Promise<SearchResult[]> {
    const key = await getApiKey("tavily");
    const circuitBreaker = circuitBreakers.get("tavily") || new CircuitBreaker();

    return circuitBreaker.execute(async () => {
      const response = await fetchJSON("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query,
          max_results: options.count,
          include_raw_content: options.content ? "markdown" : false,
          search_depth: "basic",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      return (response.results || []).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content || "",
        content: options.content ? r.raw_content : undefined,
        age: r.publishedDate || undefined,
        provider: "tavily",
      }));
    }, "tavily");
  }

  async function searchBrave(
    query: string,
    options: { count: number; content: boolean }
  ): Promise<SearchResult[]> {
    const key = await getApiKey("brave");
    const circuitBreaker = circuitBreakers.get("brave") || new CircuitBreaker();

    return circuitBreaker.execute(async () => {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(options.count));

      const response = await fetchJSON(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": key,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const results = (response.web?.results || []).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.description || "",
        age: r.age || undefined,
        provider: "brave",
      }));

      // Extract content locally if requested
      if (options.content && results.length > 0) {
        const contents = await Promise.all(
          results.slice(0, extractionMaxResults).map((r) =>
            extractContentLocal(r.url, extractionTimeout * 1000).catch(() => null)
          )
        );

        results.forEach((r, i) => {
          r.content = contents[i] ? contents[i].content : undefined;
        });
      }

      return results;
    }, "brave");
  }

  async function searchWithFallback(query: string): Promise<SearchResult[]> {
    // Check cache
    const normalizedQuery = query.trim().toLowerCase();
    if (enableCache) {
      const cached = cache.get<SearchResult[]>(`search:${normalizedQuery}`);
      if (cached) {
        ctx.log.info(`🔄 Cache hit for: ${query}`);
        return cached;
      }
    }

    const enabledProviders = providerPriority
      .filter((p) => p.enabled)
      .sort((a, b) => a.weight - b.weight);

    const errors: SearchError[] = [];

    for (const { provider, weight } of enabledProviders.slice(0, maxProvidersToTry)) {
      try {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig.supports.search) {
          ctx.log.debug(`Provider ${provider} does not support search`);
          continue;
        }

        let results: SearchResult[] = [];

        switch (provider) {
          case "tavily":
            results = await searchTavily(query, { count: maxResults, content: enableLocalExtraction });
            break;
          case "brave":
            results = await searchBrave(query, { count: maxResults, content: enableLocalExtraction });
            break;
          default:
            ctx.log.debug(`Provider ${provider} not implemented yet`);
            continue;
        }

        ctx.log.info(
          `✅ Success with ${PROVIDERS[provider].name} (priority ${weight}): ${results.length} results`
        );

        // Cache successful results
        if (enableCache) {
          cache.set(`search:${normalizedQuery}`, results);
        }

        return results;
      } catch (err) {
        const searchErr = err as SearchError;
        errors.push(searchErr);

        ctx.log.warn(
          `⚠️  ${PROVIDERS[provider].name} (priority ${weight}) failed: ${searchErr.type}` +
            (searchErr.retryable ? " - retryable" : " - not retryable")
        );

        // Don't retry if error is not retryable
        if (!searchErr.retryable) {
          break;
        }

        if (fallbackBehavior === "fail-fast") {
          break;
        }
      }
    }

    // All providers failed
    ctx.log.error(`❌ All providers failed for query: ${query}`);
    throw new AggregateSearchError("All search providers failed", errors);
  }

  async function answerTavily(query: string): Promise<AnswerResult> {
    const key = await getApiKey("tavily");
    const circuitBreaker = circuitBreakers.get("tavily") || new CircuitBreaker();

    return circuitBreaker.execute(async () => {
      const response = await fetchJSON("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query,
          include_answer: "advanced",
          max_results: 5,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      return {
        answer: response.answer || "(No answer generated)",
        citations: (response.results || []).map((r: any) => ({
          title: r.title || "",
          url: r.url || "",
        })),
      };
    }, "tavily");
  }

  async function extractUrl(url: string): Promise<ExtractedContent> {
    return extractContentLocal(url, extractionTimeout * 1000);
  }

  async function fetchJSON(
    url: string,
    options: RequestInit & { signal?: AbortSignal } = {}
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new SearchError(
        `HTTP ${response.status}: ${response.statusText}\n${text}`,
        response.status === 401 ? SearchErrorType.AUTH_FAILED :
        response.status === 429 ? SearchErrorType.RATE_LIMITED :
        response.status === 408 || response.status === 504 ? SearchErrorType.TIMEOUT :
        SearchErrorType.NETWORK_ERROR,
        "unknown",
        response.status,
        text.slice(0, 200)
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  // ── Output formatters ─────────────────────────────────────────────────

  function formatReadable(
    query: string,
    results: SearchResult[],
    metadata: {
      provider: string;
      queryTime: number;
      providersTried: number;
    }
  ): string {
    if (results.length === 0) {
      return `No results found for: ${query}`;
    }

    const lines: string[] = [`🔍 Search: "${query}" (via ${metadata.provider})\n`];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`${i + 1}. ${r.title}`);
      lines.push(`   ${r.url}`);
      if (r.snippet) {
        const snippet = r.snippet.length > 200 ? r.snippet.slice(0, 197) + "…" : r.snippet;
        lines.push(`   ${snippet}`);
      }
      if (r.age) lines.push(`   ${r.age}`);
      if (r.content) {
        const content = r.content.length > 300 ? r.content.slice(0, 297) + "…" : r.content;
        lines.push(`   Content: ${content}`);
      }
      lines.push("");
    }

    lines.push(`---`);
    lines.push(`Provider: ${metadata.provider}`);
    lines.push(`Results: ${results.length}`);
    lines.push(`Query time: ${metadata.queryTime}ms`);
    lines.push(`Providers tried: ${metadata.providersTried}`);

    return lines.join("\n").trimEnd();
  }

  function formatJSON(
    query: string,
    results: SearchResult[],
    metadata: {
      provider: string;
      queryTime: number;
      providersTried: number;
    }
  ): string {
    return JSON.stringify(
      {
        query,
        provider: metadata.provider,
        providerPriority: providerPriority.filter((p) => p.enabled).map((p) => ({
          provider: p.provider,
          weight: p.weight,
          enabled: p.enabled,
        })),
        results: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          content: r.content,
          age: r.age,
          provider: r.provider,
        })),
        totalResults: results.length,
        queryTime: metadata.queryTime,
        providersTried: metadata.providersTried,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }

  function formatMarkdown(
    query: string,
    results: SearchResult[],
    metadata: {
      provider: string;
      queryTime: number;
      providersTried: number;
    }
  ): string {
    if (results.length === 0) {
      return `# Search: "${query}"\n\nNo results found.`;
    }

    const lines: string[] = [
      `---`,
      `query: ${query}`,
      `provider: ${metadata.provider}`,
      `results_count: ${results.length}`,
      `query_time_ms: ${metadata.queryTime}`,
      `timestamp: ${new Date().toISOString()}`,
      `---`,
      ``,
      `# Search Results`,
      ``,
    ];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`## ${i + 1}. ${r.title}`);
      lines.push(``);
      lines.push(`**URL**: ${r.url}`);
      lines.push(`**Source**: ${r.provider}`);
      if (r.age) lines.push(`**Age**: ${r.age}`);
      lines.push(``);
      lines.push(r.snippet);
      if (r.content) {
        lines.push(``);
        lines.push(`### Content`);
        lines.push(``);
        lines.push(r.content);
      }
      lines.push(``);
    }

    return lines.join("\n");
  }

  // ── Tool handlers ───────────────────────────────────────────────────────

  async function searchHandler(args: string[]): Promise<ToolResult> {
    const USAGE =
      "Usage:\n" +
      "  websearch search <query>                    — Search web (tries providers in priority order)\n" +
      "  websearch search <query> --provider <name> — Use specific provider\n" +
      "  websearch search <query> --count <n>       — Limit results (default: 10)\n" +
      "  websearch search <query> --format <fmt>    — Format: readable, json, markdown\n" +
      "  websearch answer <query>                    — Get AI-generated direct answer\n" +
      "  websearch extract <url>                     — Extract content from URL\n" +
      "\n" +
      "Environment variables:\n" +
      "  TAVILY_API_KEY       — Tavily API key\n" +
      "  BRAVE_API_KEY        — Brave API key\n" +
      "  EXA_API_KEY          — Exa API key\n" +
      "  WEBSEARCHAPI_KEY      — WebSearchAPI key";

    if (args.length === 0) {
      return { output: USAGE, exitCode: 1 };
    }

    const command = args[0];

    try {
      if (command === "search") {
        const queryArgs = args.slice(1);
        let provider: string | undefined;
        let count: number | undefined;
        let format: string | undefined;
        let queryWords: string[] = [];

        for (let i = 0; i < queryArgs.length; i++) {
          switch (queryArgs[i]) {
            case "--provider":
              provider = queryArgs[++i];
              break;
            case "--count":
              count = parseInt(queryArgs[++i]);
              if (isNaN(count) || count < 1) {
                return { output: "Error: --count must be a positive integer", exitCode: 1 };
              }
              break;
            case "--format":
              format = queryArgs[++i];
              if (
!["readable", "json", "markdown"].includes(format || "")
) {
                return { output: "Error: --format must be one of: readable, json, markdown", exitCode: 1 };
              }
              break;
            default:
              queryWords.push(queryArgs[i]);
          }
        }

        const query = queryWords.join(" ").trim();
        if (!query) {
          return { output: "Error: search query cannot be empty", exitCode: 1 };
        }

        const startTime = Date.now();

        let results: SearchResult[];
        if (provider) {
          // Use specific provider
          const providerConfig = PROVIDERS[provider];
          if (!providerConfig) {
            return { output: `Error: Unknown provider: ${provider}`, exitCode: 1 };
          }

          switch (provider) {
            case "tavily":
              results = await searchTavily(query, { count: count || maxResults, content: enableLocalExtraction });
              break;
            case "brave":
              results = await searchBrave(query, { count: count || maxResults, content: enableLocalExtraction });
              break;
            default:
              return { output: `Error: Provider ${provider} not implemented yet`, exitCode: 1 };
          }
        } else {
          // Use fallback
          results = await searchWithFallback(query);
        }

        const queryTime = Date.now() - startTime;
        const outputFormat = format || defaultFormat;

        return {
          output:
            outputFormat === "json"
              ? formatJSON(query, results, { provider: provider || "fallback", queryTime, providersTried: 1 })
              : outputFormat === "markdown"
                ? formatMarkdown(query, results, { provider: provider || "fallback", queryTime, providersTried: 1 })
                : formatReadable(query, results, { provider: provider || "fallback", queryTime, providersTried: 1 }),
          exitCode: 0,
        };
      } else if (command === "answer") {
        if (args.length < 2) {
          return { output: "Error: answer requires a query", exitCode: 1 };
        }

        const query = args.slice(1).join(" ");
        const startTime = Date.now();

        // Try Tavily for answers
        const result = await answerTavily(query);

        const queryTime = Date.now() - startTime;

        const output = `Answer:\n\n${result.answer}\n\nSources:\n${result.citations.map((c, i) => `${i + 1}. ${c.title} - ${c.url}`).join("\n")}\n\n(Query time: ${queryTime}ms)`;

        return { output, exitCode: 0 };
      } else if (command === "extract") {
        if (args.length < 2) {
          return { output: "Error: extract requires a URL", exitCode: 1 };
        }

        const url = args[1];
        const startTime = Date.now();

        const extracted = await extractUrl(url);
        const queryTime = Date.now() - startTime;

        const output =
          (extracted.title ? `# ${extracted.title}\n\n` : "") + extracted.content + `\n\n(Extracted in ${queryTime}ms)`;

        return { output, exitCode: 0 };
      } else {
        return { output: `Error: Unknown command: ${command}`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.error(`Websearch failed: ${msg}`);
      return { output: `Error: ${msg}`, exitCode: 1 };
    }
  }

  // ── Plugin instance ─────────────────────────────────────────────────────

  return {
    register(reg: PluginRegistrar): void {
      reg.tool({
        name: "websearch",
        description:
          "Multi-provider web search with provider priority, automatic fallback, " +
          "local content extraction (Mozilla Readability), and AI-optimized output formats. " +
          "Supports Tavily and Brave Search.",
        commands: [
          "search <query>                           — Search web (tries providers in priority order)",
          "search <query> --provider <name>         — Use specific provider (tavily, brave)",
          "search <query> --count <n>               — Limit results (default: 10)",
          "search <query> --format <fmt>           — Format: readable, json, markdown",
          "answer <query>                            — Get AI-generated direct answer (Tavily)",
          "extract <url>                             — Extract content from URL (local)",
        ],
        handler: searchHandler,
      });
    },

    async start(): Promise<void> {
      const configuredProviders = providerPriority.filter((p) => p.enabled).map((p) => PROVIDERS[p.provider].name);
      ctx.log.info(
        `Websearch plugin ready. Configured providers: ${configuredProviders.join(", ") || "none"}`
      );
    },

    async stop(): Promise<void> {
      // Cleanup
      cache.clear();
      circuitBreakers.forEach((cb) => cb.reset());
    },
  };
}

// ── Custom error class ───────────────────────────────────────────────────────

class AggregateSearchError extends Error {
  public readonly errors: SearchError[];

  constructor(message: string, errors: SearchError[]) {
    super(message);
    this.name = "AggregateSearchError";
    this.errors = errors;
  }
}

// Make SearchError a proper Error class
interface SearchErrorConstructor {
  new (message: string, type: SearchErrorType, provider: string, retryable: boolean, statusCode?: number, details?: string): SearchError;
}

const SearchError: SearchErrorConstructor = class extends Error implements SearchError {
  type: SearchErrorType;
  provider: string;
  retryable: boolean;
  statusCode?: number;
  details?: string;

  constructor(
    message: string,
    type: SearchErrorType,
    provider: string,
    retryable: boolean,
    statusCode?: number,
    details?: string
  ) {
    super(message);
    this.name = "SearchError";
    this.type = type;
    this.provider = provider;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.details = details;
  }
} as any;
