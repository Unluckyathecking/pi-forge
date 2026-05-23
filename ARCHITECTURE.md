# Pi Forge: Production-Grade Autonomous Coding Harness

> **Version:** 1.0.0  
> **Codename:** Forge  
> **Classification:** Production Harness Architecture  
> **Synthesized From:** Killed Planner Recovery + 30-Agent Swarm Designs  
> **Target:** Autonomous, clean, efficient, production-ready code and applications  
> **Pi Compatibility:** v0.75.5+

---

## 1. Philosophy: Forge, Don't Guess

Pi Forge treats software development as a **deterministic industrial process**, not a creative guessing game. Every line of code is forged through specification, proof, verification, and promotion. Nothing reaches production unverified. Nothing is implemented without a contract.

This architecture is the synthesis of a killed planner's vision (recovered from `docs/2026-05-23/killed-planner-architectures.md`) and 30 swarm architecture designs. The killed planner reached for a proof-carrying, git-isolated, multi-agent coding factory. Pi Forge realizes that vision with concrete schemas, roles, and tooling.

### 1.1 Core Invariants

```
¬CONTRACT_FROZEN(task)  ⟹ ¬IMPLEMENT(task)
¬PROOF_ARTIFACT(task)   ⟹ ¬COMPLETE(task)
¬GATES_PASS(task)       ⟹ ¬PROMOTE(task)
¬REVIEW_PASS(task)      ⟹ ¬MERGE(task)
```

In plain terms: **no contract, no code; no proof, no completion; no gate pass, no promotion; no review pass, no merge.**

### 1.2 Design Principles

| Principle | Meaning |
|-----------|---------|
| **Proof-Carrying** | Every agent must attach machine-readable evidence before claiming success |
| **Hexagonal Core** | Orchestrator depends on ports, not tools; adapters are swappable |
| **Git-Native Isolation** | Every task runs in its own worktree and branch |
| **Multi-Level Abstraction** | Same pattern at every scale: L0 project → L1 module → L2 function → L3 line |
| **Deterministic Verification** | Mechanical gates run before any agent review |
| **Durable State** | Goals, task graphs, evidence, and checkpoints are first-class, not chat transcripts |

---

## 2. System Architecture

### 2.1 High-Level Flow

```
User Goal
    │
    ▼
┌─────────────────┐
│ Intent Intake   │  Parse goal, constraints, budget, approval mode
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Planning Core   │  Decompose into task graph + contracts + proof requirements
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌──────────┐
│Memory │ │ Evidence │  Durable state for resumption and audit
│ Index │ │ Ledger   │
└───┬───┘ └────┬─────┘
    │          │
    └────┬─────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              PARALLEL WORKTREE EXECUTION                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Worktree A│  │Worktree B│  │Worktree C│              │
│  │ Coder    │  │ QA       │  │ Reviewer │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                      │
│       └─────────────┴─────────────┘                      │
│                     │                                    │
│                     ▼                                    │
│         ┌───────────────────┐                           │
│         │ Verification Gate │  lint → typecheck → test  │
│         │                   │  → build → security_scan   │
│         └─────────┬─────────┘                           │
│                   │                                      │
│         ┌────────┴────────┐                             │
│         │                 │                             │
│         ▼                 ▼                             │
│   ┌──────────┐     ┌──────────┐                        │
│   │  MERGE   │     │  REPAIR  │                        │
│   │  Path    │     │  Path    │                        │
│   └──────────┘     └──────────┘                        │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   Integrator    │  Compose outputs, resolve conflicts, run integration tests
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Merge Gate    │  Final review, risk score, promotion to main
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Evidence Report │  Durable summary: what changed, what passed, what remains
└─────────────────┘
```

### 2.2 Hexagonal Core

The orchestrator core has **zero direct dependencies** on specific tools, models, file systems, git commands, or MCP servers. Everything sits behind ports and adapters.

