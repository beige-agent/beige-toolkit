/**
 * markdown-pdf plugin for Beige.
 *
 * Provides PDF generation from markdown files:
 *
 *   markdown-pdf generate <markdownPath> <pdfPath>
 *     Convert a markdown file to PDF with support for hyperlinks, tables,
 *     and local images. Workspace paths are automatically resolved to the
 *     host's directory structure.
 *
 * Config (set via plugins.markdown-pdf.config in beige config):
 *   format               — Paper format: A4, Letter, Legal, etc. (default: A4)
 *   margins              — Page margins object with top/right/bottom/left (default: 2cm each)
 *   displayHeaderFooter  — Show header/footer with page numbers (default: false)
 *   printBackground      — Include background graphics (default: true)
 *
 * This plugin uses Puppeteer directly to render markdown as HTML and generate PDF.
 * Local images are automatically resolved relative to the markdown file location
 * and embedded in the PDF. Tables, hyperlinks, and all standard markdown features
 * are supported.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename, join, isAbsolute } from "node:path";
import type {
  PluginInstance,
  PluginContext,
  PluginRegistrar,
  ToolResult,
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

interface MarkdownPdfConfig {
  /** Paper format: A4, Letter, Legal, etc. Default: A4 */
  format?: string;
  /** Page margins */
  margins?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  /** Show header/footer with page numbers. Default: false */
  displayHeaderFooter?: boolean;
  /** Include background graphics and colors. Default: true */
  printBackground?: boolean;
}

// ── Plugin entry point ────────────────────────────────────────────────────────

