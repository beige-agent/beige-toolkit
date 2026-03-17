/**
 * Creates a minimal mock of the runtime context a Beige tool handler receives.
 *
 * Tools are plain functions — they don't get a "runtime object" directly.
 * This helper gives you a ready-to-call handler and a spy on the underlying
 * executor so you can assert what was invoked.
 */

export type ToolHandler = (
  args: string[],
  config?: Record<string, unknown>
) => Promise<{ output: string; exitCode: number }>;

export interface MockRuntime {
  /** Call the handler with the given args. */
  call(args: string[]): Promise<{ output: string; exitCode: number }>;
  /** All args arrays that were passed to the handler so far. */
  calls: string[][];
}

/**
 * Wrap a handler so you can inspect every invocation.
 */
export function createMockRuntime(handler: ToolHandler): MockRuntime {
  const calls: string[][] = [];

  return {
    calls,
    async call(args: string[]) {
      calls.push([...args]);
      return handler(args);
    },
  };
}
