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

  /** Branded opaque handle. The SDK exposes a `Model<Api>` type with much more,
   *  but the worker just passes the handle through to `createAgentSession`. */
  export interface ModelLike {
    readonly __piModelBrand: never;
  }

  /** Branded opaque handle for `AuthStorage`. Created via `AuthStorage.create(path)`. */
  export interface AuthStorageLike {
    readonly __piAuthStorageBrand: never;
  }

  /** Subset of ProviderConfigInput used by the worker. Mirrors the shape Pi's
   *  pi-kimi-coder extension passes to `registerProvider`. */
  export interface ProviderConfigInputLike {
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly api?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly authHeader?: boolean;
    readonly models?: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly reasoning: boolean;
      readonly input: ReadonlyArray<'text' | 'image'>;
      readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
      readonly contextWindow: number;
      readonly maxTokens: number;
      readonly compat?: {
        readonly thinkingFormat?: string;
        readonly maxTokensField?: string;
        readonly supportsDeveloperRole?: boolean;
        readonly supportsStore?: boolean;
      };
    }>;
  }

  export interface ModelRegistryLike {
    readonly __piModelRegistryBrand: never;
    registerProvider(providerName: string, config: ProviderConfigInputLike): void;
    find(provider: string, modelId: string): ModelLike | undefined;
  }

  export interface CreateAgentSessionOptionsLike {
    readonly cwd?: string;
    readonly agentDir?: string;
    readonly authStorage?: AuthStorageLike;
    readonly modelRegistry?: ModelRegistryLike;
    readonly model?: ModelLike;
    readonly noTools?: 'all' | 'builtin';
    readonly tools?: readonly string[];
  }

  export interface CreateAgentSessionResultLike {
    readonly session: AgentSessionLike;
  }

  export function createAgentSession(
    options?: CreateAgentSessionOptionsLike
  ): Promise<CreateAgentSessionResultLike>;

  export const AuthStorage: {
    create(path: string): AuthStorageLike;
  };

  export const ModelRegistry: {
    create(authStorage: AuthStorageLike, modelsJsonPath?: string): ModelRegistryLike;
    inMemory(authStorage: AuthStorageLike): ModelRegistryLike;
  };
}
