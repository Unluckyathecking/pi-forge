/**
 * GitPort — Hexagonal port for version control operations
 *
 * Adapters: git-cli (default), libgit2, github-api
 */

export interface WorktreeInfo {
  readonly path: string;
  readonly branch: string;
  readonly commit?: string;
  readonly dirty: boolean;
}

export interface MergeResult {
  readonly success: boolean;
  readonly conflicts: string[];
  readonly merged_commit?: string;
}

export interface GitPort {
  readonly name: string;

  /** Initialize the port with repository root */
  init(repoRoot: string): Promise<void>;

  /** Create a new worktree at the given path from the given base branch */
  createWorktree(path: string, branch: string, baseBranch?: string): Promise<WorktreeInfo>;

  /** Destroy a worktree and optionally its branch */
  destroyWorktree(path: string, deleteBranch?: boolean): Promise<void>;

  /** List active worktrees */
  listWorktrees(): Promise<WorktreeInfo[]>;

  /** Create a new branch */
  createBranch(branch: string, base?: string): Promise<void>;

  /** Get current branch name */
  currentBranch(path?: string): Promise<string>;

  /** Commit changes in a worktree */
  commit(path: string, message: string, options?: { all?: boolean }): Promise<string>;

  /** Get diff stats for a worktree */
  diffStats(path: string): Promise<{ files: number; additions: number; deletions: number }>;

  /** Merge source branch into target branch */
  merge(target: string, source: string, strategy?: 'merge' | 'rebase'): Promise<MergeResult>;

  /** Check if there are merge conflicts */
  hasConflicts(path: string): Promise<boolean>;

  /** Abort current merge/rebase */
  abortMerge(path: string): Promise<void>;

  /** Health check */
  health(): Promise<{ ok: boolean; message?: string }>;
}