```
              ┌─────────────────────────────┐
              │      External Adapters      │
              │  git, shell, browser, LLMs  │
              │  MCP, CI, filesystem, VCS   │
              └─────────────┬───────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │           Ports             │
              │  PlannerPort                │
              │  WorkerPort                 │
              │  VerifierPort               │
              │  EvidencePort               │
              │  GitPort                    │
              │  ModelPort                  │
              └─────────────┬───────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │     Orchestration Core      │
              │  policies, task DAG,        │
              │  state machine,             │
              │  merge decisions            │
              └─────────────────────────────┘
```

This keeps the system replaceable:
- Swap Kimi, Codex, Claude, or local models without rewriting the core.
- Swap git CLI, GitHub API, or another VCS adapter.
- Swap verification commands per repo.
- Run the same core locally, in CI, or as a long-running service.

---

## 3. Multi-Level Abstraction Ladder

Every task is classified into one of four levels. Each level owns a different granularity of change.

| Level | Scope | Primary Agent Behavior | Output | Typical Duration |
|-------|-------|------------------------|--------|-----------------|
| **L0** | Project/repo scaffolding | Create or reshape app skeletons, package boundaries, build setup, deployment shape | Project structure and baseline contracts | 4–12 hours |
| **L1** | Module/component generation | Build features, modules, services, pages, endpoints, and integration surfaces | Working vertical slices | 2–8 hours |
| **L2** | Function/class implementation | Implement local behavior inside an existing module | Tested implementation units | 30 min–2 hours |
| **L3** | Line-level refactoring/optimization | Tight fixes, performance improvements, cleanup, mechanical edits | Small verified diffs | 10–60 min |

### Escalation Rules

- **Escalate L3/L2 → L1** when local edits reveal a missing module boundary.
- **Escalate L1 → L0** when the repo structure or build system blocks the requested feature.
- **De-escalate L0/L1 → L2/L3** once the architecture and contracts are stable.
- **Pause for human approval** when escalation changes product scope, public API, data model, deployment topology, or security posture.

---

## 4. Proof-Carrying Pipeline (MVP Spine)

The killed planner's strongest preference was proof-carrying work: agents should not merely claim success; they should attach proof artifacts.

### 4.1 Pipeline Flow

```
Task Decomposer
  -> Proof Requirements (per task)
  -> Coder Agent
  -> Code + Proof Artifact
  -> Mechanical Proof Verifier
  -> Reviewer / Oracle
  -> Merge
```

### 4.2 Proof Artifact Schema

See [`schemas/proof-artifact.json`](./schemas/proof-artifact.json). Every proof artifact contains:

- **Claims**: A list of gate results (lint, typecheck, test, build, security_scan, etc.)
- **Command executed, exit code, output excerpt**
- **Artifact paths, timestamps, worktree, commit SHA**
- **Summary**: files changed, lines added/removed, tests added, duration

### 4.3 Baseline Gates

| Gate | Command Example | Blocking |
|------|-----------------|----------|
| **Lint** | `eslint src/` | Yes |
| **Typecheck** | `tsc --noEmit` | Yes |
| **Test** | `npm test` | Yes |
| **Build** | `npm run build` | Yes |
| **Security Scan** | `secret-scan`, `dependency-audit` | Yes (critical only) |
| **Contract Verify** | Compare impl against frozen contracts | Yes |
| **Diff Review** | Pattern scan for suspicious changes | Advisory |

The reviewer focuses on **design, edge cases, maintainability, and product fit**. It does not spend its budget checking things that a deterministic command can check.

---

## 5. Agent Roles

Each role operates under explicit contracts:

- **Inputs**: task, scope, constraints, relevant context, allowed tools.
- **Outputs**: diff, evidence, notes, open risks, next action.
- **Stop condition**: verified success, blocked with evidence, or approval required.

### Role Matrix

