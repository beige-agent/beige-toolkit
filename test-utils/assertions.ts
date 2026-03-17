import { expect } from "vitest";
import type { ToolkitManifest, ToolManifest } from "./loadToolkitManifest.js";

/**
 * Assert that a toolkit manifest has all required fields.
 */
export function assertValidToolkitManifest(manifest: unknown): asserts manifest is ToolkitManifest {
  expect(manifest).toBeDefined();
  expect(typeof (manifest as ToolkitManifest).name).toBe("string");
  expect((manifest as ToolkitManifest).name.length).toBeGreaterThan(0);
  expect(typeof (manifest as ToolkitManifest).version).toBe("string");
  expect((manifest as ToolkitManifest).version.length).toBeGreaterThan(0);
  expect(Array.isArray((manifest as ToolkitManifest).tools)).toBe(true);
  expect((manifest as ToolkitManifest).tools.length).toBeGreaterThan(0);
}

/**
 * Assert that a tool manifest has all required fields.
 */
export function assertValidToolManifest(manifest: unknown): asserts manifest is ToolManifest {
  expect(manifest).toBeDefined();
  expect(typeof (manifest as ToolManifest).name).toBe("string");
  expect((manifest as ToolManifest).name.length).toBeGreaterThan(0);
  expect(typeof (manifest as ToolManifest).description).toBe("string");
  expect((manifest as ToolManifest).description.length).toBeGreaterThan(0);
  expect(["gateway", "sandbox"]).toContain((manifest as ToolManifest).target);
}

/**
 * Assert a tool result indicates success.
 */
export function assertSuccess(result: { output: string; exitCode: number }): void {
  expect(result.exitCode).toBe(0);
}

/**
 * Assert a tool result indicates failure.
 */
export function assertFailure(result: { output: string; exitCode: number }): void {
  expect(result.exitCode).not.toBe(0);
}