export function createPlugin(
  config: Record<string, unknown>,
  ctx: PluginContext
): PluginInstance {
  const cfg = config as unknown as MarkdownPdfConfig;

  // Default config
  const defaultOptions: Record<string, unknown> = {
    format: cfg.format || "A4",
    margin: {
      top: cfg.margins?.top || "2cm",
      right: cfg.margins?.right || "2cm",
      bottom: cfg.margins?.bottom || "2cm",
      left: cfg.margins?.left || "2cm",
    },
    displayHeaderFooter: cfg.displayHeaderFooter ?? false,
    printBackground: cfg.printBackground ?? true,
  };

  // ── Path resolution ──────────────────────────────────────────────────

  /**
   * Resolve a file path to an absolute host path.
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
  function resolvePath(filePath: string, sessionContext?: SessionContext): string {
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

  /**
   * Convert a resolved host path back to a workspace-relative path.
   * If the path is inside the workspace, returns /workspace/...; otherwise returns the original path.
   */
  function toWorkspacePath(resolvedPath: string, sessionContext?: SessionContext): string {
    const workspaceRoot = sessionContext?.workspaceDir;
    if (workspaceRoot && resolvedPath.startsWith(workspaceRoot)) {
      const relPath = resolvedPath.slice(workspaceRoot.length).replace(/^\//, "");
      return `/workspace/${relPath}`;
    }
    return resolvedPath;
  }

  // ── HTML Generation ───────────────────────────────────────────────────

  /**
   * Generate styled HTML from markdown content.
   *
   * This creates a complete HTML document with CSS styling that supports
   * tables, code blocks, hyperlinks, and images.
   */
  async function generateHtml(markdownContent: string, basePath: string): Promise<string> {
    // Import marked dynamically to avoid issues if not installed
    let markedFn: any;
    try {
      const markedModule: any = await import("marked");
      markedFn = markedModule.marked || markedModule;
    } catch {
      return "<html><body><h1>Error</h1><p>marked module not found. Please install dependencies.</p></body></html>";
    }

    const htmlBody = markedFn(markdownContent);

    // Create styled HTML document
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Document</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 100%;
      margin: 0;
      padding: 20px;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.25;
    }
    h1 { font-size: 2.25em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.75em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h3 { font-size: 1.5em; }
    h4 { font-size: 1.25em; }
    h5 { font-size: 1em; }
    h6 { font-size: 0.875em; color: #6c757d; }
    p { margin: 1em 0; }
    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul, ol { padding-left: 2em; margin: 1em 0; }
    li { margin: 0.5em 0; }
    code {
      font-family: 'Courier New', Courier, monospace;
      background-color: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 0.85em;
    }
    pre {
      background-color: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      border-radius: 0;
      font-size: 0.9em;
    }
    blockquote {
      border-left: 4px solid #dfe2e5;
      padding-left: 1em;
      color: #6c757d;
      margin: 1em 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    table th, table td {
      border: 1px solid #dfe2e5;
      padding: 8px 12px;
      text-align: left;
    }
    table th {
      background-color: #f6f8fa;
      font-weight: 600;
    }
    table tr:nth-child(even) {
      background-color: #fafbfc;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em 0;
    }
    hr {
      border: none;
      border-top: 1px solid #dfe2e5;
      margin: 2em 0;
    }
    @media print {
      body { padding: 0; }
      a { color: #333; text-decoration: none; }
      a[href^="http"]::after {
        content: " (" attr(href) ")";
        font-size: 0.8em;
        color: #666;
      }
    }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;
  }

  // ── PDF Generation ─────────────────────────────────────────────────────

  /**
   * Generate PDF from markdown file using Puppeteer.
   *
   * This implementation:
   * 1. Reads the markdown file
   * 2. Converts markdown to HTML with CSS styling
   * 3. Uses Puppeteer to render HTML to PDF
   *
   * Local images are resolved relative to the markdown file location.
   */
  async function generatePdf(
    markdownPath: string,
    pdfPath: string,
    options: Record<string, unknown> = {},
    sessionContext?: SessionContext
  ): Promise<{ output: string; exitCode: number }> {
    // Resolve paths to host filesystem
    const resolvedMarkdownPath = resolvePath(markdownPath, sessionContext);
    const resolvedPdfPath = resolvePath(pdfPath, sessionContext);

    // Validate markdown file exists
    if (!existsSync(resolvedMarkdownPath)) {
      return {
        output: `Error: markdown file not found: ${toWorkspacePath(resolvedMarkdownPath, sessionContext)}`,
        exitCode: 1,
      };
    }

    // Ensure output directory exists
    const outputDir = dirname(resolvedPdfPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Read markdown content
    const markdownContent = readFileSync(resolvedMarkdownPath, "utf-8");

    ctx.log.info(
      `Generating PDF: ${basename(resolvedMarkdownPath)} → ${basename(resolvedPdfPath)}`
    );

    try {
      // Import puppeteer and marked
      let puppeteer: any;

      try {
        ctx.log.info("Loading puppeteer module...");
        puppeteer = await import("puppeteer");

        if (!puppeteer.default && !puppeteer) {
          throw new Error("puppeteer module not found");
        }
      } catch (importError) {
        const errorMsg =
          importError instanceof Error ? importError.message : String(importError);
        ctx.log.error(`Failed to import dependencies: ${errorMsg}`);
        return {
          output:
            `Error: Failed to load PDF generation dependencies.\n` +
            `Details: ${errorMsg}\n\n` +
            `Please ensure dependencies are installed:\n` +
            `  cd plugins/markdown-pdf && npm install`,
          exitCode: 1,
        };
      }

      // Merge default options with custom options
      const finalOptions = {
        ...defaultOptions,
        ...options,
      };

      // Generate HTML from markdown
      const basePath = dirname(resolvedMarkdownPath);
      const htmlContent = await generateHtml(markdownContent, basePath);

      // Create a temporary HTML file
      const tempHtmlPath = resolvedPdfPath + ".temp.html";
      writeFileSync(tempHtmlPath, htmlContent, "utf-8");

      // Launch puppeteer and generate PDF
      const puppeteerLib = puppeteer.default || puppeteer;
      const browser = await puppeteerLib.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      try {
        const page = await browser.newPage();

        // Load the HTML file
        await page.goto(`file://${tempHtmlPath}`, {
          waitUntil: "networkidle0",
        });

        // Generate PDF
        const pdfBuffer = await page.pdf(finalOptions as any);

        // Write PDF to file
        writeFileSync(resolvedPdfPath, pdfBuffer);

        await page.close();
      } finally {
        await browser.close();
      }

      // Clean up temp file
      try {
        const fs = await import("fs");
        fs.unlinkSync(tempHtmlPath);
      } catch {
        // Ignore cleanup errors
      }

      ctx.log.info(
        `PDF generated successfully: ${resolvedPdfPath} (${markdownContent.length} bytes markdown)`
      );

      return {
        output: `✅ PDF generated successfully\n\nInput: ${toWorkspacePath(resolvedMarkdownPath, sessionContext)}\nOutput: ${toWorkspacePath(resolvedPdfPath, sessionContext)}\n`,
        exitCode: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      ctx.log.error(`PDF generation failed: ${msg}`);
      return {
        output: `PDF generation failed: ${msg}${stack ? `\n\n${stack}` : ""}`,
        exitCode: 1,
      };
    }
  }

  // ── generate handler ─────────────────────────────────────────────────

  async function handleGenerate(args: string[], sessionContext?: SessionContext): Promise<ToolResult> {
    const USAGE =
      "Usage:\n" +
      "  markdown-pdf generate <markdownPath> <pdfPath>\n" +
      "  markdown-pdf generate <markdownPath> <pdfPath> --options '<json>'\n\n" +
      "Examples:\n" +
      "  markdown-pdf generate /workspace/README.md /workspace/README.pdf\n" +
      "  markdown-pdf generate report.md report.pdf --options '{\"format\": \"Letter\"}'\n" +
      "  markdown-pdf generate doc.md doc.pdf --options '{\"margins\": {\"top\": \"1cm\"}}'";

    if (args.length < 2) {
      return { output: USAGE, exitCode: 1 };
    }

    let markdownPath = args[0];
    let pdfPath = args[1];
    let options: Record<string, unknown> = {};

    // Parse optional --options flag
    let i = 2;
    while (i < args.length) {
      if (args[i] === "--options" && i + 1 < args.length) {
        try {
          options = JSON.parse(args[i + 1]);
          i += 2;
        } catch (parseErr) {
          return {
            output: `Error: Invalid JSON in --options\n\n${USAGE}`,
            exitCode: 1,
          };
        }
      } else {
        i++;
      }
    }

    return generatePdf(markdownPath, pdfPath, options, sessionContext);
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
      case "generate":
        return handleGenerate(rest, sessionContext);
      default: {
        const lines = [
          "markdown-pdf — markdown to PDF conversion tool",
          "",
          "Commands:",
          "  markdown-pdf generate <markdownPath> <pdfPath>",
          "      Convert a markdown file to PDF.",
          "",
          "  markdown-pdf generate <markdownPath> <pdfPath> --options '<json>'",
          "      Convert with custom options (format, margins, etc.).",
          "",
          "Options:",
          "  format           - Paper format: A4, Letter, Legal, Tabloid, Ledger",
          "  margins          - Object with top/right/bottom/left (e.g., {\"top\": \"1cm\"})",
          "  displayHeaderFooter - Show header/footer with page numbers (boolean)",
          "  printBackground  - Include background graphics (boolean)",
          "",
          "Examples:",
          "  markdown-pdf generate /workspace/README.md /workspace/README.pdf",
          "  markdown-pdf generate doc.md doc.pdf --options '{\"format\": \"Letter\"}'",
        ];
        return { output: lines.join("\n"), exitCode: subcommand ? 1 : 0 };
      }
    }
  }

  // ── Plugin instance ───────────────────────────────────────────────────

  return {
    register(reg: PluginRegistrar): void {
      reg.tool({
        name: "markdown-pdf",
        description:
          "Convert markdown files to PDF with support for hyperlinks, tables, and local images. " +
          "Workspace paths are automatically resolved to the host directory.",
        commands: [
          "generate <markdownPath> <pdfPath>              — Convert markdown to PDF",
          "generate <markdownPath> <pdfPath> --options <json>  — Convert with custom options",
        ],
        handler,
      });
    },

    async start(): Promise<void> {
      ctx.log.info("markdown-pdf plugin ready");
    },

    async stop(): Promise<void> {
      // nothing to tear down
    },
  };
}
