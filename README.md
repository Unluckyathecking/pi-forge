# Pi Forge

> Proof-carrying, hexagonal-core, multi-level autonomous coding factory.

[![ci](https://github.com/Unluckyathecking/pi-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Unluckyathecking/pi-forge/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-50%2F50-brightgreen)]()
[![Coverage](https://img.shields.io/badge/stmt%20coverage-87%25-brightgreen)]()
[![Branches](https://img.shields.io/badge/branch%20coverage-71%25-green)]()

Pi Forge is a production-grade harness for autonomous code generation. It
treats software development as a deterministic industrial process: every
line of code is forged through specification, proof, verification, and
promotion.

## Philosophy

```
¬CONTRACT_FROZEN(task)  ⟹ ¬IMPLEMENT(task)
¬PROOF_ARTIFACT(task)   ⟹ ¬COMPLETE(task)
¬GATES_PASS(task)       ⟹ ¬PROMOTE(task)
¬REVIEW_PASS(task)      ⟹ ¬MERGE(task)
```

**No contract, no code. No proof, no completion. No gate pass, no
promotion. No review pass, no merge.**

## Two surfaces

Pi Forge ships both as a **programmatic CLI** and as a **Pi Coding Agent
extension**:

| Surface       | Entry point                                | When to use                                                  |
| ------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Interactive   | `pi --provider kimi-coder` + `/forge ...`  | Day-to-day development inside a Pi session.                  |
| Programmatic  | `npx pi-forge forge <goal>`                | Batch runs, CI hooks, automation, replays.                   |

Both share the same orchestrator, planner, gates, and evidence ledger.

## Quick start

```bash
# Install dependencies
npm install

# Build
npm run build:clean

# Plan a goal without touching the codebase
npm run dev -- forge "Add user authentication" --dry-run

# Run with execution (requires Pi SDK to be installed for the worker;
# otherwise falls back to gates-only mode)
npm run dev -- forge "Add user authentication"

# Force gates-only mode (no worker)
npm run dev -- forge "Add user authentication" --no-worker

# Inspect saved state
npm run dev -- status
```

## Interactive Pi/Kimi workflow

When attached to Pi as a package, Kimi is the coding agent and Pi Forge
provides planning, verification, and evidence tooling.

```bash
# One-time setup if this repo has not been attached to Pi yet
pi install -l .

# Start interactive Pi with Kimi Code
pi --provider kimi-coder --model kimi-for-coding
```

Inside Pi:

```text
/forge Add user authentication
/forge-plan Add user authentication
/forge-status
```

The extension registers these model-callable tools:

| Tool              | Effect                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| `pi_forge_plan`   | `pi-forge forge <goal> --dry-run --config config.yaml`                                  |
| `pi_forge_run`    | `pi-forge forge <goal> --config config.yaml` (spawns a worker if Pi SDK is installed)   |
| `pi_forge_status` | Inspect saved Pi Forge task graphs and evidence ledgers                                 |
| `pi_forge_check`  | `npm run check` (typecheck + lint + tests with coverage)                                |

## Authentication

Pi Forge **does not own an API key**. All LLM authentication lives in
`~/.pi/agent/auth.json` and is managed by Pi (`pi auth login kimi-coder`).

When the worker is enabled, Pi Forge dynamically imports
`@mariozechner/pi-coding-agent` and lets Pi handle:

- credential storage,
- token refresh,
- model selection,
- thinking-level configuration.

This is intentional: direct Kimi API calls from non-Pi clients are rejected
upstream. Routing through the Pi SDK keeps everything on the supported
path.

If you run pi-forge standalone (outside a Pi-managed shell), simply
install Pi globally first:

```bash
npm install -g @mariozechner/pi-coding-agent
pi auth login kimi-coder
```

Then `pi-forge forge <goal>` will reuse the same credentials.

## Architecture

Pi Forge uses a **hexagonal core** with swappable adapters:

```
External Adapters  ──▶  git, shell, Pi SDK, MCP, …
        │
        ▼
Ports              ──▶  GitPort  StatePort  VerifierPort
                       PlannerPort  WorkerPort  ModelPort
        │
        ▼
Orchestration Core ──▶  policies · task DAG · state machine
```

### Multi-level abstraction ladder

| Level | Scope               | Example                                |
| ----- | ------------------- | -------------------------------------- |
| L0    | Project scaffolding | New repo, build system, deployment     |
| L1    | Module/component    | Feature, service, page, API group      |
| L2    | Function/class      | Implementation inside existing module  |
| L3    | Line-level          | Refactor, bug fix, optimization        |

### Proof-carrying pipeline

Every task must produce a **proof artifact** with machine-readable
evidence:

1. **Decompose** goal into task graph with contracts
2. **Execute** each task in an isolated git worktree (the worker writes
   the code; pi-forge does not call any LLM directly)
3. **Verify** with mechanical gates (lint, typecheck, test, build,
   security scan)
4. **Review** design, edge cases, maintainability
5. **Merge** verified work into a session branch
6. **Report** durable evidence of what changed and what passed

## Project structure

```
pi-forge/
├── src/
│   ├── core/
│   │   ├── types.ts          # Domain types
│   │   ├── errors.ts         # Custom errors
│   │   └── orchestrator.ts   # Main execution engine
│   ├── ports/
│   │   ├── git.ts            # GitPort interface
│   │   ├── state.ts          # StatePort interface
│   │   ├── verifier.ts       # VerifierPort interface
│   │   ├── planner.ts        # PlannerPort interface
│   │   ├── worker.ts         # WorkerPort interface
│   │   └── model.ts          # ModelPort interface
│   ├── adapters/
│   │   ├── git.ts            # Git CLI adapter
│   │   ├── state.ts          # Filesystem state adapter
│   │   ├── verifier.ts       # Local command verifier
│   │   ├── planner.ts        # Rule-based planner
│   │   └── worker.ts         # Pi SDK worker adapter
│   ├── utils/
│   │   ├── config.ts         # YAML + zod config loader
│   │   ├── logger.ts         # Structured JSON logger
│   │   └── helpers.ts        # Shared utilities
│   ├── types/
│   │   └── pi-coding-agent.d.ts  # Ambient stub for the Pi SDK
│   └── cli/
│       └── index.ts          # CLI entry point
├── extensions/
│   └── pi-forge.ts           # Pi Coding Agent extension
├── schemas/
│   ├── task-graph.json
│   ├── proof-artifact.json
│   ├── evidence-ledger.json
│   └── state-checkpoint.json
├── roles/                    # Agent role specifications
├── tests/unit/               # Jest unit tests (50 tests, 87% statements / 71% branches)
├── .github/workflows/        # ci.yml, release.yml
├── ARCHITECTURE.md           # Full architecture document
├── CHANGELOG.md
├── config.yaml               # Default harness configuration
└── README.md                 # This file
```

## CLI commands

| Command                          | Description                       |
| -------------------------------- | --------------------------------- |
| `pi-forge forge <goal>`          | Execute a goal                    |
| `pi-forge forge <goal> --dry-run`| Plan only                         |
| `pi-forge forge <goal> --no-worker` | Run gates-only (no agent edits) |
| `pi-forge status`                | List active goals                 |
| `pi-forge status --goal <id>`    | Show a specific goal              |

## Quality gates

```bash
npm run check        # typecheck + lint + tests with coverage
npm run typecheck    # TypeScript strict mode
npm run lint         # ESLint with @typescript-eslint
npm run test         # Jest unit tests
npm run test:coverage
npm run build:clean
```

Coverage thresholds (enforced by Jest):

| Metric     | Floor |
| ---------- | ----- |
| Statements | 80%   |
| Lines      | 80%   |
| Functions  | 80%   |
| Branches   | 70%   |

## Configuration

Edit `config.yaml` to tune:

- **Approval mode**: `auto`, `confirm`, or `review`
- **Gate thresholds**: coverage, risk scores
- **Agent pool sizes**
- **Architecture variant enablement**

Environment variables prefixed with `FORGE_` override config values using
`__` as the path separator, e.g.
`FORGE_GATES__MECHANICAL__TEST__COVERAGE_THRESHOLD=90`.

## Agent roles

| Role         | Responsibility                                      |
| ------------ | --------------------------------------------------- |
| Coordinator  | Decompose, delegate, integrate, escalate            |
| Planner      | Task graphs, contracts, proof requirements          |
| Coder        | Implementation against frozen contracts             |
| Reviewer     | Adversarial design/correctness review               |
| QA           | Tests, reproduction, regression detection           |
| Security     | Secrets, injection, dependency audit                |
| Integrator   | Merge, conflict resolution, promotion               |

## Architecture variants

Pi Forge starts with **Proof-Carrying Code** as its spine. Additional
architectures can be enabled as modules:

- **Speculative Execution** — Parallel strategies for ambiguous tasks
- **Capability-Based Routing** — Route by capability, not role
- **Competitive Co-Evolution** — Builder vs. breaker pairs
- **Self-Modifying Harness** — Learn and improve from telemetry
- **Constraint-Satisfaction** — Search for plans satisfying constraints

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design.

## Release process

1. Update `CHANGELOG.md` under `[Unreleased]` with all user-visible changes.
2. Bump `version` in `package.json` and move the `Unreleased` block to the
   new version heading.
3. `git tag v<version> && git push --tags`.
4. The `release.yml` workflow runs `prepublishOnly` (full quality gates
   plus a clean build), then publishes to npm with provenance.

## License

MIT
