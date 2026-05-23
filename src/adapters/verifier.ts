/**
 * LocalCommandVerifier — Adapter implementing VerifierPort via Node.js child_process
 *
 * Runs quality gates as shell commands inside worktree directories.
 * Auto-detects package.json scripts for command mapping.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { GateStatus, GateType, ProofArtifact, RiskScore } from '../core/types.js';
import { GateError } from '../core/errors.js';
import type { GateConfig, GateResult, VerifierPort } from '../ports/verifier.js';

const execFileAsync = promisify(execFile);

interface PackageJson {
  readonly scripts?: Record<string, string>;
  [key: string]: unknown;
}

export class LocalCommandVerifier implements VerifierPort {
  readonly name = 'local-command';

  private projectRoot = '';
  private config: Record<string, GateConfig> = {};
  private lastGateResults: Map<GateType, GateResult> = new Map();

  async init(projectRoot: string, config: Record<string, GateConfig>): Promise<void> {
    this.projectRoot = projectRoot;
    this.config = config;
    await Promise.resolve();
  }

  async runGate(gate: GateType, worktreePath: string): Promise<GateResult> {
    const gateConfig = this.config[gate];
    if (!gateConfig?.enabled) {
      const result: GateResult = {
        gate,
        status: 'skip',
        command: '',
        exit_code: 0,
        output: `Gate ${gate} is disabled or not configured`,
        duration_ms: 0,
      };
      this.lastGateResults.set(gate, result);
      return result;
    }

    const command = await this.resolveCommand(gate);
    const timeoutMs = (gateConfig.timeout_seconds ?? 300) * 1000;
    const start = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
        cwd: worktreePath,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      const duration = Date.now() - start;
      const result: GateResult = {
        gate,
        status: 'pass',
        command,
        exit_code: 0,
        output: stdout + stderr,
        duration_ms: duration,
      };
      this.lastGateResults.set(gate, result);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - start;
      let exitCode = 1;
      let output = '';

      if (error !== null && typeof error === 'object') {
        const execError = error as {
          readonly code?: number;
          readonly stdout?: string;
          readonly stderr?: string;
          readonly message?: string;
        };
        exitCode = typeof execError.code === 'number' ? execError.code : 1;
        output = `${execError.stdout ?? ''}${execError.stderr ?? ''}` || (execError.message ?? '');
      }

      const status: GateStatus = gateConfig.fail_on_error === false ? 'warn' : 'fail';
      const result: GateResult = {
        gate,
        status,
        command,
        exit_code: exitCode,
        output,
        duration_ms: duration,
      };
      this.lastGateResults.set(gate, result);

      if (gateConfig.fail_on_error !== false) {
        throw new GateError(`Gate ${gate} failed with exit code ${exitCode}`, gate, exitCode, output);
      }

      return result;
    }
  }

  async runAllGates(worktreePath: string): Promise<GateResult[]> {
    const defaultOrder: GateType[] = [
      'lint',
      'typecheck',
      'test',
      'build',
      'security_scan',
      'contract_verify',
      'diff_review',
      'manual_check',
    ];
    const results: GateResult[] = [];

    for (const gate of defaultOrder) {
      const gateConfig = this.config[gate];
      if (!gateConfig?.enabled) {
        continue;
      }

      try {
        const result = await this.runGate(gate, worktreePath);
        results.push(result);
        if (result.status === 'fail') {
          break;
        }
      } catch (error: unknown) {
        if (error instanceof GateError) {
          results.push({
            gate: error.gate as GateType,
            status: 'fail',
            command: '',
            exit_code: error.exitCode,
            output: error.output,
            duration_ms: 0,
          });
        }
        break;
      }
    }

    return results;
  }

  async validateProofArtifact(
    artifact: ProofArtifact,
    requiredGates: GateType[]
  ): Promise<{ valid: boolean; missing: GateType[] }> {
    const passedGates = new Set(
      artifact.claims
        .filter((claim) => claim.status === 'pass' || claim.status === 'warn')
        .map((claim) => claim.gate)
    );
    const missing = requiredGates.filter((g) => !passedGates.has(g));
    return await Promise.resolve({ valid: missing.length === 0, missing });
  }

  async scoreRisk(
    worktreePath: string,
    options?: { readonly diffMaxLines?: number; readonly diffMaxFiles?: number }
  ): Promise<RiskScore> {
    const diffMaxLines = options?.diffMaxLines ?? 500;
    const diffMaxFiles = options?.diffMaxFiles ?? 20;

    let diffSize = 0;
    let filesChanged = 0;

    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat'], {
        cwd: worktreePath,
        maxBuffer: 10 * 1024 * 1024,
      });
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        const fileMatch = /(\d+)\s+file/.exec(lastLine);
        const insertMatch = /(\d+)\s+insertion/.exec(lastLine);
        const deleteMatch = /(\d+)\s+deletion/.exec(lastLine);
        filesChanged = fileMatch ? parseInt(fileMatch[1], 10) : 0;
        const insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
        const deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
        diffSize = insertions + deletions;
      }
    } catch {
      // Not a git repo or no diff
    }

    const denyPatterns = [
      'eval\\(',
      'Function\\(',
      'child_process',
      'exec\\(',
      'password',
      'secret',
      'token',
      'private_key',
    ];
    const { matches } = await this.scanDiffInternal(worktreePath, denyPatterns);
    const patternScore = Math.min(40, matches.length * 8);

    const testResult = this.lastGateResults.get('test');
    const testFailureScore = testResult?.status === 'fail' ? 25 : 0;

    const diffSizeScore = Math.min(
      40,
      Math.round(
        (diffSize / Math.max(1, diffMaxLines)) * 25 +
          (filesChanged / Math.max(1, diffMaxFiles)) * 15
      )
    );

    const totalScore = Math.min(100, diffSizeScore + patternScore + testFailureScore);

    let decision: RiskScore['decision'];
    if (totalScore < 20) {
      decision = 'auto_promote';
    } else if (totalScore < 50) {
      decision = 'user_confirm';
    } else if (totalScore < 80) {
      decision = 'security_review';
    } else {
      decision = 'auto_deny';
    }

    return {
      score: totalScore,
      components: {
        diff_size_anomaly: diffSizeScore,
        suspicious_patterns: patternScore,
        test_failures: testFailureScore,
      },
      decision,
    };
  }

  async scanDiff(
    worktreePath: string,
    patterns: string[]
  ): Promise<{ matches: Array<{ file: string; line: number; pattern: string }> }> {
    return this.scanDiffInternal(worktreePath, patterns);
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      await execFileAsync('sh', ['-c', 'echo ok'], { timeout: 5000 });
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Health check failed';
      return { ok: false, message };
    }
  }

  private async resolveCommand(gate: GateType): Promise<string> {
    const packageJson = await this.loadPackageJson();
    const scripts = packageJson?.scripts;

    switch (gate) {
      case 'lint':
        return scripts?.lint != null && scripts.lint !== '' ? 'npm run lint' : 'eslint .';
      case 'typecheck':
        return scripts?.typecheck != null && scripts.typecheck !== '' ? 'npm run typecheck' : 'tsc --noEmit';
      case 'test':
        return scripts?.test != null && scripts.test !== '' ? 'npm test' : 'echo "No test command configured"';
      case 'build':
        return scripts?.build != null && scripts.build !== '' ? 'npm run build' : 'echo "No build command configured"';
      case 'security_scan':
        return 'echo "security_scan placeholder"';
      case 'contract_verify':
        return 'echo "contract_verify placeholder"';
      case 'diff_review':
        return 'echo "diff_review placeholder"';
      case 'manual_check':
        return 'echo "manual_check placeholder"';
      default: {
        const _exhaustive: never = gate;
        return `echo "Unknown gate: ${_exhaustive as string}"`;
      }
    }
  }

  private async loadPackageJson(): Promise<PackageJson | null> {
    try {
      const content = await readFile(`${this.projectRoot}/package.json`, 'utf-8');
      return JSON.parse(content) as PackageJson;
    } catch {
      return null;
    }
  }

  private async scanDiffInternal(
    worktreePath: string,
    patterns: string[]
  ): Promise<{ matches: Array<{ file: string; line: number; pattern: string }> }> {
    let diff = '';
    try {
      const { stdout } = await execFileAsync('git', ['diff'], {
        cwd: worktreePath,
        maxBuffer: 50 * 1024 * 1024,
      });
      diff = stdout;
    } catch {
      return { matches: [] };
    }

    const matches: Array<{ file: string; line: number; pattern: string }> = [];
    const lines = diff.split('\n');
    let currentFile = '';
    let lineNumber = 0;

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const parts = line.split(' ');
        currentFile = parts.length > 2 ? parts[2].replace('b/', '') : '';
        lineNumber = 0;
      } else if (line.startsWith('@@')) {
        const lineMatch = /\+(\d+)/.exec(line);
        lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 0;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        for (const pattern of patterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(line)) {
              matches.push({ file: currentFile, line: lineNumber, pattern });
            }
          } catch {
            // Invalid regex, skip
          }
        }
        lineNumber++;
      }
    }

    return { matches };
  }
}
