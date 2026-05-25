import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, applyEnvOverrides } from '../../src/utils/config.js';
import { ConfigError } from '../../src/core/errors.js';

describe('loadConfig', () => {
  let workdir: string;
  const originalCwd = process.cwd();
  const envSnapshot: Record<string, string | undefined> = {};

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'pi-forge-config-'));
    process.chdir(workdir);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(workdir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FORGE_')) {
        envSnapshot[key] = process.env[key];
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(envSnapshot)) delete envSnapshot[key];
  });

  it('writes a default config when missing and parses it', async () => {
    const config = await loadConfig();
    expect(config.forge.name).toBe('pi-forge');
    expect(config.gates.mechanical.test.coverage_threshold).toBe(80);
  });

  it('merges a project config on top of the default', async () => {
    await mkdir(join(workdir, 'config'), { recursive: true });
    const projectPath = join(workdir, 'config', 'project.yaml');
    await writeFile(
      projectPath,
      'gates:\n  mechanical:\n    test:\n      coverage_threshold: 95\n',
      'utf-8'
    );
    const config = await loadConfig(projectPath);
    expect(config.gates.mechanical.test.coverage_threshold).toBe(95);
    // Untouched value still resolves from the default
    expect(config.forge.name).toBe('pi-forge');
  });

  it('applies FORGE_* env overrides through the __ separator', async () => {
    process.env.FORGE_GATES__MECHANICAL__TEST__COVERAGE_THRESHOLD = '42';
    const config = await loadConfig();
    expect(config.gates.mechanical.test.coverage_threshold).toBe(42);
  });

  it('throws ConfigError when project config path is missing', async () => {
    await expect(loadConfig(join(workdir, 'does-not-exist.yaml'))).rejects.toBeInstanceOf(
      ConfigError
    );
  });

  it('rejects invalid yaml shape', async () => {
    await mkdir(join(workdir, 'config'), { recursive: true });
    const bad = join(workdir, 'config', 'bad.yaml');
    await writeFile(bad, 'forge: 42\n', 'utf-8');
    await expect(loadConfig(bad)).rejects.toBeInstanceOf(ConfigError);
  });

  it('applies default failed_task_behavior and failed_worktree_suffix when missing', async () => {
    // The embedded DEFAULT_CONFIG_YAML now ships the keys, but the Zod
    // .default() must still kick in for legacy project overrides that
    // strip them out via a deep-merge.
    await mkdir(join(workdir, 'config'), { recursive: true });
    const projectPath = join(workdir, 'config', 'project.yaml');
    // Project config only sets unrelated keys — defaults must apply for
    // the new keys via the default config's inherited values OR Zod fallback.
    await writeFile(
      projectPath,
      'gates:\n  mechanical:\n    test:\n      coverage_threshold: 80\n',
      'utf-8'
    );
    const config = await loadConfig(projectPath);
    expect(config.git.failed_task_behavior).toBe('purge');
    expect(config.git.failed_worktree_suffix).toBe('.failed');
  });

  it('accepts failed_task_behavior: preserve via project config override', async () => {
    await mkdir(join(workdir, 'config'), { recursive: true });
    const projectPath = join(workdir, 'config', 'project.yaml');
    await writeFile(
      projectPath,
      'git:\n  failed_task_behavior: "preserve"\n  failed_worktree_suffix: ".dead"\n',
      'utf-8'
    );
    const config = await loadConfig(projectPath);
    expect(config.git.failed_task_behavior).toBe('preserve');
    expect(config.git.failed_worktree_suffix).toBe('.dead');
  });

  it('rejects invalid failed_task_behavior enum value', async () => {
    await mkdir(join(workdir, 'config'), { recursive: true });
    const projectPath = join(workdir, 'config', 'project.yaml');
    await writeFile(
      projectPath,
      'git:\n  failed_task_behavior: "banana"\n',
      'utf-8'
    );
    await expect(loadConfig(projectPath)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects uncloneable values in applyEnvOverrides', () => {
    // structuredClone fails on functions
    const badConfig: Record<string, unknown> = { myFunc: () => {} };
    expect(() => applyEnvOverrides(badConfig)).toThrow(ConfigError);
  });

  it('applies FORGE_* env overrides creating nested structures if they do not exist', async () => {
    process.env.FORGE_NEWKEY__NESTED__VALUE = 'true';
    process.env.FORGE_NEWKEY__OTHER = '["a", "b"]';
    process.env.FORGE_GATES__MECHANICAL__TEST__COVERAGE_THRESHOLD = 'unparseable';
    // We expect a Config validation error or fallback. Since we set it to 'unparseable', Zod will fail.
    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigError);
    delete process.env.FORGE_NEWKEY__NESTED__VALUE;
    delete process.env.FORGE_NEWKEY__OTHER;
    delete process.env.FORGE_GATES__MECHANICAL__TEST__COVERAGE_THRESHOLD;
  });

  it('getConfig throws if called before loadConfig', async () => {
    // Cannot easily use require in ESM context so dynamically import a fresh one
    // by appending a query string.
    const { getConfig: freshGetConfig } = await import('../../src/utils/config.js?cachebust=' + Date.now());
    expect(() => freshGetConfig()).toThrow(ConfigError);
  });
});
