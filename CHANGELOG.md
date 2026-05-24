# Changelog

All notable changes to Pi Forge are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] — 2026-05-24

Phase 4 — first-class observability + preserved-worktree polish.
Operators stop writing their own `jq` + cron loops to monitor runs,
and v1.3.0's preservation flow stops confusing parent-project
tooling.

### Added

- **`pi-forge watch <goal_id>` subcommand.** Tails
  `.pi/state/evidence/<goal>/ledger.json` every `--interval` ms
  (default 2000) and prints new entries with colored status badges
  + the currently-running task's worktree activity (file count +
  most-recent modified path, throttled to 30s heartbeat). Exits
  when `ledger.summary.final_status` is set (exit code 0 on
  success, 1 otherwise). Clean SIGINT handling. Waits up to 10s
  for the ledger to exist (race against forge startup).
- **`renderEntry`, `findActiveTask`, `readWorktreeStats`** helpers
  exported from CLI for testability — 4 new unit tests cover them.
- **Preserved-worktree tooling isolation.** When
  `failed_task_behavior: 'preserve'`, the orchestrator now writes
  `<preserved>/.eslintignore` and `<preserved>/.gitignore` (each
  containing `*\n`) inside the renamed worktree. Solves the
  `"No tsconfigRootDir was set, multiple candidate roots present"`
  error that parent-project eslint produces when walking up into a
  preserved worktree containing its own tsconfig + package.json.
  Each marker write is independently try/catch-wrapped — failure on
  one doesn't block the other or abort preservation.

### Backwards compatibility

- New `watch` subcommand — additive.
- Preserved-worktree markers — additive. Files are written only when
  `failed_task_behavior !== 'purge'`. Failures are warnings, not
  errors.

## [1.4.0] — 2026-05-24

Phase 3 — smart planner + honest test gate. Operators stop paying
Kimi tokens for redundant plan-tasks when PLAN.md already exists, and
the test gate stops lying about no-op `npm test` scripts.

### Added

- **`SimplePlannerAdapter` PLAN.md detection**. When the goal text
  references `PLAN.md` (case-insensitive) AND a `PLAN.md` file exists
  at the goal's project root, the planner emits a **2-task DAG**
  (`implement` + `verify`) instead of the legacy 3-task
  (`plan` + `implement` + `test`). The skipped plan task was typically
  pure waste — the operator's PLAN.md *is* the plan.
- **`--tasks <comma-list>` CLI flag** on `pi-forge forge`. Operator
  can run only specific tasks from the decomposed DAG, e.g.
  `--tasks implement` to skip plan + test, or `--tasks plan,implement`
  to skip test. Filter is an allowlist; tasks preserve the planner's
  declared order.
- **`DecompositionRequest.{tasks, projectRoot}`** optional fields on
  the planner port. Used by the CLI and orchestrator to plumb
  `--tasks` + PLAN.md detection.
- **`executeGoal(goal, context?, signal?, options?)`** — `options.tasks`
  and `options.projectRoot` plumb the new CLI flags through.
- **`LocalCommandVerifier` no-op test detection**. When `npm test` is
  a no-op (`echo … && exit 0`, `exit 0`, `true`, or npm's default
  `echo "Error: no test specified" && exit 1`), the test gate is now
  marked `'skip'` instead of `'pass'`. The result's `output` explains
  the detection. Operators see an honest signal that no tests ran.

### Backwards compatibility

- PLAN.md detection requires BOTH the goal text matching AND the file
  existing — neither condition alone changes behaviour.
- `--tasks` defaults to undefined; without it, the full decomposed
  DAG runs unchanged.
- `executeGoal`'s 4th `options?` arg is optional; existing callers
  compile unchanged.
- No-op test detection only changes the gate's STATUS reporting —
  the gate still runs to completion. Operators relying on
  `status: 'pass'` for a no-op `npm test` now see `status: 'skip'`.

## [1.3.0] — 2026-05-24

Phase 2 — failed-worktree preservation. Pi-forge can now preserve the
worktree, auto-commit dirty state, tag the failure SHA at a custom
ref, and write a sidecar marker so operators can inspect, salvage, or
purge the failure on their own schedule. Three new CLI subcommands
expose the workflow.

