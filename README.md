# Pi Forge

> Proof-carrying, hexagonal-core, multi-level autonomous coding factory.

[![ci](https://github.com/Unluckyathecking/pi-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Unluckyathecking/pi-forge/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Pi Forge is a harness for autonomous code generation. It treats software
development as a deterministic industrial process: every change is forged
through specification, proof, verification, and promotion. An agent that
claims success has to attach machine-readable evidence, and nothing
merges until the gates agree.

## Philosophy

```
¬CONTRACT_FROZEN(task)  ⟹ ¬IMPLEMENT(task)
¬PROOF_ARTIFACT(task)   ⟹ ¬COMPLETE(task)
¬GATES_PASS(task)       ⟹ ¬PROMOTE(task)
¬REVIEW_PASS(task)      ⟹ ¬MERGE(task)
```

**No contract, no code. No proof, no completion. No gate pass, no
promotion. No review pass, no merge.**

## What it does

Give Pi Forge a goal inside a git repository and it:

1. decomposes the goal into a task DAG,
2. runs a Kimi-backed Pi SDK agent inside an isolated git worktree per
   task (pi-forge itself never calls an LLM),
3. runs mechanical gates against the worker's output: lint, typecheck,
   test, build,
4. scores the diff for risk and writes a proof artifact per task,
5. merges passing tasks into a session branch and leaves an evidence
   ledger recording what changed and what passed.

Failed tasks can be preserved together with their worktree, then
inspected, salvaged into a regular branch, or purged on your own
schedule.

## When not to use it

- One-file fixes. An interactive session is faster than a planned DAG.
- Repositories without gates. If there is no lint, typecheck, or test
  script to run, the proof-carrying loop has nothing to verify.
- Anything outside git. Worktree isolation is the containment model, so
  a git repository is required.

## Two surfaces

Pi Forge ships both as a CLI and as a Pi Coding Agent extension:

| Surface       | Entry point                                | When to use                                  |
| ------------- | ------------------------------------------ | -------------------------------------------- |
| Interactive   | `pi --provider kimi-coder` + `/forge ...`  | Day-to-day development inside a Pi session.  |
| Programmatic  | `pi-forge forge <goal>`                    | Batch runs, CI hooks, automation, replays.   |

Both share the same orchestrator, planner, gates, and evidence ledger.

## Quick start

Pi Forge runs from a checkout:

```bash
git clone https://github.com/Unluckyathecking/pi-forge.git
cd pi-forge
npm ci
npm run build:clean
npm link        # puts the pi-forge command on your PATH
```

Then, inside the repository you want to change:

```bash
# Plan a goal without touching anything
pi-forge forge "Add input validation to the config loader" --dry-run

# Execute. The worker needs the Pi SDK; without it, pi-forge
# falls back to gates-only mode.
pi-forge forge "Add input validation to the config loader"

# Force gates-only mode (no agent edits)
pi-forge forge "Add input validation to the config loader" --no-worker

# Watch a running goal from another terminal
pi-forge watch <goal-id>

# Inspect saved state
pi-forge status
pi-forge stats
```

Inside the pi-forge checkout itself, `npm run dev -- forge ...` runs the
CLI through tsx without a build.

## Authentication

The worker talks to Kimi through the Pi SDK
(`@mariozechner/pi-coding-agent`); pi-forge stores no credentials of its
own. Keys resolve in this order:

1. `--kimi-key <key>` on the CLI (or `kimiApiKey` when embedding),
2. the `KIMI_CODER_API_KEY` environment variable,
3. OAuth tokens in `~/.pi/agent/auth.json`, managed by
   `pi auth login kimi-coder`.

Whichever wins is handed to the SDK at request time and stripped from
the environment of every subprocess pi-forge spawns (git, eslint, tsc,
jest), so gate commands never see it.

To set up the Pi route:

```bash
npm install -g @mariozechner/pi-coding-agent
pi auth login kimi-coder
```

Direct Kimi API calls from non-Pi clients are rejected upstream, so
routing through the Pi SDK is the supported path.

## Interactive Pi workflow

When attached to Pi as a package, Kimi is the coding agent and Pi Forge
supplies planning, verification, and evidence tooling.

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

| Tool              | Effect                                                    |
| ----------------- | --------------------------------------------------------- |
| `pi_forge_plan`   | `pi-forge forge <goal> --config config.yaml --dry-run`    |
| `pi_forge_run`    | `pi-forge forge <goal> --config config.yaml`              |
| `pi_forge_status` | Inspect saved task graphs and evidence ledgers            |
| `pi_forge_check`  | `npm run check` (typecheck + lint + tests with coverage)  |

## Architecture

Pi Forge uses a hexagonal core with swappable adapters:

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

Every task must produce a proof artifact with machine-readable evidence:

1. Decompose the goal into a task graph with contracts
2. Execute each task in an isolated git worktree (the worker writes the
   code; pi-forge does not call any LLM directly)
3. Verify with mechanical gates (lint, typecheck, test, build)
4. Score the diff for risk
5. Merge verified work into a session branch
6. Report durable evidence of what changed and what passed

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## CLI commands

| Command                                          | Description                                     |
| ------------------------------------------------ | ----------------------------------------------- |
| `pi-forge forge <goal>`                          | Execute a goal                                  |
| `pi-forge forge <goal> --dry-run`                | Plan only                                       |
| `pi-forge forge <goal> --no-worker`              | Run gates-only (no agent edits)                 |
| `pi-forge forge <goal> --tasks implement`        | Run a subset of the decomposed task graph       |
| `pi-forge forge <goal> --keep-on-fail`           | Preserve the worktree when gates fail           |
| `pi-forge status [--goal <id>]`                  | List goals, or show one                         |
| `pi-forge watch <goal-id>`                       | Tail the evidence ledger of a running goal      |
| `pi-forge stats [--goal <id>] [--last <n>]`      | Outcomes and durations across goals             |
| `pi-forge inspect <task-id>`                     | Summarize a preserved failed task               |
| `pi-forge salvage <task-id> [--to-branch <b>]`   | Promote a preserved failure to a normal branch  |
| `pi-forge cleanup --failed [--older-than 7d]`    | Purge preserved failures (add `--yes` to apply) |
| `pi-forge init-plan`                             | Scaffold a PLAN.md interactively                |

`forge` also accepts `--config <path>`, `--kimi-key <key>`,
`--model <id>`, and `--provider <name>`.

## Failed tasks

By default a failing task's worktree is destroyed. Set
`git.failed_task_behavior: "preserve"` in `config.yaml`, or pass
`--keep-on-fail`, and pi-forge instead commits the dirty state, tags it
at `refs/forge/failed/<goal>/<task>`, renames the worktree, and writes a
marker. `inspect` shows what failed, `salvage` turns the work into a
regular branch, and `cleanup --failed` purges what you no longer want.

## Project structure

```
pi-forge/
├── src/
│   ├── core/            # domain types, errors, the orchestrator
│   ├── ports/           # GitPort, StatePort, VerifierPort,
│   │                    # PlannerPort, WorkerPort, ModelPort
│   ├── adapters/        # git CLI, filesystem state, local command
│   │                    # verifier, rule-based planner, Pi SDK worker
│   ├── cli/             # CLI entry point + PLAN.md template
│   ├── utils/           # config loader, structured logger, helpers
│   └── types/           # ambient stub for the Pi SDK
├── extensions/
│   └── pi-forge.ts      # Pi Coding Agent extension
├── schemas/             # task graph, proof artifact, evidence
│                        # ledger, state checkpoint
├── roles/               # agent role specifications
├── tests/unit/          # Jest unit tests
├── config.yaml          # default harness configuration
├── ARCHITECTURE.md      # full architecture document
└── CHANGELOG.md
```

## Quality gates

```bash
npm run check        # typecheck + lint + tests with coverage
npm run typecheck    # TypeScript strict mode
npm run lint         # ESLint with @typescript-eslint
npm run test         # Jest unit tests
npm run test:coverage
npm run build:clean
```

Jest enforces coverage floors of 80% statements, lines, and functions
and 70% branches, collected over the core, ports, utils, and the state
and planner adapters. The CLI and the shell-heavy adapters have tests
too but sit outside threshold collection.

## Configuration

`config.yaml` holds the harness configuration: gate toggles and
thresholds, branch templates, worktree behavior, failed-task handling,
approval boundaries, and lifecycle hooks. Environment variables prefixed
with `FORGE_` override any value, using `__` as the path separator:

```bash
FORGE_GATES__MECHANICAL__TEST__COVERAGE_THRESHOLD=90
```

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

Role specifications live in [`roles/`](roles/).

## Architecture variants

The proof-carrying pipeline is the spine and the only variant enabled by
default. Speculative execution, capability-based routing, competitive
co-evolution, a self-modifying harness, and constraint-satisfaction
planning are sketched as pluggable modules in `config.yaml` and
[ARCHITECTURE.md](ARCHITECTURE.md); all of them are currently disabled.

## Release process

1. Move the `[Unreleased]` block in `CHANGELOG.md` to a new version
   heading and bump `version` in `package.json`.
2. `git tag v<version> && git push --tags`.
3. The release workflow re-runs the quality gates, checks that the tag
   matches `package.json`, and publishes with npm provenance.

## Contributing

Pi Forge is one maintainer's tool; issues and pull requests are welcome.
[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the `npm run check`
gate, and pull request expectations. The
[code of conduct](CODE_OF_CONDUCT.md) applies in all project spaces.

## Security

Report vulnerabilities privately through GitHub's advisory flow rather
than a public issue. Scope and details are in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
