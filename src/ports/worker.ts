/**
 * WorkerPort — Hexagonal port for executing coding tasks in isolated worktrees.
 *
 * Pi Forge separates orchestration (planning, gates, evidence) from code
 * generation. The Worker adapter is the *only* place pi-forge talks to a
 * coding agent or LLM, and it does so by delegating to a host SDK (Pi Coding
 * Agent today). Pi Forge itself never owns an API key.
 *
 * Adapters expected: `pi-sdk` (spawns a Pi AgentSession), future
 * `extension-proxy` (delegates to the parent Pi session when run as an
 * extension), `local-shell` (deterministic stub for tests).
 */

import type { Task } from '../core/types.js';

export interface WorkerResult {
  readonly success: boolean;
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly output?: string;
  readonly error?: string;
}

export interface WorkerInitOptions {
  /** Project root for context discovery */
  readonly projectRoot: string;
  /** Optional model identifier override (passed to the underlying SDK) */
  readonly model?: string;
  /** Optional thinking level (passed to the underlying SDK) */
  readonly thinkingLevel?: string;
  /** Per-task wallclock budget in milliseconds. Default: 10 minutes. */
  readonly timeoutMs?: number;
  /**
   * Optional allowlist of tool names exposed to the agent. Default:
   * `['read', 'edit', 'write', 'grep', 'ls']`. Pi Forge intentionally
   * withholds `bash` so workers cannot run arbitrary commands — gates
   * execute commands after the worker finishes.
   */
  readonly tools?: readonly string[];
}

export interface WorkerPort {
  readonly name: string;

  /** Initialize the worker with project context. Throws on missing SDK. */
  init(options: WorkerInitOptions): Promise<void>;

  /**
   * Execute a task inside a worktree directory. `signal` lets the
   * orchestrator cancel the worker on user abort or upstream failure.
   */
  execute(task: Task, worktreePath: string, signal?: AbortSignal): Promise<WorkerResult>;

  /** Lightweight liveness check used by the CLI startup probe. */
  health(): Promise<{ ok: boolean; message?: string }>;
}
