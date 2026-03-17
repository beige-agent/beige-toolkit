import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { loadToolkitManifest } from "../test-utils/loadToolkitManifest.js";
import { assertValidToolkitManifest } from "../test-utils/assertions.js";

const TOOLKIT_ROOT = resolve(import.meta.dirname, "..");

describe("toolkit.json", () => {
  it("exists and is valid", () => {
    const manifest = loadToolkitManifest(TOOLKIT_ROOT);
    assertValidToolkitManifest(manifest);
  });

  it("has the correct name", () => {
    const manifest = loadToolkitManifest(TOOLKIT_ROOT);
    expect(manifest.name).toBe("beige-toolkit");
  });

  it("has a semver-shaped version", () => {
    const manifest = loadToolkitManifest(TOOLKIT_ROOT);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has at least one tool path", () => {
    const manifest = loadToolkitManifest(TOOLKIT_ROOT);
    expect(manifest.tools.length).toBeGreaterThan(0);
  });

  it("all tool paths start with ./tools/", () => {
    const manifest = loadToolkitManifest(TOOLKIT_ROOT);
    for (const toolPath of manifest.tools) {
      expect(toolPath).toMatch(/^\.\/tools\//);
    }
  });
});
