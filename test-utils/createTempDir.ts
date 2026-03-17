import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface TempDir {
  path: string;
  cleanup(): void;
}

/**
 * Create a unique temporary directory for a test.
 * Call cleanup() in afterEach to remove it.
 */
export function createTempDir(prefix = "beige-toolkit-test"): TempDir {
  const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path, { recursive: true });

  return {
    path,
    cleanup() {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors — the OS will eventually clean temp dirs.
      }
    },
  };
}
