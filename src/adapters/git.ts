/**
 * GitCliAdapter — Git CLI adapter implementing GitPort
 *
 * Uses Node.js child_process.spawn to execute git commands and
 * parses output safely. Converts all git failures into GitError.
 */

import { spawn } from 'node:child_process';
import { GitError } from '../core/errors.js';
import type { GitPort, MergeResult, WorktreeInfo } from '../ports/git.js';

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export function execGit(args: readonly string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', args as string[], {
      cwd,
      shell: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');

    proc.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    proc.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    proc.on('close', (code: number | null) => {
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? 0,
      });
    });

    proc.on('error', (err: Error) => {
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

export class GitCliAdapter implements GitPort {
  readonly name = 'git-cli';

  private repoRoot: string | undefined;

  async init(repoRoot: string): Promise<void> {
    this.repoRoot = repoRoot;
    const { exitCode, stderr } = await execGit(['rev-parse', '--git-dir'], repoRoot);
    if (exitCode !== 0) {
      throw new GitError(`Not a git repository: ${repoRoot}`, { repoRoot, stderr });
    }
  }

  async createWorktree(path: string, branch: string, baseBranch?: string): Promise<WorktreeInfo> {
    if (this.repoRoot === undefined) {
      throw new GitError('Adapter not initialized', {});
    }

    const args = ['worktree', 'add', '-b', branch, path];
    if (baseBranch !== undefined) {
      args.push(baseBranch);
    }

    const { exitCode, stderr } = await execGit(args, this.repoRoot);
    if (exitCode !== 0) {
      throw new GitError(`Failed to create worktree at ${path}`, { path, branch, baseBranch, stderr });
    }

    return this.resolveWorktreeInfo(path);
  }

  async destroyWorktree(path: string, deleteBranch?: boolean): Promise<void> {
    if (this.repoRoot === undefined) {
      throw new GitError('Adapter not initialized', {});
    }

    let branch: string | undefined;
    if (deleteBranch === true) {
      const { stdout, exitCode } = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], path);
      if (exitCode === 0) {
        branch = stdout.trim();
      }
    }

    const { exitCode, stderr } = await execGit(['worktree', 'remove', path], this.repoRoot);
    if (exitCode !== 0) {
      throw new GitError(`Failed to remove worktree at ${path}`, { path, stderr });
    }

    if (deleteBranch === true && branch !== undefined && branch !== 'HEAD') {
      const { exitCode: delCode, stderr: delErr } = await execGit(['branch', '-D', branch], this.repoRoot);
      if (delCode !== 0) {
        throw new GitError(`Failed to delete branch ${branch}`, { path, branch, stderr: delErr });
      }
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    if (this.repoRoot === undefined) {
      throw new GitError('Adapter not initialized', {});
    }

    const { stdout, exitCode, stderr } = await execGit(['worktree', 'list', '--porcelain'], this.repoRoot);
    if (exitCode !== 0) {
      throw new GitError('Failed to list worktrees', { stderr });
    }

    const worktrees: WorktreeInfo[] = [];
    const blocks = stdout.split(/\n\s*\n/);

    for (const block of blocks) {
      const lines = block.split('\n').filter((line) => line.trim() !== '');
      if (lines.length === 0) continue;

      let wtPath = '';
      let wtBranch = '';
      let wtCommit: string | undefined;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice('worktree '.length);
        } else if (line.startsWith('HEAD ')) {
          wtCommit = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          wtBranch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        } else if (line.startsWith('detached')) {
          wtBranch = 'HEAD';
        }
      }

      if (wtPath) {
        const dirty = await this.isDirty(wtPath);
        worktrees.push({
          path: wtPath,
          branch: wtBranch || 'HEAD',
          commit: wtCommit,
          dirty,
        });
      }
    }

    return worktrees;
  }

  async createBranch(branch: string, base?: string): Promise<void> {
    if (this.repoRoot === undefined) {
      throw new GitError('Adapter not initialized', {});
    }

    const args = ['branch', branch];
    if (base !== undefined) {
      args.push(base);
    }

    const { exitCode, stderr } = await execGit(args, this.repoRoot);
    if (exitCode !== 0) {
      throw new GitError(`Failed to create branch ${branch}`, { branch, base, stderr });
    }
  }

  async currentBranch(path?: string): Promise<string> {
    const cwd = path ?? this.repoRoot;
    if (cwd === undefined) {
      throw new GitError('Adapter not initialized and no path provided', {});
    }

    const { stdout, exitCode, stderr } = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (exitCode !== 0) {
      throw new GitError('Failed to get current branch', { cwd, stderr });
    }
    return stdout.trim();
  }

  async commit(path: string, message: string, options?: { all?: boolean }): Promise<string> {
    const args = ['commit', '-m', message];
    if (options?.all === true) {
      args.push('-a');
    }

    const { exitCode, stderr } = await execGit(args, path);
    if (exitCode !== 0) {
      throw new GitError(`Failed to commit in ${path}`, { path, message, stderr });
    }

    const { stdout: shaOut, exitCode: shaCode } = await execGit(['rev-parse', 'HEAD'], path);
    if (shaCode !== 0) {
      throw new GitError('Failed to get commit SHA after commit', { path });
    }
    return shaOut.trim();
  }

  async diffStats(path: string): Promise<{ files: number; additions: number; deletions: number }> {
    const { stdout, exitCode, stderr } = await execGit(['diff', 'HEAD', '--stat'], path);
    if (exitCode !== 0) {
      throw new GitError(`Failed to get diff stats for ${path}`, { path, stderr });
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      return { files: 0, additions: 0, deletions: 0 };
    }

    const lines = trimmed.split('\n');
    const summaryLine = lines[lines.length - 1];

    const filesMatch = summaryLine.match(/(\d+)\s+file/);
    const insertionsMatch = summaryLine.match(/(\d+)\s+insertion/);
    const deletionsMatch = summaryLine.match(/(\d+)\s+deletion/);

    return {
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      additions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
      deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
    };
  }

  async merge(target: string, source: string, strategy?: 'merge' | 'rebase'): Promise<MergeResult> {
    if (this.repoRoot === undefined) {
      throw new GitError('Adapter not initialized', {});
    }

    const { exitCode: coCode, stderr: coErr } = await execGit(['checkout', target], this.repoRoot);
    if (coCode !== 0) {
      throw new GitError(`Failed to checkout ${target} for merge`, { target, source, stderr: coErr });
    }

    const strat = strategy ?? 'merge';

    if (strat === 'rebase') {
      const { exitCode } = await execGit(['rebase', source], this.repoRoot);
      if (exitCode !== 0) {
        const conflicts = await this.getConflictedFiles(this.repoRoot);
        return { success: false, conflicts };
      }
      const { stdout } = await execGit(['rev-parse', 'HEAD'], this.repoRoot);
      return { success: true, conflicts: [], merged_commit: stdout.trim() };
    }

    const { exitCode } = await execGit(['merge', source], this.repoRoot);
    if (exitCode !== 0) {
      const conflicts = await this.getConflictedFiles(this.repoRoot);
      return { success: false, conflicts };
    }
    const { stdout } = await execGit(['rev-parse', 'HEAD'], this.repoRoot);
    return { success: true, conflicts: [], merged_commit: stdout.trim() };
  }

  async hasConflicts(path: string): Promise<boolean> {
    const { stdout } = await execGit(['diff', '--name-only', '--diff-filter=U'], path);
    return stdout.trim().length > 0;
  }

  async abortMerge(path: string): Promise<void> {
    const { exitCode: mergeCode } = await execGit(['merge', '--abort'], path);
    if (mergeCode === 0) {
      return;
    }

    const { exitCode: rebaseCode, stderr } = await execGit(['rebase', '--abort'], path);
    if (rebaseCode !== 0) {
      throw new GitError(`Failed to abort merge/rebase in ${path}`, { path, stderr });
    }
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    const { exitCode, stdout, stderr } = await execGit(['--version']);
    if (exitCode !== 0) {
      return { ok: false, message: stderr || 'git command failed' };
    }
    return { ok: true, message: stdout.trim() };
  }

  async isDirty(path: string): Promise<boolean> {
    // `git status --porcelain` catches tracked changes AND untracked files.
    // `git diff HEAD --quiet` only flags tracked-file diffs, which would
    // miss new files an agent just wrote into the worktree.
    const { stdout, exitCode } = await execGit(['status', '--porcelain'], path);
    if (exitCode !== 0) {
      throw new GitError(`Failed to check dirty state for ${path}`, { path });
    }
    return stdout.trim().length > 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async resolveWorktreeInfo(path: string): Promise<WorktreeInfo> {
    const { stdout: branchOut, exitCode: branchCode } = await execGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      path,
    );
    const { stdout: commitOut, exitCode: commitCode } = await execGit(['rev-parse', 'HEAD'], path);
    const dirty = await this.isDirty(path);

    const branch = branchCode === 0 ? branchOut.trim() : 'unknown';
    const commit = commitCode === 0 ? commitOut.trim() : undefined;

    return { path, branch, commit, dirty };
  }

  private async getConflictedFiles(cwd: string): Promise<string[]> {
    const { stdout } = await execGit(['diff', '--name-only', '--diff-filter=U'], cwd);
    return stdout.split('\n').filter((f) => f.trim() !== '');
  }
}
