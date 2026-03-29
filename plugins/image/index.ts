/**
 * Image plugin for Beige.
 *
 * Provides image analysis:
 *
 *   image analyze <path> [--prompt "..."]
 *     Read a local image file and return a description from a vision-capable LLM.
 *     Useful when the calling agent's own model does not support vision (e.g. GLM).
 *
 * Config (set via plugins.image.config in beige config):
 *   analyzeProvider    — Required. Name of the llm.providers entry used for vision analysis.
 *   analyzeModel       — Required. Model ID to use for analysis (e.g. "claude-sonnet-4-5").
 *   timeoutSeconds     — Optional. Not currently used (reserved for future generation support).
 *
 * Image analysis uses ctx.llmPrompt() — the gateway's direct LLM access — so all
 * credential types (API keys, OAuth tokens, env vars) work transparently. No
 * protocol-specific code is needed; the gateway handles Anthropic, OpenAI, Google, etc.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, extname, basename, join, isAbsolute } from "path";
import type {
  PluginInstance,
  PluginContext,
  PluginRegistrar,
  ToolResult,
  LlmMessage,
} from "@matthias-hausberger/beige";

/**
 * Minimal subset of SessionContext used by this plugin.
 * Defined locally (same pattern as the github plugin) because SessionContext
 * is not re-exported from the public beige package index.
 */
interface SessionContext {
  /** Absolute path to the agent's workspace directory on the gateway host. */
  workspaceDir?: string;
  /**
   * Relative working directory within the workspace.
   * Set when the agent invokes the tool from a subdirectory of /workspace.
   */
  cwd?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

interface ImageConfig {
  /** Provider name (key in llm.providers) to use for image analysis. Required. */
  analyzeProvider: string;
  /** Model ID for image analysis (e.g. "claude-sonnet-4-5"). Required. */
  analyzeModel: string;
}

// ── Supported image MIME types ────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function mimeForPath(filePath: string): string | undefined {
  return IMAGE_MIME[extname(filePath).toLowerCase()];
}

// ── Plugin entry point ────────────────────────────────────────────────────────

