/**
 * Ambient type declarations for the @mariozechner/pi-coding-agent peer dependency.
 *
 * Pi Forge dynamically imports this module so the harness still functions when
 * Pi SDK is not installed (e.g. running pi-forge standalone). These minimal
 * declarations let `tsc` type-check src/ without requiring the SDK in
 * node_modules. When the SDK is installed at runtime, Node resolves the real
 * module and these stubs are ignored.
 *
 * The shapes mirror the public exports from
 * `@mariozechner/pi-coding-agent/dist/index.d.ts` (Pi SDK >= 0.73). Keep them
 * minimal — only what the worker adapter consumes.
 */

declare module '@mariozechner/pi-coding-agent' {
  export interface PromptOptions {
    readonly expandPromptTemplates?: boolean;
  }

  export interface AgentLike {
    waitForIdle(): Promise<void>;
  }

  export interface AgentSessionLike {
    readonly agent: AgentLike;
    prompt(text: string, options?: PromptOptions): Promise<void>;
    subscribe(listener: (event: AgentSessionEventLike) => void): () => void;
  }

  /**
   * Subset of AgentSessionEvent variants the worker cares about. Pi emits
   * `errorMessage` on several event types (e.g. compaction_end, auto_retry_*).
   * The worker treats any event carrying a non-empty errorMessage as a failure
   * signal.
   */
  export interface AgentSessionEventLike {
    readonly type?: string;
    readonly errorMessage?: string;
  }

  export interface CreateAgentSessionOptionsLike {
    readonly cwd?: string;
    readonly agentDir?: string;
    readonly noTools?: 'all' | 'builtin';
    readonly tools?: readonly string[];
  }

  export interface CreateAgentSessionResultLike {
    readonly session: AgentSessionLike;
  }

  export function createAgentSession(
    options?: CreateAgentSessionOptionsLike
  ): Promise<CreateAgentSessionResultLike>;
}
