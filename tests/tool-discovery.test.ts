import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";

const TOOLKIT_ROOT = resolve(import.meta.dirname, "..");
const TOOLS_DIR = resolve(TOOLKIT_ROOT, "tools");

interface ToolManifest {
  name: string;
  description: string;
  commands?: string[];
  target: "gateway" | "sandbox";
}

function discoverToolDirs(): string[] {
  return readdirSync(TOOLS_DIR)
    .map((entry) => resolve(TOOLS_DIR, entry))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => existsSync(resolve(p, "tool.json")));
}

function loadToolManifest(toolPath: string): ToolManifest {
  const raw = readFileSync(resolve(toolPath, "tool.json"), "utf-8");
  return JSON.parse(raw);
}

describe("tool discovery", () => {
  const toolDirs = discoverToolDirs();

  it("finds at least one tool", () => {
    expect(toolDirs.length).toBeGreaterThan(0);
  });

  for (const toolDir of toolDirs) {
    const toolName = toolDir.split("/").pop()!;

    describe(`tool: ${toolName}`, () => {
      it("tool.json is valid", () => {
        const manifest = loadToolManifest(toolDir);
        expect(typeof manifest.name).toBe("string");
        expect(manifest.name.length).toBeGreaterThan(0);
        expect(typeof manifest.description).toBe("string");
        expect(manifest.description.length).toBeGreaterThan(0);
        expect(["gateway", "sandbox"]).toContain(manifest.target);
      });

      it("index.ts exists", () => {
        expect(existsSync(resolve(toolDir, "index.ts"))).toBe(true);
      });

      it("README.md exists", () => {
        expect(existsSync(resolve(toolDir, "README.md"))).toBe(true);
      });

      it("package.json exists", () => {
        expect(existsSync(resolve(toolDir, "package.json"))).toBe(true);
      });

      it("handler is importable and exports createHandler", async () => {
        const mod = await import(resolve(toolDir, "index.ts"));
        expect(typeof mod.createHandler).toBe("function");
      });
    });
  }
});
