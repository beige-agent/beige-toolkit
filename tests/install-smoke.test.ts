import { describe, it, expect, afterAll } from "vitest";
import { resolve } from "path";
import { existsSync, cpSync, rmSync, readdirSync, readFileSync, statSync } from "fs";
import { tmpdir } from "os";

const TOOLKIT_ROOT = resolve(import.meta.dirname, "..");

/**
 * Simulates what beige does when installing from npm:
 * - copies the published files to a temp directory (excluding node_modules/.git)
 * - validates that all tools are discoverable and importable from the copy
 *
 * This checks the installable artifact shape without needing a running Beige.
 */
describe("install smoke", () => {
  const tmpPath = resolve(tmpdir(), `beige-toolkit-smoke-${Date.now()}`);

  afterAll(() => {
    try {
      rmSync(tmpPath, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("toolkit root can be copied to a temp install path", () => {
    cpSync(TOOLKIT_ROOT, tmpPath, {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
    });
    expect(existsSync(resolve(tmpPath, "tools"))).toBe(true);
  });

  it("all tools are discoverable from the install path", () => {
    const toolsDir = resolve(tmpPath, "tools");
    const toolDirs = readdirSync(toolsDir)
      .map((e) => resolve(toolsDir, e))
      .filter((p) => statSync(p).isDirectory())
      .filter((p) => existsSync(resolve(p, "tool.json")));

    expect(toolDirs.length).toBeGreaterThan(0);

    for (const toolDir of toolDirs) {
      const raw = readFileSync(resolve(toolDir, "tool.json"), "utf-8");
      const manifest = JSON.parse(raw);
      expect(typeof manifest.name).toBe("string");
      expect(typeof manifest.target).toBe("string");
    }
  });

  it("all tool handlers are importable from the install path", async () => {
    const toolsDir = resolve(tmpPath, "tools");
    const toolDirs = readdirSync(toolsDir)
      .map((e) => resolve(toolsDir, e))
      .filter((p) => statSync(p).isDirectory())
      .filter((p) => existsSync(resolve(p, "tool.json")));

    for (const toolDir of toolDirs) {
      const handlerPath = resolve(toolDir, "index.ts");
      expect(existsSync(handlerPath)).toBe(true);

      const mod = await import(handlerPath);
      expect(typeof mod.createHandler).toBe("function");
    }
  });
});
