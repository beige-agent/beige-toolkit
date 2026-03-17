import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, cpSync, rmSync } from "fs";
import { loadToolkitManifest, loadToolManifest } from "../test-utils/loadToolkitManifest.js";
import { createTempDir } from "../test-utils/createTempDir.js";

const TOOLKIT_ROOT = resolve(import.meta.dirname, "..");

/**
 * Simulates what beige does when installing a toolkit from npm:
 * - copies the published files to a temp directory
 * - validates the toolkit.json and tool manifests from that copy
 *
 * This checks the installable artifact shape without needing a running Beige.
 */
describe("install smoke", () => {
  const tmp = createTempDir("beige-toolkit-install-smoke");

  afterEach(() => {
    // Don't cleanup between tests — we reuse the same simulated install dir.
  });

  it("toolkit root can be copied to a temp install path", () => {
    cpSync(TOOLKIT_ROOT, tmp.path, {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
    });
    expect(existsSync(resolve(tmp.path, "toolkit.json"))).toBe(true);
  });

  it("toolkit.json is loadable from the install path", () => {
    const manifest = loadToolkitManifest(tmp.path);
    expect(manifest.name).toBe("beige-toolkit");
  });

  it("all tool paths resolve from the install path", () => {
    const manifest = loadToolkitManifest(tmp.path);
    for (const toolRelPath of manifest.tools) {
      const toolAbsPath = resolve(tmp.path, toolRelPath);
      expect(existsSync(toolAbsPath)).toBe(true);
    }
  });

  it("all tool manifests are loadable from the install path", () => {
    const manifest = loadToolkitManifest(tmp.path);
    for (const toolRelPath of manifest.tools) {
      const toolAbsPath = resolve(tmp.path, toolRelPath);
      const toolManifest = loadToolManifest(toolAbsPath);
      expect(typeof toolManifest.name).toBe("string");
    }
  });

  it("all tool handlers are importable from the install path", async () => {
    const manifest = loadToolkitManifest(tmp.path);
    for (const toolRelPath of manifest.tools) {
      const toolAbsPath = resolve(tmp.path, toolRelPath);
      const handlerPath = resolve(toolAbsPath, "index.ts");
      expect(existsSync(handlerPath)).toBe(true);

      const mod = await import(handlerPath);
      expect(typeof mod.createHandler).toBe("function");
    }
  });

  // Cleanup after all tests in this suite.
  it("cleanup", () => {
    tmp.cleanup();
    expect(existsSync(tmp.path)).toBe(false);
  });
});
