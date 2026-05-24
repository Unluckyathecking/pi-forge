import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCommandVerifier } from '../../src/adapters/verifier.js';
import type { GateConfig } from '../../src/ports/verifier.js';

async function writePackageJson(dir: string, scripts: Record<string, string>): Promise<void> {
  const pkg = { name: 'tmp-fixture', version: '0.0.0', scripts };
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
}

const testGateOnly: Record<string, GateConfig> = {
  test: { enabled: true, fail_on_error: false, timeout_seconds: 30 },
};

describe('LocalCommandVerifier — no-op test detection', () => {
  let workdir: string;
  let verifier: LocalCommandVerifier;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'pi-forge-verifier-'));
    verifier = new LocalCommandVerifier();
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it('marks test gate as "skip" for `echo ... && exit 0`', async () => {
    await writePackageJson(workdir, { test: 'echo no tests && exit 0' });
    await verifier.init(workdir, testGateOnly);

    const result = await verifier.runGate('test', workdir);

    expect(result.status).toBe('skip');
    expect(result.exit_code).toBe(0);
    expect(result.output).toMatch(/no-op/i);
  });

  it('marks test gate as "skip" for `exit 0` alone', async () => {
    await writePackageJson(workdir, { test: 'exit 0' });
    await verifier.init(workdir, testGateOnly);

    const result = await verifier.runGate('test', workdir);

    expect(result.status).toBe('skip');
    expect(result.exit_code).toBe(0);
    expect(result.output).toMatch(/exit 0/);
  });

  it('marks test gate as "skip" for npm default `echo "Error: no test specified" && exit 1`', async () => {
    await writePackageJson(workdir, {
      test: 'echo "Error: no test specified" && exit 1',
    });
    await verifier.init(workdir, testGateOnly);

    const result = await verifier.runGate('test', workdir);

    expect(result.status).toBe('skip');
    expect(result.exit_code).toBe(0);
    expect(result.output).toMatch(/npm default/i);
  });

  it('runs the test gate normally for a real test command', async () => {
    // A real echo command that does NOT end in "&& exit 0" — not a no-op.
    await writePackageJson(workdir, { test: 'echo running real tests' });
    await verifier.init(workdir, testGateOnly);

    const result = await verifier.runGate('test', workdir);

    expect(result.status).toBe('pass');
    expect(result.exit_code).toBe(0);
    expect(result.output).toMatch(/running real tests/);
  });

  it('non-test gates ignore no-op detection (lint still runs its own command)', async () => {
    // package.json has a no-op test script, but we run the `lint` gate.
    await writePackageJson(workdir, { test: 'echo skip && exit 0' });

    const config: Record<string, GateConfig> = {
      lint: { enabled: true, fail_on_error: false, timeout_seconds: 30 },
    };
    await verifier.init(workdir, config);

    const result = await verifier.runGate('lint', workdir);

    // The lint command will almost certainly not resolve cleanly in the tmpdir,
    // but the important contract is that we did NOT short-circuit with the
    // no-op "skip" path — i.e., the gate ran its actual command.
    expect(result.status).not.toBe('skip');
    expect(result.output).not.toMatch(/no-op/i);
  });
});
