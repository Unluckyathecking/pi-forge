import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { GitCliAdapter } from '../../src/adapters/git.js';
import { GitError } from '../../src/core/errors.js';

describe('GitCliAdapter — Phase 2 ref + worktree helpers', () => {
  let repoRoot: string;
  let adapter: GitCliAdapter;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'pi-forge-git-test-'));
    execSync('git init -q -b main', { cwd: repoRoot });
    execSync('git config user.email "test@test.local"', { cwd: repoRoot });
    execSync('git config user.name "test"', { cwd: repoRoot });
    execSync('git commit --allow-empty -m "init"', { cwd: repoRoot });
    adapter = new GitCliAdapter();
    await adapter.init(repoRoot);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('moveWorktree moves a worktree to a new path', async () => {
    const wtPath = join(repoRoot, 'wt1');
    await adapter.createWorktree(wtPath, 'feat/test');
    const moved = await adapter.moveWorktree(wtPath, join(repoRoot, 'wt1.failed'));
    expect(moved).toBe(join(repoRoot, 'wt1.failed'));
    await expect(stat(moved)).resolves.toBeDefined();
    await expect(stat(wtPath)).rejects.toThrow(); // original gone
  });

  it('moveWorktree handles collision by appending timestamp', async () => {
    const wt1 = join(repoRoot, 'wt1');
    const wt2 = join(repoRoot, 'wt2');
    const target = join(repoRoot, 'preserved');
    await adapter.createWorktree(wt1, 'feat/a');
    await adapter.createWorktree(wt2, 'feat/b');
    await adapter.moveWorktree(wt1, target);
    const moved2 = await adapter.moveWorktree(wt2, target);
    expect(moved2).not.toBe(target);
    expect(moved2).toMatch(new RegExp(`^${target}-\\d+$`));
  });

  it('updateRef + listRefs + deleteRef roundtrip', async () => {
    const sha = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
    await adapter.updateRef('refs/forge/failed/g1/t1', sha);
    const refs = await adapter.listRefs('refs/forge/failed');
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('refs/forge/failed/g1/t1');
    expect(refs[0].sha).toBe(sha);

    await adapter.deleteRef('refs/forge/failed/g1/t1');
    const after = await adapter.listRefs('refs/forge/failed');
    expect(after).toHaveLength(0);
  });

  it('listRefs returns empty for non-existent prefix', async () => {
    const refs = await adapter.listRefs('refs/nothing-here');
    expect(refs).toEqual([]);
  });

  it('updateRef throws GitError on invalid SHA', async () => {
    await expect(adapter.updateRef('refs/forge/failed/g/t', 'not-a-sha')).rejects.toThrow(GitError);
  });
});
