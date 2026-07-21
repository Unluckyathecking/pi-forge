# Operating standard

Five pillars, in priority order: **simplicity, modularity, maintainability, cost-effectiveness, competency.** When they conflict, the earlier one wins. When in doubt, do less.

## Think before coding
State your assumptions; if uncertain, ask. If a request has several readings, surface them rather than silently pick one. If a simpler approach exists, say so. When something is unclear, stop and name it before writing code.

## Simplicity first
Write the minimum that solves the problem, nothing speculative. No features beyond the ask, no abstraction for single-use code, no configurability nobody requested, no error handling for cases that can't happen. If 200 lines could be 50, rewrite it. The test: would a senior engineer call this overcomplicated?

## Surgical changes
Touch only what the task needs. Don't "improve" adjacent code, don't refactor what isn't broken, match the existing style even where you'd do it differently. Remove only the orphans your own change created; leave pre-existing dead code alone and mention it instead. Every changed line should trace to the request.

## Modularity and maintainability
Many small files over few large ones — aim for 200-400 lines, functions under 50. One responsibility per module, low coupling, respect declared module boundaries. Don't repeat logic. Each module earns its own tests, and any new dependency earns a one-line reason.

## Goal-driven execution
Turn a task into a verifiable goal before starting: "fix the bug" becomes "write a failing test, then make it pass." For multi-step work, write a short plan with a check per step and loop until each one verifies.

## Cost
Tokens are a budget. Keep context minimal — a diff and its test output beat a whole-repo read. Prefer flat structures: a manager-of-workers only earns its cost when it does something the caller genuinely can't see. Reach for a fresh sub-agent only when a bounded, single job needs its own context.

## Writing that others read
Commit messages, PR descriptions, and review comments are a public record. Write them plain, tight, and competent — like a senior engineer, not a generated bullet list. No filler, no manufactured structure, straight quotes, punctuation used sparingly. Say what changed and why, then stop.

## Running a multi-agent loop
Learned in operation, kept because it earned its place:
- Stay flat. Add a manager between you and workers only if that manager does work you structurally can't see. It is never worth adding as a review hop when you already gate every merge.
- Trust state, not self-report. A delegate that looks idle may be done but unpushed. Check the branch or worktree directly on a fixed cadence; don't wait for an end-of-run message.
- Partition before you parallelize. Split ownership by path up front so two agents can't build the same thing. Discovering the overlap after both shipped is wasted spend.
- Fan out only read-only, bounded work (parallel review, parallel gating) — it's cheap and collision-free. Give write access only to a narrowly scoped, non-colliding fix.
- Grade on merit. When two implementations race, merge the one that clears a bar you stated in advance, even when it isn't yours.
- Confirm the ship. After a commit meant to land, check you're not on a detached HEAD and that nothing sits unpushed before calling the cycle done.
- Let the standard sharpen itself. Every so often, read the operating record for what worked and what didn't, and update this file from the evidence.

---
*Coding principles above draw on the widely-shared community distillation of Andrej Karpathy's coding-agent guidance.*

# Pi Forge — project brief

The operating standard above governs how to work here. What follows is the load-bearing, pi-forge-specific context.

## What this repo is

A proof-carrying harness for autonomous code generation. Every task moves through one flow: freeze a contract, implement in an isolated git worktree, emit a proof artifact, pass the mechanical gates, then promote. The orchestrator, ports and adapters live in src/ (hexagonal: core imports no adapters); role definitions in roles/; published JSON Schemas for the proof shapes in schemas/ (specification artifacts — nothing loads them at runtime).

## The gate

`npm run check` is the whole local gate: typecheck, lint, then the coverage suite. CI runs it on Node 20 and 22 plus a clean build. Coverage floors are 80/80/80 with branches at 70 — and branch coverage sits exactly at the floor, so there is no slack: behavior changes bring tests with them, and nobody trims thresholds or weakens assertions to get green.

## Load-bearing invariants

1. The proof-carrying flow is not optional. No implementation before its contract, no completion without a proof artifact, no promotion past a failing gate. Changes that bypass or soften a gate need a reason the standard above would accept.
2. Worktree isolation holds. Task and goal ids stay validated against `[A-Za-z0-9_.-]`, work stays under `.pi/worktrees`, and state under `.pi/state`.
3. Spawned processes get the scrubbed environment only. The allowlist in src/adapters/git.ts passes exactly the keys the worker needs (the Kimi coding keys among them); never widen it to a full env passthrough.
4. The Kimi coding provider is the product. src/ports/worker.ts, the --kimi-key flag and the provider registration are load-bearing. (A dead kimi review bot was removed from this repo once; do not confuse the two.)
5. config.yaml documents more than the code enforces, and says so where it matters. A change that claims config-driven behavior must point at code that actually reads the key; risk scoring is hardcoded in src/adapters/verifier.ts.
6. Releases pack, they do not publish. The npm registry name pi-forge belongs to an unrelated package, so tags build, gate and attach a tarball. Reintroducing npm publish under this name ships nothing and implies someone else's package.
7. Workflow actions stay pinned to commit SHAs with the tag in a comment.

## Style

Match the surrounding idiom. Comments explain why, not what; strict ESLint and explicit return types are already the law here, so let the tools argue about formatting.
