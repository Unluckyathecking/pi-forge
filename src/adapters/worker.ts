/**
 * PiSdkWorkerAdapter — WorkerPort implementation that delegates code edits to
 * an isolated Pi Coding Agent session.
 *
 * Pi Forge does not call any LLM API directly. Authentication and model
 * selection live in `~/.pi/agent/` (managed by `pi auth` / `pi model`). This
 * adapter just spawns an agent session in the worktree directory and lets Pi
 * handle the conversation. If `@mariozechner/pi-coding-agent` is not
 * installed, the adapter throws on init and the orchestrator falls back to
 * gates-only mode.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentSessionEventLike,
  AgentSessionLike,
  CreateAgentSessionOptionsLike,
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
const SDK_PACKAGE = '@mariozechner/pi-coding-agent';

type SdkCreateAgentSession = (
  options?: CreateAgentSessionOptionsLike
) => Promise<{ session: AgentSessionLike }>;

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
  private createSession?: SdkCreateAgentSession;

  async init(options: WorkerInitOptions): Promise<void> {
    this.projectRoot = options.projectRoot;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (options.tools !== undefined && options.tools.length > 0) {
      this.allowedTools = options.tools;
    }

    let mod: { createAgentSession?: SdkCreateAgentSession };
    try {
      // Use a non-literal specifier so bundlers (e.g. tsx, esbuild) don't try
      // to resolve the optional peer dep at build time.
      const specifier = SDK_PACKAGE;
      mod = (await import(specifier)) as { createAgentSession?: SdkCreateAgentSession };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkerError(
        `Failed to load ${SDK_PACKAGE}. Install Pi Coding Agent or run with --no-worker. (${message})`,
        { projectRoot: this.projectRoot, cause: message }
      );
    }

    if (typeof mod.createAgentSession !== 'function') {
      throw new WorkerError(
        `${SDK_PACKAGE} resolved but does not export createAgentSession`,
        { projectRoot: this.projectRoot }
      );
    }
    this.createSession = mod.createAgentSession;
  }

  async execute(task: Task, worktreePath: string, signal?: AbortSignal): Promise<WorkerResult> {
    if (!this.createSession) {
      throw new WorkerError('Worker adapter not initialized. Call init() first.');
    }

    const { session } = await this.createSession({
      cwd: worktreePath,
      tools: [...this.allowedTools],
    });

    let lastError: string | undefined;
    const unsubscribe = session.subscribe((event: AgentSessionEventLike) => {
      if (typeof event.errorMessage === 'string' && event.errorMessage.length > 0) {
        lastError = event.errorMessage;
      }
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
    if (!this.createSession) {
      return { ok: false, message: 'Pi SDK not loaded' };
    }
    // Lightweight liveness check: confirm the SDK entry point is callable
    // without paying the cost of spinning up a real AgentSession (which
    // touches auth, model registry, and session persistence).
    return Promise.resolve({ ok: true, message: 'Pi SDK worker initialized' });
  }

  // ── Private helpers ──

  private buildPrompt(task: Task, worktreePath: string): string {
    const description = task.description ?? 'No additional description.';
    return [
      'You are an autonomous coding agent executing one task inside an isolated git worktree.',
      '',
      '<task>',
      `  <worktree>${escapeXml(worktreePath)}</worktree>`,
      `  <id>${escapeXml(task.id)}</id>`,
      `  <title>${escapeXml(task.title)}</title>`,
      `  <description>${escapeXml(description)}</description>`,
      '</task>',
      '',
      'Instructions:',
      '1. Inspect the existing codebase to understand context.',
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
