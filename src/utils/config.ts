/**
 * Config loader
 *
 * Reads YAML, validates with Zod, supports merging hierarchy:
 *   default < project < environment variables
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { ForgeConfig } from '../core/types.js';
import { ConfigError } from '../core/errors.js';

const DEFAULT_CONFIG_PATH = 'config/default.yaml';
const PROJECT_CONFIG_CANDIDATES: string[] = ['config/project.yaml', 'config/local.yaml'];

const DEFAULT_CONFIG_YAML = `forge:
  version: "1.0.0"
  name: "pi-forge"
  description: "Proof-carrying, hexagonal-core, multi-level autonomous coding factory"
core:
  architecture: "hexagonal"
  levels:
    L0:
      scope: "file"
      max_lines: 50
      agent_pool: 1
    L1:
      scope: "module"
      max_lines: 200
      agent_pool: 2
    L2:
      scope: "service"
      max_lines: 500
      agent_pool: 3
    L3:
      scope: "system"
      max_lines: 1000
      agent_pool: 4
  escalation:
    auto_escalate: true
    human_pause_on:
      - "security_review"
      - "auto_deny"
    max_escalation_depth: 3
proof_carrying:
  enabled: true
  required_gates:
    - "lint"
    - "typecheck"
    - "test"
    - "build"
  advisory_gates:
    - "security_scan"
    - "contract_verify"
  artifact:
    schema: "proof-artifact-v1"
    required_claims_min: 2
    max_output_excerpt_length: 2000
    persist_path: ".pi/proofs"
git:
  branch_prefix: "forge"
  session_branch_template: "forge/session-{date}-{goal_slug}"
  task_branch_template: "forge/task-{task_id}-{slug}"
  worktree_base: ".pi/worktrees"
  auto_clean_worktrees: true
  retain_failed_branches: false
  preserve_worktree_on_failure: false
  archive_after_days: 30
  commit:
    require_conventional_commits: true
    include_task_id: true
    include_evidence_summary: true
    max_commit_size_lines: 500
  merge:
    strategy: "merge"
    require_linear_history: false
    squash_on_merge: true
agents:
  roles:
    coordinator:
      description: "Coordinates multi-agent workflows"
      capabilities:
        - "orchestration"
        - "routing"
      max_concurrent_tasks: 10
    planner:
      description: "Creates implementation plans"
      capabilities:
        - "architecture"
        - "planning"
      max_concurrent_tasks: 5
    coder:
      description: "Implements code changes"
      capabilities:
        - "coding"
        - "refactoring"
        - "testing"
      max_concurrent_tasks: 5
    reviewer:
      description: "Reviews code and architecture"
      capabilities:
        - "review"
        - "security"
      max_concurrent_tasks: 5
    qa:
      description: "Quality assurance and testing"
      capabilities:
        - "testing"
        - "validation"
      max_concurrent_tasks: 5
    security:
      description: "Security analysis and review"
      capabilities:
        - "security_scan"
        - "vulnerability_analysis"
      max_concurrent_tasks: 3
    integrator:
      description: "Merges and integrates changes"
      capabilities:
        - "merge"
        - "integration"
      max_concurrent_tasks: 5
  capability_routing:
    enabled: true
    fallback_role: "coordinator"
gates:
  mechanical:
    order:
      - "lint"
      - "typecheck"
      - "test"
      - "build"
      - "security_scan"
    lint:
      enabled: true
      fail_on_error: true
      auto_fix: true
    typecheck:
      enabled: true
      fail_on_error: true
    test:
      enabled: true
      require_pass: true
      timeout_seconds: 120
      coverage_threshold: 80
    build:
      enabled: true
      fail_on_error: true
      timeout_seconds: 300
    security_scan:
      enabled: true
      checks:
        - "secrets"
        - "dependencies"
      fail_on_critical: true
  review:
    diff_max_lines: 500
    diff_max_files: 20
    deny_patterns:
      - 'console\\.log'
      - "debugger"
    protected_files:
      - ".env"
      - "package-lock.json"
  risk:
    weights:
      policy_violations: 1.0
      suspicious_patterns: 0.8
      test_failures: 1.2
      contract_drift: 0.6
      diff_size_anomaly: 0.4
    thresholds:
      auto_promote: 0.2
      user_confirm: 0.5
      security_review: 0.8
      auto_deny: 0.95
state:
  paths:
    task_graphs: ".pi/state/task-graphs"
    evidence: ".pi/state/evidence"
    checkpoints: ".pi/state/checkpoints"
  checkpoints:
    auto_write_before:
      - "merge"
      - "rollback"
    max_checkpoints_per_goal: 10
    compress_after_days: 7
approval:
  auto_approve:
    - "docs"
    - "chore"
  require_confirm:
    - "feat"
    - "fix"
    - "refactor"
  require_review:
    - "security"
    - "arch"
`;

const gateTypeSchema = z.enum([
  'lint',
  'typecheck',
  'test',
  'build',
  'security_scan',
  'contract_verify',
  'diff_review',
  'manual_check',
]);

// Input is `unknown` (raw YAML) so we can use `.default()` on fields
// like `git.preserve_worktree_on_failure` to make them optional in
// legacy configs while keeping the output strictly typed as ForgeConfig.
const forgeConfigSchema: z.ZodType<ForgeConfig, z.ZodTypeDef, unknown> = z.object({
  forge: z.object({
    version: z.string(),
    name: z.string(),
    description: z.string(),
  }),
  core: z.object({
    architecture: z.string(),
    levels: z.record(
      z.string(),
      z.object({
        scope: z.string(),
        max_lines: z.number(),
        agent_pool: z.number(),
      })
    ),
    escalation: z.object({
      auto_escalate: z.boolean(),
      human_pause_on: z.array(z.string()),
      max_escalation_depth: z.number(),
    }),
  }),
  proof_carrying: z.object({
    enabled: z.boolean(),
    required_gates: z.array(gateTypeSchema),
    advisory_gates: z.array(gateTypeSchema),
    artifact: z.object({
      schema: z.string(),
      required_claims_min: z.number(),
      max_output_excerpt_length: z.number(),
      persist_path: z.string(),
    }),
  }),
  git: z.object({
    branch_prefix: z.string(),
    session_branch_template: z.string(),
    task_branch_template: z.string(),
    worktree_base: z.string(),
    auto_clean_worktrees: z.boolean(),
    retain_failed_branches: z.boolean(),
    // Default so v1.x configs (and the embedded default YAML before
    // this change shipped) parse without errors.
    preserve_worktree_on_failure: z.boolean().default(false),
    archive_after_days: z.number(),
    commit: z.object({
      require_conventional_commits: z.boolean(),
      include_task_id: z.boolean(),
      include_evidence_summary: z.boolean(),
      max_commit_size_lines: z.number(),
    }),
    merge: z.object({
      strategy: z.string(),
      require_linear_history: z.boolean(),
      squash_on_merge: z.boolean(),
    }),
  }),
  agents: z.object({
    roles: z.record(
      z.string(),
      z.object({
        description: z.string(),
        capabilities: z.array(z.string()),
        max_concurrent_tasks: z.number(),
      })
    ),
    capability_routing: z.object({
      enabled: z.boolean(),
      registry_path: z.string().optional(),
      fallback_role: z.string().optional(),
    }),
  }),
  gates: z.object({
    mechanical: z.object({
      order: z.array(gateTypeSchema),
      lint: z.object({
        enabled: z.boolean(),
        fail_on_error: z.boolean(),
        auto_fix: z.boolean(),
      }),
      typecheck: z.object({
        enabled: z.boolean(),
        fail_on_error: z.boolean(),
      }),
      test: z.object({
        enabled: z.boolean(),
        require_pass: z.boolean(),
        timeout_seconds: z.number(),
        coverage_threshold: z.number(),
      }),
      build: z.object({
        enabled: z.boolean(),
        fail_on_error: z.boolean(),
        timeout_seconds: z.number(),
      }),
      security_scan: z.object({
        enabled: z.boolean(),
        checks: z.array(z.string()),
        fail_on_critical: z.boolean(),
      }),
    }),
    review: z.object({
      diff_max_lines: z.number(),
      diff_max_files: z.number(),
      deny_patterns: z.array(z.string()),
      protected_files: z.array(z.string()),
    }),
    risk: z.object({
      weights: z.object({
        policy_violations: z.number(),
        suspicious_patterns: z.number(),
        test_failures: z.number(),
        contract_drift: z.number(),
        diff_size_anomaly: z.number(),
      }),
      thresholds: z.object({
        auto_promote: z.number(),
        user_confirm: z.number(),
        security_review: z.number(),
        auto_deny: z.number(),
      }),
    }),
  }),
  state: z.object({
    paths: z.record(z.string(), z.string()),
    checkpoints: z.object({
      auto_write_before: z.array(z.string()),
      max_checkpoints_per_goal: z.number(),
      compress_after_days: z.number(),
    }),
  }),
  approval: z.object({
    auto_approve: z.array(z.string()),
    require_confirm: z.array(z.string()),
    require_review: z.array(z.string()),
  }),
});

let cachedConfig: ForgeConfig | undefined;

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      key in result &&
      typeof tgtVal === 'object' &&
      tgtVal !== null &&
      !Array.isArray(tgtVal) &&
      typeof srcVal === 'object' &&
      srcVal !== null &&
      !Array.isArray(srcVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (!key.startsWith('FORGE_')) continue;
    const path = key.slice(6).toLowerCase().split('__');
    let current: Record<string, unknown> = result;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      const existing = current[segment];
      if (
        !(segment in current) ||
        typeof existing !== 'object' ||
        existing === null ||
        Array.isArray(existing)
      ) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    const last = path[path.length - 1];
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // keep as string
    }
    current[last] = parsed;
  }
  return result;
}

async function ensureDefaultConfig(): Promise<void> {
  if (existsSync(DEFAULT_CONFIG_PATH)) return;
  try {
    await mkdir(dirname(DEFAULT_CONFIG_PATH), { recursive: true });
    await writeFile(DEFAULT_CONFIG_PATH, DEFAULT_CONFIG_YAML, 'utf-8');
  } catch (err) {
    throw new ConfigError(
      `Failed to write default config to ${DEFAULT_CONFIG_PATH}`,
      { cause: err instanceof Error ? err.message : String(err) }
    );
  }
}

async function readYamlFile(filePath: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return yaml.load(content);
  } catch (err) {
    throw new ConfigError(
      `Failed to read YAML config from ${filePath}`,
      { cause: err instanceof Error ? err.message : String(err) }
    );
  }
}

async function resolveProjectConfig(path?: string): Promise<string | undefined> {
  if (path !== undefined && path !== '') {
    try {
      await access(resolve(path));
      return resolve(path);
    } catch {
      throw new ConfigError(`Project config path not found: ${path}`);
    }
  }
  for (const candidate of PROJECT_CONFIG_CANDIDATES) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }
  return undefined;
}

export async function loadConfig(projectConfigPath?: string): Promise<ForgeConfig> {
  await ensureDefaultConfig();
  const defaultRaw = await readYamlFile(DEFAULT_CONFIG_PATH);
  if (defaultRaw === undefined || defaultRaw === null || typeof defaultRaw !== 'object') {
    throw new ConfigError('Default config is not a valid object');
  }
  let merged: Record<string, unknown> = { ...(defaultRaw as Record<string, unknown>) };
  const projectPath = await resolveProjectConfig(projectConfigPath);
  if (projectPath !== undefined && projectPath !== '') {
    const projectRaw = await readYamlFile(projectPath);
    if (projectRaw !== undefined && projectRaw !== null && typeof projectRaw === 'object') {
      merged = deepMerge(merged, projectRaw as Record<string, unknown>);
    }
  }
  merged = applyEnvOverrides(merged);
  const parsed = forgeConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError('Config validation failed', { issues });
  }
  cachedConfig = parsed.data;
  return parsed.data;
}

export function getConfig(): ForgeConfig {
  if (!cachedConfig) {
    throw new ConfigError('Config has not been loaded. Call loadConfig() first.');
  }
  return cachedConfig;
}
