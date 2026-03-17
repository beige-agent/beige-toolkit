import { spawn } from "child_process";

// ToolHandler type is defined inline so this file is self-contained.
// It can be installed anywhere (e.g. ~/.beige/tools/github/) without needing
// the beige source tree.
type ToolHandler = (
  args: string[],
  config?: Record<string, unknown>
) => Promise<{ output: string; exitCode: number }>;

export type GhExecutor = (
  args: string[]
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Default set of top-level gh subcommands permitted when no allowedCommands
 * config is provided.
 *
 * Notably absent: "api" — raw API access (arbitrary HTTP methods + GraphQL
 * mutations) is considered elevated and must be explicitly opted into via
 * allowedCommands: ["api", ...] in the tool config.
 */
const ALL_COMMANDS = [
  "repo",
  "issue",
  "pr",
  "release",
  "run",
  "workflow",
  "gist",
  "org",
  "project",
  "auth",
  "browse",
  "cache",
  "codespace",
  "secret",
  "variable",
  "label",
  "milestone",
  "ruleset",
  "attestation",
] as const;

/**
 * Resolve which top-level gh subcommands are permitted for this tool instance.
 *
 * Config fields (both optional, strings or arrays of strings):
 *   allowedCommands  — whitelist; only these subcommands are permitted.
 *                      Defaults to ALL_COMMANDS when absent. Set explicitly
 *                      to include "api" if raw API access is needed.
 *   deniedCommands   — blacklist; these subcommands are always blocked,
 *                      even if present in allowedCommands.
 *
 * Precedence: deny beats allow.
 */
function resolveAllowedCommands(config: Record<string, unknown>): Set<string> {
  const toArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return [value];
    return [];
  };

  const allowed = new Set<string>(
    config.allowedCommands !== undefined
      ? toArray(config.allowedCommands)
      : ALL_COMMANDS
  );

  for (const cmd of toArray(config.deniedCommands)) {
    allowed.delete(cmd);
  }

  return allowed;
}

/**
 * Default executor: spawns the real gh CLI and returns its output.
 * Inherits the gateway process's environment so existing gh auth applies.
 */
export const defaultGhExecutor: GhExecutor = (args) =>
  new Promise((resolve) => {
    const proc = spawn("gh", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: `Failed to spawn gh: ${err.message}. Is the GitHub CLI installed on the gateway host?`,
        exitCode: 1,
      });
    });
  });

/**
 * GitHub Tool — Routes all commands to the gh CLI running on the gateway host.
 *
 * The tool assumes gh is installed and authenticated on the host. Authentication
 * state (e.g. ~/.config/gh/) is picked up automatically via the inherited
 * environment.
 *
 * Access control: allowedCommands and deniedCommands restrict which top-level
 * gh subcommands an agent may invoke.
 *
 * The optional second argument accepts a GhExecutor for dependency injection
 * in tests. Production callers omit it and get the real gh CLI.
 */
export function createHandler(
  config: Record<string, unknown>,
  { executor = defaultGhExecutor }: { executor?: GhExecutor } = {}
): ToolHandler {
  const allowedCommands = resolveAllowedCommands(config);

  return async (args: string[]) => {
    if (args.length === 0) {
      return {
        output: [
          "Usage: github <subcommand> [args...]",
          "",
          "Routes to the gh CLI on the gateway host. Examples:",
          "  github repo list",
          "  github issue list --repo owner/repo",
          "  github pr view 42 --repo owner/repo",
          "",
          `Permitted subcommands: ${[...allowedCommands].join(", ") || "(none)"}`,
        ].join("\n"),
        exitCode: 1,
      };
    }

    const [subcommand, ...rest] = args;

    // Access-control check — runs before any gh invocation.
    if (!allowedCommands.has(subcommand)) {
      const permitted = [...allowedCommands].join(", ") || "(none)";
      return {
        output: `Permission denied: subcommand '${subcommand}' is not allowed for this agent.\nPermitted subcommands: ${permitted}`,
        exitCode: 1,
      };
    }

    // Hard-blocked operations — these cannot be enabled by any config.
    if (subcommand === "repo" && rest[0] === "delete") {
      return {
        output: "Permission denied: 'repo delete' is permanently blocked. Repository deletion is not permitted through this tool.",
        exitCode: 1,
      };
    }

    const result = await executor([subcommand, ...rest]);

    // On success return stdout. On failure include both streams so the agent
    // can diagnose the problem.
    if (result.exitCode === 0) {
      return {
        output: result.stdout || "(no output)",
        exitCode: 0,
      };
    }

    const parts = [result.stdout, result.stderr].filter((s) => s.trim());
    return {
      output: parts.join("\n") || `gh exited with code ${result.exitCode}`,
      exitCode: result.exitCode,
    };
  };
}
