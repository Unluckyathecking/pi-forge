/**
 * PiSdkWorkerAdapter — WorkerPort implementation that delegates code edits to
 * an isolated Pi Coding Agent session.
 *
 * Pi Forge does not call any LLM API directly. The worker registers the
 * `kimi-coder` provider against Pi's `ModelRegistry` (mirroring what the
 * `pi-kimi-coder` extension does inside an interactive Pi session) and lets
 * Pi handle the actual prompting, token refresh, and streaming. When a
 * `kimiApiKey` is provided we use the static `sk-kimi-…` credential; when
 * absent, Pi falls back to the OAuth tokens in `~/.pi/agent/auth.json`.
 *
 * The worker has no compile-time dependency on `@mariozechner/pi-coding-agent`
 * — the import is dynamic so pi-forge still builds without the SDK present.
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { scrubbedEnv } from './git.js';
import type {
  AgentSessionEventLike,
  AuthStorageLike,
  CreateAgentSessionOptionsLike,
  CreateAgentSessionResultLike,
  ModelLike,
  ModelRegistryLike,
  ProviderConfigInputLike,
} from '@mariozechner/pi-coding-agent';
import type { Task } from '../core/types.js';
import { WorkerError } from '../core/errors.js';
import type {
  WorkerInitOptions,
  WorkerPort,
  WorkerResult,
} from '../ports/worker.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TOOLS: readonly string[] = ['read', 'edit', 'write', 'grep', 'ls'];
const DEFAULT_PROVIDER = 'kimi-coder';
const DEFAULT_MODEL = 'kimi-for-coding';
const SDK_PACKAGE = '@mariozechner/pi-coding-agent';

/** Restricts `--provider` / `--model` flag values to a slug alphabet so a
 *  hostile value cannot bend the SDK's resolver into reading arbitrary paths
 *  or URL fragments. Mirrors `state.ts`'s `ID_PATTERN`. */
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
function assertSafeIdentifier(value: string, field: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new WorkerError(`Unsafe ${field}: contains characters outside [A-Za-z0-9_.-]`, { value });
  }
}

/** Transient `errorMessage`-carrying event types the SDK emits during
 *  recovery (auto-retry / compaction). The worker treats these as noise —
 *  the terminal signal is `waitForIdle()` settling. */
const TRANSIENT_ERROR_EVENT_TYPES: ReadonlySet<string> = new Set([
  'auto_retry_start',
  'auto_retry_end',
  'compaction_end',
]);

/**
 * Kimi-coder provider configuration. Mirrors `pi-kimi-coder/extensions/index.ts`
 * verbatim because the upstream Kimi Coding API checks `User-Agent` and rejects
 * any request that doesn't claim to be `KimiCLI/1.5`.
 */