### Added

- **`git.failed_task_behavior` config key** with three modes:
  - `"purge"` (default) — destroy worktree + branch. v1.2.x behaviour.
  - `"preserve"` — auto-commit dirty state, tag SHA at
    `refs/forge/failed/<goal>/<task>`, rename worktree to
    `<path><suffix>`, write `FailedTaskMarker` sidecar.
  - `"tag-and-purge"` — tag the dirty SHA but destroy the worktree
    (lightweight; tag survives for later `git checkout`).
- **`git.failed_worktree_suffix` config key** (default `".failed"`).
  Collisions handled by appending unix-timestamp suffix.
- **`--keep-on-fail` CLI flag** continues to work — now equivalent
  to setting `failed_task_behavior: "preserve"`.
- **`FailedTaskMarker` type** in `src/core/types.ts` — central record
  of a preserved failed task (task/goal ids, branch + tag_ref +
  commit_sha, gate summary, files_modified, recovery_hint,
  operator_commands). Written to
  `.pi/state/failed-tasks/<task-id>.json` and duplicated as
  `<worktree>/.pi-failed.json` for in-tree discoverability.
- **State port CRUD** for failed markers: `saveFailedMarker`,
  `loadFailedMarker`, `listFailedMarkers`, `deleteFailedMarker`.
- **Git port primitives** for preservation:
  - `moveWorktree(from, to)` — `git worktree move` with collision
    handling (target-exists → append unix-ts suffix).
  - `updateRef(ref, sha)` — `git update-ref`. Used to tag failed-task
    SHAs at `refs/forge/failed/<g>/<t>`, surviving branch deletion.
  - `deleteRef(ref)` — `git update-ref -d`. Used by `cleanup --failed`.
  - `listRefs(prefix)` — `git for-each-ref`. Enumerates preserved
    failures.
- **Orchestrator preservation flow** (`ForgeOrchestrator.preserveFailedTask`)
  — 6 steps wrapped in try/catch so a failure in one (e.g., stale
  ref) doesn't abort the others:
  1. Commit dirty state with `wip(<task>): preserved on <gate> failure`.
  2. Tag the SHA at `refs/forge/failed/<goal>/<task>`.
  3. Preserve worktree (rename) or destroy (tag-and-purge).
  4. Save `FailedTaskMarker` to central index.
  5. Write `<worktree>/.pi-failed.json` sidecar.
  6. Emit `'Task failure preserved'` log with operator-action hints.
- **Three new CLI subcommands**:
  - `pi-forge cleanup --failed [--older-than 7d] [--task <id>] [--yes]`
    — purge preserved failures (worktree + tag + marker). Requires
    `--yes` for non-empty purges (CI-friendly); the dry run lists
    candidates.
  - `pi-forge inspect <task-id>` — structured marker summary: header,
    gate table (name / status / exit_code / first stderr line), diff
    stats, recovery hint, ready-to-copy operator commands. Tails
    `git status --porcelain` from the live worktree when present.
  - `pi-forge salvage <task-id> [--to-branch <name>]` — promote
    preserved failure to a regular branch: rename worktree to drop
    `.failed`, rename branch via `git branch -m`, delete tag + marker.
    Default target branch `salvaged/<task-id>`.
- **`parseDurationMs` helper** for `--older-than` (e.g. `7d`, `24h`,
  `30m`).

### Backwards compatibility

- `failed_task_behavior` defaults to `'purge'` — v1.2.x behaviour
  unchanged unless operator opts in.
- All new config keys use `.default()` in Zod — legacy `config.yaml`
  files missing the keys parse cleanly.
- `preserve_worktree_on_failure: true` (from v1.2.2) is shorthand for
  `failed_task_behavior: "preserve"` — existing configs continue to
  work.
- `FailedTaskMarker` is a new type, additive only. Existing
  `ProofArtifact` schema unchanged.

## [1.2.2] — 2026-05-24

Phase 0+1 debuggability + escape-hatch patch. Failed runs are now
diagnosable, and operators can opt-in to preserve the failed worktree
for inspection.

### Added

