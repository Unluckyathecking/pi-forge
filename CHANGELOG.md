# Changelog

All notable changes to Pi Forge are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