const KIMI_CODER_PROVIDER_CONFIG: ProviderConfigInputLike = {
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'KIMI_CODER_API_KEY',
  api: 'openai-completions',
  headers: { 'User-Agent': 'KimiCLI/1.5' },
  models: [
    {
      id: 'kimi-for-coding',
      name: 'Kimi for Coding (K2.6)',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 32768,
      compat: {
        thinkingFormat: 'zai',
        maxTokensField: 'max_tokens',
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    },
    {
      id: 'kimi-k2.6',
      name: 'Kimi K2.6',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 32768,
      compat: {
        thinkingFormat: 'zai',
        maxTokensField: 'max_tokens',
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    },
    {
      id: 'kimi-k2-thinking',
      name: 'Kimi K2 Thinking',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 32768,
      compat: {
        thinkingFormat: 'zai',
        maxTokensField: 'max_tokens',
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    },
  ],
};

type SdkCreateAgentSession = (
  options?: CreateAgentSessionOptionsLike
) => Promise<CreateAgentSessionResultLike>;

interface PiSdkModule {
  readonly createAgentSession: SdkCreateAgentSession;
  readonly AuthStorage: { create(path: string): AuthStorageLike };
  readonly ModelRegistry: { create(authStorage: AuthStorageLike, modelsJsonPath?: string): ModelRegistryLike };
}

interface DiffStats {
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

export class PiSdkWorkerAdapter implements WorkerPort {
  readonly name = 'pi-sdk-worker';

  private projectRoot = '';
  private timeoutMs = DEFAULT_TIMEOUT_MS;
  private allowedTools: readonly string[] = DEFAULT_TOOLS;
  private providerName = DEFAULT_PROVIDER;
  private modelId = DEFAULT_MODEL;
  private sdk?: PiSdkModule;
  private authStorage?: AuthStorageLike;
  private modelRegistry?: ModelRegistryLike;
  private model?: ModelLike;

  async init(options: WorkerInitOptions): Promise<void> {
    this.projectRoot = options.projectRoot;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (options.tools !== undefined && options.tools.length > 0) {
      this.allowedTools = options.tools;
    }
    this.providerName = options.providerName ?? DEFAULT_PROVIDER;
    this.modelId = options.modelId ?? DEFAULT_MODEL;
    assertSafeIdentifier(this.providerName, 'providerName');
    assertSafeIdentifier(this.modelId, 'modelId');

    // Load the SDK module as `unknown` so the structural guard below is the
    // single source of truth — the previous upfront `as PiSdkModule` cast
    // silenced TypeScript before any runtime check, which made the guard
    // confusing to reason about under SDK version skew.
    let mod: unknown;
    try {
      // Non-literal specifier so bundlers don't try to resolve the optional
      // peer dep at build time.
      const specifier = SDK_PACKAGE;
      mod = await import(specifier);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkerError(
        `Failed to load ${SDK_PACKAGE}. Install Pi Coding Agent or run with --no-worker. (${message})`,
        { projectRoot: this.projectRoot, cause: message }
      );
    }

    const candidate = mod as {
      readonly createAgentSession?: unknown;
      readonly AuthStorage?: { readonly create?: unknown };
      readonly ModelRegistry?: { readonly create?: unknown };
    };
    if (
      typeof candidate.createAgentSession !== 'function' ||
      typeof candidate.AuthStorage?.create !== 'function' ||
      typeof candidate.ModelRegistry?.create !== 'function'
    ) {
      throw new WorkerError(
        `${SDK_PACKAGE} resolved but is missing required exports (createAgentSession / AuthStorage / ModelRegistry)`,
        { projectRoot: this.projectRoot }
      );
    }
    // Safe narrowing — we've structurally verified the three call sites.
    this.sdk = candidate as PiSdkModule;

    // Wire the Kimi key into the env var the provider reads as its bearer.
    // Priority: explicit init option → existing env var → leave unset (Pi
    // falls back to OAuth tokens in auth.json).
    const explicitKey = options.kimiApiKey ?? process.env.KIMI_CODER_API_KEY;
    if (explicitKey !== undefined && explicitKey.length > 0) {
      process.env.KIMI_CODER_API_KEY = explicitKey;
    }

    const agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent');
    this.authStorage = this.sdk.AuthStorage.create(join(agentDir, 'auth.json'));
    this.modelRegistry = this.sdk.ModelRegistry.create(this.authStorage, join(agentDir, 'models.json'));
    this.modelRegistry.registerProvider(this.providerName, KIMI_CODER_PROVIDER_CONFIG);

    const model = this.modelRegistry.find(this.providerName, this.modelId);
    if (model === undefined) {
      throw new WorkerError(
        `Model ${this.providerName}/${this.modelId} not found after provider registration`,
        { provider: this.providerName, modelId: this.modelId }
      );
    }
    this.model = model;
  }

  async execute(task: Task, worktreePath: string, signal?: AbortSignal): Promise<WorkerResult> {
    if (!this.sdk || !this.modelRegistry || this.model === undefined) {
      throw new WorkerError('Worker adapter not initialized. Call init() first.');
    }

    const { session } = await this.sdk.createAgentSession({
      cwd: worktreePath,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      model: this.model,
      tools: [...this.allowedTools],
    });

    let lastError: string | undefined;
    const unsubscribe = session.subscribe((event: AgentSessionEventLike) => {
      if (typeof event.errorMessage !== 'string' || event.errorMessage.length === 0) {
        return;
      }
      // Transient retry / compaction events also carry errorMessage but
      // the SDK itself is recovering. Treat `waitForIdle()` as the
      // terminal signal instead.
      const type = typeof event.type === 'string' ? event.type : '';
      if (TRANSIENT_ERROR_EVENT_TYPES.has(type)) {
        return;
      }
      lastError = event.errorMessage;
    });

    try {
      await session.prompt(this.buildPrompt(task, worktreePath));
      await this.raceWithTimeoutAndSignal(
        session.agent.waitForIdle(),
        this.timeoutMs,
        `Task ${task.id} exceeded ${this.timeoutMs}ms worker budget`,
        signal
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = lastError ?? message;
    } finally {
      unsubscribe();
    }

    const diff = await this.getDiffStats(worktreePath);

    return {
      success: lastError === undefined,
      filesChanged: diff.filesChanged,
      linesAdded: diff.linesAdded,
      linesRemoved: diff.linesRemoved,
      output: lastError !== undefined ? `Agent error: ${lastError}` : undefined,
      error: lastError,
    };
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    if (!this.sdk || !this.modelRegistry) {
      return { ok: false, message: 'Pi SDK not loaded' };
    }
    if (this.model === undefined) {
      return { ok: false, message: `Model ${this.providerName}/${this.modelId} not resolved` };
    }
    return Promise.resolve({ ok: true, message: `Pi SDK worker initialized with ${this.providerName}/${this.modelId}` });
  }

  // ── Private helpers ──

  private buildPrompt(task: Task, worktreePath: string): string {
    const description = task.description ?? 'No additional description.';
    return [
      'You are an autonomous coding agent executing one task inside an isolated git worktree.',
      '',
      'IMPORTANT: a sibling `PLAN.md` (in the worktree root) may contain the authoritative spec for this work — read it first if it exists, then execute against it.',
      '',
      '<task>',
      `  <worktree>${escapeXml(worktreePath)}</worktree>`,
      `  <id>${escapeXml(task.id)}</id>`,
      `  <title>${escapeXml(task.title)}</title>`,
      `  <description>${escapeXml(description)}</description>`,
      '</task>',
      '',
      'Instructions:',
      '1. Read PLAN.md if present; otherwise inspect the codebase to understand context.',
      '2. Make the minimal correct change to fulfill the task.',
      '3. Preserve existing conventions, formatting, and unrelated code.',
      '4. Do NOT add boilerplate comments or verbose explanations in files.',
      '5. After editing, do not run shell commands — Pi Forge gates run them after you finish.',
      '6. Report completion briefly when done.',
      '',
      'Begin.',
    ].join('\n');
  }

  private async getDiffStats(worktreePath: string): Promise<DiffStats> {
    let stdout: string;
    try {
      const result = await execFileAsync('git', ['diff', 'HEAD', '--stat'], {
        cwd: worktreePath,
        maxBuffer: 10 * 1024 * 1024,
        env: scrubbedEnv(),
      });
      stdout = result.stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkerError(`Failed to collect diff stats in ${worktreePath}: ${message}`, {
        worktreePath,
      });
    }

    const trimmed = stdout.trim();
    if (trimmed === '') {
      return { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
    }
    const lines = trimmed.split('\n');
    const summaryLine = lines[lines.length - 1];
    const filesMatch = /(\d+)\s+file/.exec(summaryLine);
    const insertionsMatch = /(\d+)\s+insertion/.exec(summaryLine);
    const deletionsMatch = /(\d+)\s+deletion/.exec(summaryLine);
    return {
      filesChanged: filesMatch !== null ? parseInt(filesMatch[1], 10) : 0,
      linesAdded: insertionsMatch !== null ? parseInt(insertionsMatch[1], 10) : 0,
      linesRemoved: deletionsMatch !== null ? parseInt(deletionsMatch[1], 10) : 0,
    };
  }

  private async raceWithTimeoutAndSignal<T>(
    promise: Promise<T>,
    ms: number,
    timeoutReason: string,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new WorkerError(timeoutReason, { timeoutMs: ms }));
      }, ms);

      const onAbort = (): void => {
        cleanup();
        reject(new WorkerError('Worker aborted by caller', { signalReason: signal?.reason }));
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        if (signal !== undefined) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      if (signal !== undefined) {
        if (signal.aborted) {
          cleanup();
          reject(new WorkerError('Worker aborted before start', { signalReason: signal.reason }));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      promise
        .then((value) => {
          cleanup();
          resolve(value);
        })
        .catch((err: unknown) => {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