- **Proof artifact is persisted on gate failure.** Previously the
  artifact was built and then thrown away when gates failed, leaving
  operators with an empty `.pi/state/evidence/<goal>/proofs/`
  directory and no record of which gate failed. Now persisted with
  two new optional fields on `ProofArtifact`:
  - `all_pass: boolean` — true iff every required gate passed/warned.
  - `failed_gates: string[]` — gate names whose status was `fail`.
- **`--keep-on-fail` CLI flag** + **`git.preserve_worktree_on_failure`**
  config key (default `false`). When set, the failure path skips
  `destroyWorktree()`, leaving the dirty worktree for the operator to
  inspect/salvage. The CLI flag is a per-run override (set via
  immutable config spread, no mutation of the cached config).
- **`task_failed` ledger entries on gate failure.** Previously,
  `executeTaskInternal` returned `undefined` silently on gate failure;
  `executeTask` saw the falsy result but wrote nothing to the ledger
  (only thrown worker errors did). The ledger had `task_started` but
  no matching `task_failed`. Now `executeTaskInternal` throws
  `OrchestratorError('Required gate(s) failed: …', 'GATES_FAILED', …)`
  with the failure context attached, and `executeTask`'s catch ledgers
  the entry with `error_code` and any error context.

### Changed

- **Failure logging is structured and detailed.** New
  `'Task failure detected'` log at error level includes
  `failed_gates`, `first_error_line` (first non-blank line of failed
  gate output, capped at 200 chars), `risk_score`, `risk_decision`.
  The `'Critical task failed, aborting goal'` log now includes
  `title`, `level`, and `reason` (from the most-recent matching
  ledger entry).
- **Zod schema accepts `unknown` input.** `forgeConfigSchema` is now
  typed as `z.ZodType<ForgeConfig, z.ZodTypeDef, unknown>` (was
  `z.ZodType<ForgeConfig>`). Required to allow `.default(false)` on
  the new `preserve_worktree_on_failure` field while keeping output
  strictly `ForgeConfig`. Future schema additions using `.default()`
  / `.optional()` will work cleanly under the new signature.

### Backwards compatibility

- `ProofArtifact.{all_pass,failed_gates}` are optional — v1.x
  consumers parse unchanged.
- `ForgeConfig.git.preserve_worktree_on_failure` defaults to `false`
  via Zod — legacy `config.yaml` files missing the key still parse.
- Default behaviour unchanged: failed worktrees are still destroyed
  unless `--keep-on-fail` is passed or `preserve_worktree_on_failure`
  is set in `config.yaml`.

## [1.2.1] — 2026-05-24

End-to-end success patch. Run 1 of pi-forge against a clean scaffold
now passes all gates, commits the worker's edits to the task branch,
and lands them on the session branch via rebase — verified live with
Kimi against `api.kimi.com/coding/v1`.

### Fixed

- **Worker output is now committed.** The orchestrator now runs
  `git add -A && git commit` on the worktree after gates pass and
  before the rebase merge. Previously, the worker wrote untracked
  files, gates passed (against the filesystem), and the merge
  rebased nothing — leaving the session branch with zero of the
  worker's code. Without this fix, "success" was structurally a lie.
- **Default-config branch templates were broken.** Embedded
  `DEFAULT_CONFIG_YAML` had `{taskId}` / `{sessionId}` placeholders
  that the orchestrator never replaced (it only handled `{task_id}` /
  `{sessionId}`). Result: branches named literally
  `forge/task-{taskId}`. Default templates rewritten to
  `forge/task-{task_id}-{slug}` and
  `forge/session-{date}-{goal_slug}`. Orchestrator also accepts both
  snake_case and camelCase aliases for resilience.
- **Worktree-add resilience.** If a previous run left orphan worktree
  state, `git worktree add` would fail with "already exists". The
  adapter now prunes + deletes the conflicting branch and retries
  once before throwing.
- **Worktree-remove uses `--force`.** The worker creates untracked
  files in the worktree (the whole point), making the worktree
  "dirty" by git's reckoning. The previous bare `git worktree remove`
  refused dirty worktrees, blocking cleanup. The fix is safe because
  the worktree is purely ephemeral and any in-flight changes are
  already captured in the proof artifact.