| Role | Purpose | Key Tools | See |
|------|---------|-----------|-----|
| **Coordinator** | Decompose, delegate, integrate, escalate | `task_graph_create`, `worktree_create`, `checkpoint_write` | [`roles/coordinator.md`](./roles/coordinator.md) |
| **Planner** | Task graphs, contracts, proof requirements | `draft_contract`, `freeze_contract`, `impact_analysis` | [`roles/planner.md`](./roles/planner.md) |
| **Coder** | Implementation in isolated worktrees | `write_code`, `run_tests`, `proof_artifact_create` | [`roles/coder.md`](./roles/coder.md) |
| **Reviewer** | Adversarial design and correctness review | `diff_review`, `risk_score`, `block_promote` | [`roles/reviewer.md`](./roles/reviewer.md) |
| **QA** | Tests, reproduction, user flow verification | `test.unit`, `test.integration`, `test.e2e` | *(uses Coder + Reviewer tools)* |
| **Security** | Secrets, trust boundaries, injection, dependencies | `security_scan`, `dependency_audit`, `block_promote` | [`roles/security.md`](./roles/security.md) |
| **Integrator** | Merge, conflict resolution, integration tests | `worktree_merge`, `resolve_conflict`, `contract_verify` | [`roles/integrator.md`](./roles/integrator.md) |

---

## 6. Git Integration

Git is the isolation and recovery backbone.

### 6.1 Branch Pattern

```
main
  pi/session/<date>-<goal>
    pi/task/<task-id>-<slug>
    pi/task/<task-id>-<slug>
    pi/task/<task-id>-<slug>
```

### 6.2 Workflow

1. Planner creates a task graph.
2. Integrator creates one worktree and branch per independent task.
3. Agents commit small, evidence-backed changes.
4. Verification runs inside each worktree.
5. Integrator merges passing branches into the session branch.
6. Session branch gets reviewed as the final candidate.
7. Failed branches are retained until evidence is extracted, then deleted or archived.

### 6.3 Commit Conventions

- One commit per coherent task result.
- Commit message includes task id and evidence summary.
- No merge until lint/type/test/build gates pass for that branch.
- Rollback uses normal git revert plus the evidence ledger to explain why.

---

## 7. State Model

State is first-class, not hidden in chat transcripts.

### 7.1 Durable State

| Entity | Schema | Purpose |
|--------|--------|---------|
| **Task Graph** | [`schemas/task-graph.json`](./schemas/task-graph.json) | Dependencies, owners, status, worktrees, branches |
| **Proof Artifact** | [`schemas/proof-artifact.json`](./schemas/proof-artifact.json) | Gate results, commands, outputs |
| **Evidence Ledger** | [`schemas/evidence-ledger.json`](./schemas/evidence-ledger.json) | Complete audit log of actions and decisions |
| **State Checkpoint** | [`schemas/state-checkpoint.json`](./schemas/state-checkpoint.json) | Recovery point for resuming interrupted sessions |

### 7.2 State Paths

```
.pi/
├── state/
│   ├── task-graphs/{goal_id}.json
│   ├── evidence/{goal_id}/ledger.json
│   ├── evidence/{goal_id}/proofs/{artifact_id}.json
│   ├── checkpoints/{checkpoint_id}.json
│   ├── decisions/{goal_id}.json
│   └── memory/project-conventions.json
├── contracts/
│   └── v{N}/ ...
└── worktrees/
    └── {task_id}/ ...
```

### 7.3 Recovery Checkpoints

Every long-running agent writes a checkpoint before:
- Spawning subagents
- Starting destructive operations
- Any operation expected to take >5 minutes

The killed planner's most important lesson: **every planner or subagent needs a hard write checkpoint before doing more research.**

---

## 8. Quality Gates

### 8.1 Gate Pipeline

```
Subagent Output
  -> Format / Lint
  -> Typecheck
  -> Unit Tests
  -> Integration / Build
  -> Security Scan
  -> Evidence Completeness Check
  -> Reviewer / Oracle Pass
  -> Merge
```

### 8.2 Risk Scoring

| Component | Weight | Source |
|-----------|--------|--------|
| Policy violations | 0.30 | Security scan, protected files |
| Suspicious patterns | 0.25 | Diff scan, deny patterns |
| Test failures | 0.20 | Test gate results |
| Contract drift | 0.15 | Contract verification |
| Diff size anomaly | 0.10 | Lines changed vs. estimate |

