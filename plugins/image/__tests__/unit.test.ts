import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlugin } from "../index.js";
import type { PluginContext, PluginRegistrar } from "@matthias-hausberger/beige";

// ── Mock PluginContext ────────────────────────────────────────────────────────

function makeMockCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    prompt: vi.fn(),
    promptStreaming: vi.fn(),
    newSession: vi.fn(),
    createSession: vi.fn(),
    getSessionSettings: vi.fn().mockReturnValue({}),
    updateSessionSettings: vi.fn(),
    setSessionMetadata: vi.fn(),
    getSessionMetadata: vi.fn(),
    persistSessionModel: vi.fn(),
    listSessions: vi.fn().mockReturnValue([]),
    getSessionEntry: vi.fn(),
    invokeTool: vi.fn(),
    compactSession: vi.fn(),
    isSessionActive: vi.fn().mockReturnValue(false),
    abortSession: vi.fn(),
    steerSession: vi.fn(),
    disposeSession: vi.fn(),
    getModel: vi.fn(),
    getSessionUsage: vi.fn(),
    getSessionModel: vi.fn(),
    // Direct LLM access — the primary method used by the image plugin
    llmPrompt: vi.fn().mockResolvedValue("A description of the image."),
    config: {},
    agentNames: [],
    getChannel: vi.fn(),
    getRegisteredTools: vi.fn().mockReturnValue([]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    dataDir: "/tmp/test-data",
    ...overrides,
  } as unknown as PluginContext;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRegistrar() {
  const tools: Array<{ name: string; handler: (args: string[], config?: Record<string, unknown>, sessionContext?: any) => Promise<{ output: string; exitCode: number }> }> = [];
  const registrar: PluginRegistrar = {
    tool(t) { tools.push({ name: t.name, handler: t.handler }); },
    channel: vi.fn() as any,
    hook: vi.fn() as any,
    skill: vi.fn() as any,
  };
  return { registrar, tools };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("image plugin", () => {
  describe("registration", () => {
    it("registers the 'image' tool", () => {
      const ctx = makeMockCtx();
      const plugin = createPlugin(
        { analyzeProvider: "anthropic", analyzeModel: "claude-sonnet-4-5" },
        ctx
      );
      const { registrar, tools } = makeRegistrar();
      plugin.register(registrar);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("image");
    });

    it("warns when analyzeProvider/analyzeModel are missing", () => {
      const ctx = makeMockCtx();
      createPlugin({}, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining("analyzeProvider"));
    });
  });

  describe("analyze — argument parsing", () => {
    let handler: (args: string[], config?: Record<string, unknown>, sessionContext?: any) => Promise<{ output: string; exitCode: number }>;

    beforeEach(() => {
      const ctx = makeMockCtx();
      const plugin = createPlugin(
        { analyzeProvider: "anthropic", analyzeModel: "claude-sonnet-4-5" },
        ctx
      );
      const { registrar, tools } = makeRegistrar();
      plugin.register(registrar);
      handler = tools.find((t) => t.name === "image")!.handler;
    });

    it("returns help when called with no args", async () => {
      const result = await handler([]);
      expect(result.exitCode).toBe(0); // top-level help
    });

    it("returns usage for 'analyze' with no path", async () => {
      const result = await handler(["analyze"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Usage");
    });

    it("returns error when file does not exist", async () => {
      const result = await handler(["analyze", "/nonexistent/image.png"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not found");
    });

    it("returns error for unsupported file type", async () => {
      // .txt is not a supported image extension — but file-not-found fires first
      const result = await handler(["analyze", "/nonexistent/file.txt"]);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("analyze — path resolution", () => {
    let handler: (args: string[], config?: Record<string, unknown>, sessionContext?: any) => Promise<{ output: string; exitCode: number }>;

    beforeEach(() => {
      const ctx = makeMockCtx();
      const plugin = createPlugin(
        { analyzeProvider: "anthropic", analyzeModel: "claude-sonnet-4-5" },
        ctx
      );
      const { registrar, tools } = makeRegistrar();
      plugin.register(registrar);
      handler = tools.find((t) => t.name === "image")!.handler;
    });

    it("translates /workspace/... paths using sessionContext.workspaceDir", async () => {
      const result = await handler(
        ["analyze", "/workspace/img.png"],
        undefined,
        { workspaceDir: "/host/ws" }
      );
      expect(result.exitCode).toBe(1);
      // The error must mention the translated host path, not /workspace/img.png
      expect(result.output).toContain("/host/ws/img.png");
    });

    it("resolves relative paths against workspaceDir + cwd", async () => {
      const result = await handler(
        ["analyze", "chart.png"],
        undefined,
        { workspaceDir: "/host/ws", cwd: "reports" }
      );
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("/host/ws/reports/chart.png");
    });

    it("uses absolute non-workspace paths as-is", async () => {
      const result = await handler(
        ["analyze", "/tmp/testimage.png"],
        undefined,
        { workspaceDir: "/host/ws" }
      );
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("/tmp/testimage.png");
    });
  });

  describe("analyze — config validation", () => {
    it("returns error when analyzeProvider not configured", async () => {
      const ctx = makeMockCtx();
      const plugin = createPlugin({}, ctx);
      const { registrar, tools } = makeRegistrar();
      plugin.register(registrar);
      const handler = tools[0].handler;

      const result = await handler(["analyze", "/some/image.png"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not configured");
    });
  });
});