- **Session-branch collision on re-runs.** Same goal on the same day
  hit `forge/session-<date>-<goal_slug>` already exists from prior
  attempts. The git adapter now treats this as legacy state and
  replaces the branch (delete + recreate) so the latest run is the
  authoritative session branch.
- **Proof artifact missing `commit_sha` and accurate diff stats.**
  Artifact was persisted before the commit step. Saved JSON had
  `commit_sha: null` and `files_changed: 0` (because
  `git diff HEAD --stat` ignores untracked files — the worker's first
  output is always untracked). Order swapped: gates → risk → commit →
  re-stat from commit → persist artifact.

### Security

- **API keys no longer leak into spawned subprocess envs.** A new
  `scrubbedEnv()` helper strips `KIMI_CODER_API_KEY`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, and `KIMI_API_KEY` from `process.env` before
  passing it to `git`, `eslint`, `tsc`, `jest`, `npm run *` — anything
  pi-forge spawns. The worker still mutates `process.env` so Pi SDK
  can read the key at request time, but it never propagates outward.
- **`--provider` / `--model` flags are now validated.** The worker
  asserts the same `[A-Za-z0-9_.-]+` pattern that `assertSafeId` uses
  in the state adapter, so a hostile `--model ../../evil` cannot bend
  the SDK's path/URL resolution.

### Changed

- **`max_output_excerpt_length` now honored.** Orchestrator was
  hardcoding 500 chars per gate claim in proof artifacts. It now
  reads `proof_carrying.artifact.max_output_excerpt_length` from
  config (default 2000). Critical for debugging long gate failures.
- **Transient retry events no longer mark tasks as failed.** Pi SDK
  emits `errorMessage` on `auto_retry_start`, `auto_retry_end`, and
  `compaction_end` while the SDK is itself recovering. The worker
  previously latched any of these as `lastError`, marking the entire
  task as failed even after `waitForIdle()` resolved successfully.
  Filter added so only terminal failures flip the result.
- **Safer SDK module narrowing.** Replaced the upfront
  `as PiSdkModule` cast on dynamic import with `unknown` + an
  explicit structural runtime guard. Type-safety and the runtime
  check now have a single source of truth.

## [1.2.0] — 2026-05-24

### Added

- `PiSdkWorkerAdapter` now **registers the `kimi-coder` provider against
  the Pi SDK's `ModelRegistry`** before creating an `AgentSession`. This
  makes autonomous coding work programmatically from outside the Pi
  cockpit — the previous v1.1 worker hit `No API key found for the
  selected model` because no provider was registered. The config is
  identical to what the `pi-kimi-coder` extension passes (same base URL
  `https://api.kimi.com/coding/v1`, same `User-Agent: KimiCLI/1.5`
  header that the Kimi backend explicitly checks, same three models:
  `kimi-for-coding`, `kimi-k2.6`, `kimi-k2-thinking`).
- `WorkerInitOptions.kimiApiKey` — programmatic static credential.
- `WorkerInitOptions.agentDir` — override Pi's user dir if needed.
- `WorkerInitOptions.providerName` / `modelId` — customise selection.
- CLI flags `--kimi-key <key>`, `--model <id>`, `--provider <name>`.
  The CLI reads `process.env.KIMI_CODER_API_KEY` as a fallback.

### Changed

- `worktreePath` now uses `path.join()` instead of string concat, so
  `worktree_base` works whether or not the user includes a trailing
  slash. Fixes the malformed `.pi/worktrees<goal>/<task>` paths that
  appeared in v1.1 logs when running against the embedded default
  config (which had no trailing slash).
- Ambient stub `src/types/pi-coding-agent.d.ts` extended to cover
  `AuthStorage`, `ModelRegistry`, and `ProviderConfigInput`. Branded
  opaque types so ESLint's `no-redundant-type-constituents` doesn't
  collapse `ModelLike | undefined`.

### Authentication paths

The worker now resolves Kimi credentials in this order:

1. `WorkerInitOptions.kimiApiKey` (programmatic).
2. `--kimi-key` CLI flag.
3. `KIMI_CODER_API_KEY` env var.
4. OAuth tokens in `~/.pi/agent/auth.json` (the existing Pi user setup,
   refreshed silently under a file lock).

If none resolve, `worker.init()` still completes (the provider is
registered without auth) but the first `execute()` call will throw at
prompt time with a meaningful upstream error.