**Thresholds:**
- **0–25**: Auto-promote
- **26–50**: User confirm
- **51–75**: Security review required
- **76–100**: Auto-deny

---

## 9. Architecture Variants (Pluggable Modules)

Pi Forge starts with the Proof-Carrying Pipeline as its spine. Additional architectures attach as modules.

### Variant 1: Proof-Carrying Code (ENABLED — MVP Spine)
Every task includes proof requirements before implementation. The coding agent produces both code and evidence. A mechanical verifier checks evidence before review.

**Best for:** All tasks. This is the baseline.

### Variant 2: Speculative Execution (DISABLED — v2)
For ambiguous tasks, launch multiple independent strategies in parallel worktrees. Kill or pause losing branches early when evidence shows they are slower, riskier, or drifting.

**Best for:** UI implementation with several possible designs, bug fixes with uncertain root cause, performance optimization.

**Early-kill signals:** Failing tests with no progress, growing diff without evidence, incompatible architectural direction, tool-call exhaustion.

### Variant 3: Capability-Based Composition (DISABLED — v2)
Instead of fixed role names, route tasks to agents based on declared capabilities (`typescript.refactor`, `react.ui`, `security.review`).

**Best for:** Heterogeneous agent pools, multiple model backends, long-running systems that learn which agent is good at what.

### Variant 4: Competitive Co-Evolution (DISABLED — v2)
Use adversarial pairs: builder vs. breaker. One agent builds, another tries to exploit or invalidate.

**Best for:** Security-sensitive code, API boundary hardening, test quality improvement.

**Policy:** Opt-in only. Costs more tokens and time.

### Variant 5: Self-Modifying Harness (DISABLED — production)
The harness learns from completed runs and proposes improvements to its own prompts, policies, routing, and templates.

**Best for:** Long-running projects, repeated task types, reducing recurring failures.

**Safety rule:** The harness may propose changes but must not silently rewrite control policies. Self-modification goes through evidence, review, and rollback just like product code.

### Variant 6: Constraint-Satisfaction (DISABLED — production)
Represent the requested system as constraints, then search for an implementation plan that satisfies them.

**Best for:** Complex interdependent tasks, large refactors, multi-module changes.

---

## 10. Human Approval Boundaries

The system pauses before:

- Deleting data
- Changing auth, secrets, billing, or deployment
- Adding new external services
- Making large dependency upgrades
- Modifying public APIs or schemas
- Merging high-risk branches with incomplete evidence
- Continuing after repeated verifier failures

---

## 11. Configuration

See [`config.yaml`](./config.yaml) for all tunable parameters and [`pi.json`](./pi.json) for the Pi extension manifest.

---

## 12. Build Order

The killed planner's recommended build order, preserved:

1. **Build Proof-Carrying Code Pipeline first.** (DONE — this architecture)
2. Add Speculative Execution for uncertain tasks.
3. Add Capability-Based Agent Composition as the agent pool grows.
4. Add Competitive Co-Evolution for security-critical or high-risk work.
5. Add Self-Modifying Harness only after there is enough run history.
6. Add Constraint-Satisfaction planning last, for complex multi-constraint work.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Planners keep searching instead of writing | Hard tool budgets, forced write checkpoints, "no more research" gates |
| Agents claim success without proof | Proof-carrying output and deterministic verification |
| Parallel agents collide | Task graph ownership, worktree isolation, small commits, integrator role |
| Killed sessions lose intent and partial work | Durable state, evidence ledger, recovery checkpoints |
| Agents implement inconsistent patterns | Hexagonal core, explicit ports, bounded contexts, review gates |
| Speculative and adversarial agents multiply cost | Budgets, early-kill criteria, risk-based escalation |

---

## 14. MVP Success Criteria

- [ ] A user goal can be decomposed into tasks.
- [ ] At least two independent tasks can run in separate worktrees.
- [ ] Each task produces a commit and evidence.
- [ ] Failed tasks stop with a clear reason.
- [ ] Passing tasks can be merged into a session branch.
- [ ] The final report names what changed, what passed, and what remains risky.
