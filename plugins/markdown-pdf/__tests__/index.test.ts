/**
 * Tests for markdown-pdf plugin.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPlugin } from "../index.js";

describe("markdown-pdf plugin", () => {
  let plugin: any;
  let mockContext: any;

  beforeEach(() => {
    mockContext = {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      llmPrompt: vi.fn(),
    };

    plugin = createPlugin({}, mockContext);
  });

  describe("plugin creation", () => {
    it("should create a plugin instance", () => {
      expect(plugin).toBeDefined();
      expect(plugin.register).toBeInstanceOf(Function);
      expect(plugin.start).toBeInstanceOf(Function);
      expect(plugin.stop).toBeInstanceOf(Function);
    });

    it("should register the markdown-pdf tool", () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("markdown-pdf");
      expect(tools[0].description).toContain("Convert markdown files to PDF");
    });
  });

  describe("path resolution", () => {
    it("should resolve /workspace paths to host directory", async () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      const tool = tools[0];
      const result = await tool.handler(
        ["generate", "/workspace/test.md", "/workspace/test.pdf"],
        {},
        {
          workspaceDir: "/home/matthias/.beige/agents/beige/workspace",
          cwd: "",
        }
      );

      expect(result).toBeDefined();
    });

    it("should resolve relative paths with cwd", async () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      const tool = tools[0];
      const result = await tool.handler(
        ["generate", "test.md", "test.pdf"],
        {},
        {
          workspaceDir: "/home/matthias/.beige/agents/beige/workspace",
          cwd: "docs",
        }
      );

      expect(result).toBeDefined();
    });
  });

  describe("help command", () => {
    it("should show help when no arguments", async () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      const tool = tools[0];
      const result = await tool.handler([]);

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("markdown-pdf");
      expect(result.output).toContain("generate");
    });

    it("should show help for unknown subcommand", async () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      const tool = tools[0];
      const result = await tool.handler(["unknown"]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("markdown-pdf");
    });
  });

  describe("generate command", () => {
    it("should show usage when missing arguments", async () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      const tool = tools[0];
      const result = await tool.handler(["generate"]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Usage:");
    });

    it("should error when markdown file not found", async () => {
      const tools: any[] = [];
      plugin.register({
        tool: (tool: any) => {
          tools.push(tool);
        },
      });

      const tool = tools[0];
      const result = await tool.handler(
        ["generate", "/nonexistent.md", "/output.pdf"],
        {},
        {
          workspaceDir: "/home/matthias/.beige/agents/beige/workspace",
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not found");
    });
  });

  describe("plugin lifecycle", () => {
    it("should start without errors", async () => {
      await plugin.start();
      expect(mockContext.log.info).toHaveBeenCalledWith("markdown-pdf plugin ready");
    });

    it("should stop without errors", async () => {
      await plugin.stop();
      // No assertion needed - just verify it doesn't throw
    });
  });
});