### Added

- `WorkerPort` and `PiSdkWorkerAdapter` for autonomous code generation. The
  adapter delegates editing to a Pi Coding Agent session inside each task
  worktree, so authentication and model selection stay in `~/.pi/agent/`.
- `--no-worker` CLI flag to force gates-only mode.
- `isDirty` on `GitPort`, exposed by `GitCliAdapter`, so checkpoints record
  accurate worktree state.
- Tests for the config loader, structured logger, filesystem state adapter,
  and orchestrator failure paths. Total: 50 tests (87% statement / 71%
  branch coverage).
- `validateId` guard in `FilesystemStateAdapter` that rejects path
  components containing characters outside `[A-Za-z0-9_.-]`, hardening
  against deserialized-input path traversal.
- `StatePort.saveEvidenceLedger` so the orchestrator flushes the in-memory
  ledger to disk at goal close — `writeCheckpoint` standalone now sees
  real entries instead of the empty skeleton.
- `executeGoal(goal, context?, signal?)` accepts an AbortSignal; the CLI
  installs a SIGINT handler that aborts the active task.
- Worker `execute(task, worktree, signal?)` forwards the signal end-to-end.
- GitHub Actions workflow `ci.yml` running typecheck, lint, coverage, and
  build on Node 20 and 22.
- GitHub Actions workflow `release.yml` with provenance, `--dry-run` toggle,
  and tag-driven npm publish.
- `prepublishOnly` script and `files` allowlist in `package.json` so only
  `dist/`, extension assets, schemas, and roles ship to the npm registry.
- `peerDependencies` declarations for `@mariozechner/pi-coding-agent` and
  `typebox` (both marked optional via `peerDependenciesMeta`).

### Changed

- Checkpoints now record a real `sha256:<hex>` digest of the serialized task
  graph instead of `sha256-placeholder`.
- Session branch templates support `{date}`, `{goal_slug}`, `{goal_id}`,
  and `{sessionId}` placeholders, replacing brittle string parsing.
- Coverage threshold raised to 80% statements/lines/functions, 70% branches.
- CLI version string read from `package.json` rather than hardcoded.
- Tightened error narrowing in `FilesystemStateAdapter.readJson` so missing
  files reliably return `undefined` under ts-jest ESM realms.
- `GitCliAdapter.isDirty` now uses `git status --porcelain` so the dirty
  check catches untracked files an agent just wrote.
- `PiSdkWorkerAdapter.health()` no longer opens a real agent session — it
  reports `ok: true` once the SDK module has been resolved.
- `WorkerError` no longer double-wraps inner failures in `init`; the
  original cause propagates via the `cause` context field.
- `buildGateConfig` in the CLI now takes a fully-typed `ForgeConfig` and
  no longer relies on `as` casts to satisfy the verifier port.
- `EvidenceLedger.summary` and `closed_at` are now writable in the type
  to reflect their actual write-once-at-close lifecycle.
- Package converted to `"type": "module"` (ESM). This unblocks
  `chalk@5` / `ora@8` (ESM-only) and matches the Pi SDK module type.
- Jest invoked via `node --experimental-vm-modules` to support ts-jest's
  ESM preset; `jest.config.js` renamed to `jest.config.cjs`.

### Security

- Reject path components outside `[A-Za-z0-9_.-]` in the state adapter so a
  hostile `artifact_id` (or deserialized goal id) cannot traverse outside
  the configured base path.
- Release workflow verifies the pushed tag matches `package.json` version
  before publishing, and the publish step now requires a tag ref even on
  `workflow_dispatch`.

### Removed

- Stale `.env` containing a Kimi API key that was rejected when used
  directly from pi-forge. Authentication now lives entirely in
  `~/.pi/agent/auth.json` (managed via `pi auth`).
- Private `isDirty` helper duplicated by the new public method.

## [1.0.0] — 2025-11-15

Initial release. Proof-carrying, hexagonal-core, multi-level coding harness
with task DAG, evidence ledger, mechanical gates, and Pi Coding Agent
extension surface (`pi_forge_plan`, `pi_forge_run`, `pi_forge_status`,
`pi_forge_check`).