export function createPlugin(
  config: Record<string, unknown>,
  ctx: PluginContext
): PluginInstance {
  const cfg = config as unknown as ImageConfig;

  // ── Validate required config ─────────────────────────────────────────

  if (!cfg.analyzeProvider || !cfg.analyzeModel) {
    ctx.log.warn(
      "Image plugin: analyzeProvider and analyzeModel are required. " +
        "Image analysis will fail until both are configured."
    );
  }

  // ── Path resolution ──────────────────────────────────────────────────

  /**
   * Resolve an image file path to an absolute host path.
   *
   * Agents running inside a sandbox see their workspace mounted at /workspace.
   * The gateway passes the host-side equivalent via sessionContext.workspaceDir.
   * This function performs three translations:
   *
   *   1. /workspace/...  →  <workspaceDir>/...
   *      Strip the sandbox mount prefix and rebase onto the host workspace root.
   *
   *   2. relative path   →  <workspaceDir>/<cwd>/<path>
   *      Relative paths are resolved against the agent's current working
   *      directory inside the workspace (sessionContext.cwd, if provided),
   *      then rebased onto the host workspace root.
   *
   *   3. absolute path (not /workspace) → used as-is
   *      Absolute paths that aren't under /workspace are assumed to already
   *      refer to a valid host path (e.g. when calling from the TUI directly).
   */
  function resolveImagePath(filePath: string, sessionContext?: SessionContext): string {
    const workspaceRoot = sessionContext?.workspaceDir;
    const sandboxMount = "/workspace";

    // Case 1: sandbox /workspace prefix
    if (filePath.startsWith(sandboxMount + "/") || filePath === sandboxMount) {
      const rel = filePath.slice(sandboxMount.length).replace(/^\//, "");
      return workspaceRoot ? join(workspaceRoot, rel) : resolve(rel);
    }

    // Case 2: relative path — resolve against workspaceDir + cwd
    if (!isAbsolute(filePath)) {
      if (workspaceRoot) {
        const cwd = sessionContext?.cwd ?? "";
        return join(workspaceRoot, cwd, filePath);
      }
      return resolve(filePath);
    }

    // Case 3: absolute non-workspace path — use as-is
    return filePath;
  }

  // ── analyze handler ───────────────────────────────────────────────────

  async function handleAnalyze(args: string[], sessionContext?: SessionContext): Promise<ToolResult> {
    const USAGE =
      "Usage:\n" +
      "  image analyze <path>\n" +
      "  image analyze <path> --prompt \"describe the chart in detail\"";

    if (args.length === 0) return { output: USAGE, exitCode: 1 };

    let filePath: string | undefined;
    let prompt = "Describe this image in detail.";

    let i = 0;
    while (i < args.length) {
      if (args[i] === "--prompt") {
        prompt = args[++i] ?? prompt;
      } else {
        filePath = args[i];
      }
      i++;
    }

    if (!filePath) return { output: "Error: no image path provided\n\n" + USAGE, exitCode: 1 };

    // Validate config
    if (!cfg.analyzeProvider || !cfg.analyzeModel) {
      return {
        output:
          "Error: image plugin is not configured for analysis.\n" +
          "Set analyzeProvider and analyzeModel in the plugin config.",
        exitCode: 1,
      };
    }

    const resolved = resolveImagePath(filePath, sessionContext);
    if (!existsSync(resolved)) {
      return { output: `Error: file not found: ${resolved}`, exitCode: 1 };
    }

    const mime = mimeForPath(resolved);
    if (!mime) {
      return {
        output:
          `Error: unsupported image type for "${basename(resolved)}". ` +
          `Supported: ${Object.keys(IMAGE_MIME).join(", ")}`,
        exitCode: 1,
      };
    }

    const imageBase64 = readFileSync(resolved).toString("base64");
    const start = Date.now();

    ctx.log.info(
      `analyze: ${basename(resolved)} (${mime}) via ${cfg.analyzeProvider}/${cfg.analyzeModel}`
    );

    try {
      // Build a vision message with both the image and the text prompt
      const message: LlmMessage = {
        role: "user",
        content: [
          { type: "image", data: imageBase64, mimeType: mime },
          { type: "text", text: prompt },
        ],
      };

      const result = await ctx.llmPrompt(
        cfg.analyzeProvider,
        cfg.analyzeModel,
        [message],
      );

      ctx.log.info(`analyze: done in ${Date.now() - start}ms`);
      return { output: result, exitCode: 0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.error(`analyze failed: ${msg}`);
      return { output: `Image analysis failed: ${msg}`, exitCode: 1 };
    }
  }

  // ── Main tool handler ─────────────────────────────────────────────────

  async function handler(
    args: string[],
    _config?: Record<string, unknown>,
    sessionContext?: SessionContext
  ): Promise<ToolResult> {
    const subcommand = args[0];
    const rest = args.slice(1);

    switch (subcommand) {
      case "analyze":
        return handleAnalyze(rest, sessionContext);
      default: {
        const lines = [
          "image — image analysis tool",
          "",
          "Commands:",
          "  image analyze <path> [--prompt \"...\"]",
          "      Analyze a local image file using a vision-capable LLM.",
          "      Returns a text description.",
        ];
        return { output: lines.join("\n"), exitCode: subcommand ? 1 : 0 };
      }
    }
  }

  // ── Plugin instance ───────────────────────────────────────────────────

  return {
    register(reg: PluginRegistrar): void {
      reg.tool({
        name: "image",
        description:
          "Analyze local image files using a vision-capable LLM. " +
          "Useful when the calling agent's model does not support vision.",
        commands: [
          "analyze <path>                          — Analyze a local image, returns description",
          "analyze <path> --prompt \"<question>\"     — Ask a specific question about the image",
        ],
        handler,
      });
    },

    async start(): Promise<void> {
      const analyzeInfo = cfg.analyzeProvider
        ? `${cfg.analyzeProvider}/${cfg.analyzeModel}`
        : "NOT CONFIGURED";

      ctx.log.info(`Image plugin ready — analyze: ${analyzeInfo}`);
    },

    async stop(): Promise<void> {
      // nothing to tear down
    },
  };
}
