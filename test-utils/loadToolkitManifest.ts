import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export interface ToolkitManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  repository?: string;
  tools: string[];
}

export interface ToolManifest {
  name: string;
  description: string;
  commands?: string[];
  target: "gateway" | "sandbox";
}

/**
 * Load and parse toolkit.json from the given directory.
 * Throws if the file is missing or malformed.
 */
export function loadToolkitManifest(toolkitPath: string): ToolkitManifest {
  const manifestPath = resolve(toolkitPath, "toolkit.json");

  if (!existsSync(manifestPath)) {
    throw new Error(`toolkit.json not found at: ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, "utf-8");
  return JSON.parse(raw) as ToolkitManifest;
}

/**
 * Load and parse tool.json from the given tool directory.
 * Throws if the file is missing or malformed.
 */
export function loadToolManifest(toolPath: string): ToolManifest {
  const manifestPath = resolve(toolPath, "tool.json");

  if (!existsSync(manifestPath)) {
    throw new Error(`tool.json not found at: ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, "utf-8");
  return JSON.parse(raw) as ToolManifest;
}
