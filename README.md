# Pi Forge

> Proof-carrying, hexagonal-core, multi-level autonomous coding factory

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20+-green)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-20%2F20-brightgreen)]()

Pi Forge is a production-grade harness for autonomous code generation. It treats software development as a deterministic industrial process: every line of code is forged through specification, proof, verification, and promotion.

## Philosophy

```
¬CONTRACT_FROZEN(task)  ⟹ ¬IMPLEMENT(task)
¬PROOF_ARTIFACT(task)   ⟹ ¬COMPLETE(task)
¬GATES_PASS(task)       ⟹ ¬PROMOTE(task)
¬REVIEW_PASS(task)      ⟹ ¬MERGE(task)
```

**No contract, no code. No proof, no completion. No gate pass, no promotion. No review pass, no merge.**

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run a goal (dry-run to plan only)
npm run dev -- forge "Add user authentication" --dry-run

# Run with execution
npm run dev -- forge "Add user authentication"

# Check status
npm run dev -- status
```

## Architecture

Pi Forge uses a **hexagonal core** with swappable adapters:

```
External Adapters (git, shell, LLMs, MCP)
         │
         ▼
    Ports (GitPort, VerifierPort, StatePort, PlannerPort)
         │
         ▼
  Orchestration Core (policies, task DAG, state machine)
```

### Multi-Level Abstraction Ladder

| Level | Scope | Example |
|-------|-------|---------|
| L0 | Project scaffolding | New repo, build system, deployment |
| L1 | Module/component | Feature, service, page, API group |
| L2 | Function/class | Implementation inside existing module |
| L3 | Line-level | Refactor, bug fix, optimization |

### Proof-Carrying Pipeline

Every task must produce a **proof artifact** with machine-readable evidence:

1. **Decompose** goal into task graph with contracts
2. **Execute** each task in an isolated git worktree
3. **Verify** with mechanical gates (lint, typecheck, test, build, security)
4. **Review** design, edge cases, maintainability
5. **Merge** verified work into a session branch
6. **Report** durable evidence of what changed and what passed

## Project Structure

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
│   │   └── model.ts          # ModelPort interface
│   ├── adapters/
│   │   ├── git.ts            # Git CLI adapter
│   │   ├── state.ts          # Filesystem state adapter
│   │   ├── verifier.ts       # Local command verifier
│   │   └── planner.ts        # Rule-based planner
│   ├── utils/
│   │   ├── config.ts         # Config loader
│   │   ├── logger.ts         # Structured logger
│   │   └── helpers.ts        # Utilities
│   └── cli/
│       └── index.ts          # CLI entry point
├── schemas/
│   ├── task-graph.json       # Task graph JSON Schema
│   ├── proof-artifact.json   # Proof artifact JSON Schema
│   ├── evidence-ledger.json  # Evidence ledger JSON Schema
│   └── state-checkpoint.json # Checkpoint JSON Schema
├── roles/                    # Agent role specifications
├── tests/
│   └── unit/                 # Unit tests
├── ARCHITECTURE.md           # Full architecture document
├── config.yaml               # Harness configuration
└── README.md                 # This file
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `pi-forge forge <goal>` | Execute a goal |
| `pi-forge forge <goal> --dry-run` | Plan only |
| `pi-forge status` | Show active goals |
| `pi-forge status --goal <id>` | Show specific goal |

## Quality Gates

```bash
# Run all gates
npm run check

# Individual gates
npm run typecheck    # TypeScript strict mode
npm run lint         # ESLint with @typescript-eslint
npm run test         # Jest unit tests
npm run build        # Compile to dist/
```

## Configuration

Edit `config.yaml` to tune:

- **Approval mode**: `auto`, `confirm`, or `review`
- **Gate thresholds**: coverage, risk scores
- **Agent pool sizes**
- **Architecture variant enablement**

## Agent Roles

| Role | Responsibility |
|------|----------------|
| **Coordinator** | Decompose, delegate, integrate, escalate |
| **Planner** | Task graphs, contracts, proof requirements |
| **Coder** | Implementation against frozen contracts |
| **Reviewer** | Adversarial design/correctness review |
| **QA** | Tests, reproduction, regression detection |
| **Security** | Secrets, injection, dependency audit |
| **Integrator** | Merge, conflict resolution, promotion |

## Architecture Variants

Pi Forge starts with **Proof-Carrying Code** as its spine. Additional architectures can be enabled as modules:

- **Speculative Execution** — Parallel strategies for ambiguous tasks
- **Capability-Based Routing** — Route by capability, not role
- **Competitive Co-Evolution** — Builder vs. breaker pairs
- **Self-Modifying Harness** — Learn and improve from telemetry
- **Constraint-Satisfaction** — Search for plans satisfying constraints

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design.

## License

MIT
