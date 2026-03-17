import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";
import { loadToolkitManifest, loadToolManifest } from "../test-utils/loadToolkitManifest.js";
import { assertValidToolManifest } from "../test-utils/assertions.js";

const TOOLKIT_ROOT = resolve(import.meta.dirname, "..");

describe("toolkit discovery", () => {
  const manifest = loadToolkitManifest(TOOLKIT_ROOT);

  for (const toolRelPath of manifest.tools) {
    const toolAbsPath = resolve(TOOLKIT_ROOT, toolRelPath);
    const toolName = toolRelPath.split("/").pop()!;

    describe(`tool: ${toolName}`, () => {
      it("directory exists", () => {
        expect(existsSync(toolAbsPath)).toBe(true);
      });

      it("tool.json exists", () => {
        expect(existsSync(resolve(toolAbsPath, "tool.json"))).toBe(true);
      });

      it("tool.json is valid", () => {
        const toolManifest = loadToolManifest(toolAbsPath);
        assertValidToolManifest(toolManifest);
      });

      it("index.ts exists", () => {
        expect(existsSync(resolve(toolAbsPath, "index.ts"))).toBe(true);
      });

      it("README.md exists", () => {
        expect(existsSync(resolve(toolAbsPath, "README.md"))).toBe(true);
      });
    });
  }
});
