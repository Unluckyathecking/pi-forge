/**
 * Pi Forge — PLAN.md template
 *
 * Pure rendering module for `pi-forge init-plan`. Exports
 * `renderPlanMarkdown` (deterministic string output) and
 * `detectProjectType` (filesystem heuristic, no side-effects on rendering).
 *
 * The output is intentionally long (~400 lines for a real fill-in). Each
 * section that pi-forge runs depend on (gate-iteration protocol, strict-mode
 * survival guide, common-failures checklist, task-DAG guidance) is included
 * verbatim — these are the parts that materially affect run success, and
 * shaving them out to save lines defeats the purpose of the scaffold.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectType =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'unknown';

export interface PlanTemplateInput {
  readonly goal: string;
  readonly scopeIn: readonly string[];
  readonly scopeOut: readonly string[];
  readonly newFilesEstimate: number;
  readonly editedFilesEstimate: number;
  readonly strictPrefs: readonly string[];
  readonly includeUnitTests: boolean;
  readonly projectType: ProjectType;
}

/**
 * Inspect `projectRoot` for the marker files of common ecosystems and return
 * a best-effort project type. Checked in order:
 *   1. Cargo.toml             → 'rust'
 *   2. go.mod                 → 'go'
 *   3. pyproject.toml / setup.py / requirements.txt → 'python'
 *   4. package.json           → 'typescript' if TS hints found, else 'javascript'
 *   5. otherwise              → 'unknown'
 *
 * Pure read; never throws on a missing/unreadable file (returns 'unknown').
 */
export function detectProjectType(projectRoot: string): ProjectType {
  try {
    if (existsSync(join(projectRoot, 'Cargo.toml'))) return 'rust';
    if (existsSync(join(projectRoot, 'go.mod'))) return 'go';
    if (
      existsSync(join(projectRoot, 'pyproject.toml')) ||
      existsSync(join(projectRoot, 'setup.py')) ||
      existsSync(join(projectRoot, 'requirements.txt'))
    ) {
      return 'python';
    }
    const pkgPath = join(projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      return isTypescriptPackage(pkgPath) ? 'typescript' : 'javascript';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Heuristic: a package is "typescript" if it declares `typescript` as a
 * dep/devDep, sets `types`/`typings`, or any of its `main`/`source`/`module`
 * entries point at a `.ts`/`.tsx` file. Anything else is "javascript".
 */
function isTypescriptPackage(pkgPath: string): boolean {
  try {
    const raw = readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const deps = parsed.dependencies as Record<string, unknown> | undefined;
    const devDeps = parsed.devDependencies as Record<string, unknown> | undefined;
    if (deps !== undefined && typeof deps === 'object' && 'typescript' in deps) {
      return true;
    }
    if (devDeps !== undefined && typeof devDeps === 'object' && 'typescript' in devDeps) {
      return true;
    }

    if (typeof parsed.types === 'string' || typeof parsed.typings === 'string') {
      return true;
    }

    const entryFields: readonly string[] = ['main', 'source', 'module'];
    for (const field of entryFields) {
      const val = parsed[field];
      if (typeof val === 'string' && /\.tsx?$/.test(val)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Render the comprehensive PLAN.md markdown string from the gathered input.
 * Pure: no I/O. The same input always produces the same output.
 */
export function renderPlanMarkdown(input: PlanTemplateInput): string {
  const sections: string[] = [];
  sections.push(renderHeader(input));
  sections.push(renderGoal(input));
  sections.push(renderScope(input));
  sections.push(renderFileMap(input));
  sections.push(renderTypeContracts(input));
  sections.push(renderBehaviourMatrix(input));
  if (isFrontendProject(input.projectType)) {
    sections.push(renderCssSection());
  }
  sections.push(renderGateExpectations(input));
  sections.push(renderGateIterationProtocol());
  sections.push(renderStrictModeSurvivalGuide(input));
  if (isFrontendProject(input.projectType)) {
    sections.push(renderEslintRules());
  }
  sections.push(renderVerbatimCodePatterns(input));
  sections.push(renderCommonFailuresChecklist(input));
  sections.push(renderTaskDagGuidance(input));
  sections.push(renderDemoFlow());
  sections.push(renderSelfCheck(input));
  return sections.join('\n\n') + '\n';
}

function isFrontendProject(t: ProjectType): boolean {
  return t === 'typescript' || t === 'javascript';
}

// ── Section renderers ─────────────────────────────────────────────

function renderHeader(input: PlanTemplateInput): string {
  return [
    `# PLAN.md`,
    ``,
    `> Scaffolded by \`pi-forge init-plan\`. This is the single source of truth for a`,
    `> pi-forge run. Fill in every \`<TODO: …>\` placeholder before firing pi-forge —`,
    `> the quality of this PLAN.md is the #1 determinant of run success.`,
    ``,
    `**Project type:** \`${input.projectType}\``,
  ].join('\n');
}

function renderGoal(input: PlanTemplateInput): string {
  return [
    `## 1. Goal`,
    ``,
    `${input.goal}`,
    ``,
    `<!-- Keep this section to ONE declarative sentence (≤200 chars). Anything`,
    `     longer belongs in §2 Scope or §5 Behaviour Matrix. -->`,
  ].join('\n');
}

function renderScope(input: PlanTemplateInput): string {
  const inList = input.scopeIn.length > 0
    ? input.scopeIn.map((s) => `- ${s}`).join('\n')
    : `- <!-- TODO: fill in -->`;
  const outList = input.scopeOut.length > 0
    ? input.scopeOut.map((s) => `- ${s}`).join('\n')
    : `- <!-- TODO: fill in -->`;
  return [
    `## 2. Scope`,
    ``,
    `### In scope`,
    ``,
    inList,
    ``,
    `### Out of scope`,
    ``,
    outList,
  ].join('\n');
}

function renderFileMap(input: PlanTemplateInput): string {
  const newRows: string[] = [];
  for (let i = 1; i <= Math.max(1, input.newFilesEstimate); i++) {
    newRows.push(
      `| \`<TODO: new path #${i}>\` | NEW | <TODO: purpose> | <TODO: verb> | <TODO: budget> |`,
    );
  }
  const editRows: string[] = [];
  for (let i = 1; i <= Math.max(1, input.editedFilesEstimate); i++) {
    editRows.push(
      `| \`<TODO: existing path #${i}>\` | EDIT | <TODO: what changes> | <TODO: verb> | <TODO: budget> |`,
    );
  }
  return [
    `## 3. File Map`,
    ``,
    `> One row per file the pi-forge run is allowed to touch. The set listed`,
    `> here is the **complete** set — anything not listed is out of scope.`,
    ``,
    `| Path | Action | Purpose | Verb | Budget |`,
    `| --- | --- | --- | --- | --- |`,
    ...newRows,
    ...editRows,
  ].join('\n');
}

function renderTypeContracts(input: PlanTemplateInput): string {
  const body = ((): string => {
    switch (input.projectType) {
      case 'typescript':
        return [
          '```typescript',
          '// <TODO: paste the exact type/interface/zod-schema signatures the',
          '// implementation must conform to. These are the contract — the',
          '// implementer should never invent types that aren\'t listed here.>',
          'export interface ExampleContract {',
          '  readonly id: string;',
          '  readonly payload: unknown;',
          '}',
          '```',
        ].join('\n');
      case 'javascript':
        return [
          '```javascript',
          '// <TODO: paste the exact JSDoc @typedefs or runtime shape',
          '// validators the implementation must conform to.>',
          '/**',
          ' * @typedef {Object} ExampleContract',
          ' * @property {string} id',
          ' * @property {unknown} payload',
          ' */',
          '```',
        ].join('\n');
      case 'python':
        return [
          '```python',
          '# <TODO: paste the exact dataclass / TypedDict / Protocol',
          '# signatures the implementation must conform to.>',
          'from dataclasses import dataclass',
          'from typing import Any',
          '',
          '@dataclass(frozen=True)',
          'class ExampleContract:',
          '    id: str',
          '    payload: Any',
          '```',
        ].join('\n');
      case 'rust':
        return [
          '```rust',
          '// <TODO: paste the exact struct / trait signatures the',
          '// implementation must conform to.>',
          'pub struct ExampleContract {',
          '    pub id: String,',
          '    pub payload: serde_json::Value,',
          '}',
          '```',
        ].join('\n');
      case 'go':
        return [
          '```go',
          '// <TODO: paste the exact struct / interface signatures the',
          '// implementation must conform to.>',
          'type ExampleContract struct {',
          '    ID      string',
          '    Payload any',
          '}',
          '```',
        ].join('\n');
      case 'unknown':
      default:
        return [
          '```',
          '// <TODO: paste the exact type/interface/contract signatures the',
          '// implementation must conform to.>',
          '```',
        ].join('\n');
    }
  })();
  return [
    `## 4. Type Contracts`,
    ``,
    `> The implementer treats these as a frozen API. Any deviation requires`,
    `> updating this section first.`,
    ``,
    body,
  ].join('\n');
}

function renderBehaviourMatrix(_input: PlanTemplateInput): string {
  return [
    `## 5. Behaviour Matrix`,
    ``,
    `> One row per observable behaviour. Keep wording precise enough that`,
    `> someone reading only this table could write the test by hand.`,
    ``,
    `| # | Trigger | Expected outcome | Notes |`,
    `| --- | --- | --- | --- |`,
    `| 1 | <TODO: trigger> | <TODO: outcome> | <TODO: notes> |`,
    `| 2 | <TODO: trigger> | <TODO: outcome> | <TODO: notes> |`,
    `| 3 | <TODO: trigger> | <TODO: outcome> | <TODO: notes> |`,
  ].join('\n');
}

function renderCssSection(): string {
  return [
    `## 6. CSS / Styling additions`,
    ``,
    `> List every new class, CSS variable, animation, or selector the run`,
    `> introduces. Group by file. Keep this list tight — operators frequently`,
    `> forget to scope new selectors and end up clashing with existing styles.`,
    ``,
    `- \`<TODO: file>\` — \`<TODO: selector or variable>\` — <TODO: purpose>`,
    `- \`<TODO: file>\` — \`<TODO: selector or variable>\` — <TODO: purpose>`,
  ].join('\n');
}

function renderGateExpectations(input: PlanTemplateInput): string {
  const gates = gateCommandsFor(input.projectType, input.includeUnitTests);
  const rows = gates
    .map(
      (g) =>
        `| \`${g.name}\` | \`${g.command}\` | ${g.requirement} |`,
    )
    .join('\n');
  return [
    `## 7. Gate Expectations`,
    ``,
    `> These are the mechanical gates pi-forge runs after every task. They`,
    `> must all pass for a task to be marked complete.`,
    ``,
    `| Gate | Command | Requirement |`,
    `| --- | --- | --- |`,
    rows,
  ].join('\n');
}

interface GateSpec {
  readonly name: string;
  readonly command: string;
  readonly requirement: string;
}

function gateCommandsFor(
  t: ProjectType,
  includeUnitTests: boolean,
): readonly GateSpec[] {
  const testReq = includeUnitTests
    ? 'pass with new unit tests added in this run'
    : 'pass (no new unit tests; behaviour validated via §F task-DAG verify)';
  switch (t) {
    case 'typescript':
      return [
        { name: 'lint', command: 'npm run lint', requirement: 'zero errors, zero warnings' },
        { name: 'typecheck', command: 'npm run typecheck', requirement: 'zero TS errors' },
        { name: 'test', command: 'npm test', requirement: testReq },
        { name: 'build', command: 'npm run build', requirement: 'exit 0' },
      ];
    case 'javascript':
      return [
        { name: 'lint', command: 'npm run lint', requirement: 'zero errors, zero warnings' },
        { name: 'test', command: 'npm test', requirement: testReq },
        { name: 'build', command: 'npm run build', requirement: 'exit 0 (or omit if no build step)' },
      ];
    case 'python':
      return [
        { name: 'lint', command: 'ruff check .', requirement: 'zero errors' },
        { name: 'typecheck', command: 'mypy .', requirement: 'zero errors' },
        { name: 'test', command: 'pytest', requirement: testReq },
      ];
    case 'rust':
      return [
        { name: 'lint', command: 'cargo clippy --all-targets -- -D warnings', requirement: 'zero warnings' },
        { name: 'typecheck', command: 'cargo check --all-targets', requirement: 'zero errors' },
        { name: 'test', command: 'cargo test', requirement: testReq },
        { name: 'build', command: 'cargo build --release', requirement: 'exit 0' },
      ];
    case 'go':
      return [
        { name: 'lint', command: 'golangci-lint run', requirement: 'zero errors' },
        { name: 'vet', command: 'go vet ./...', requirement: 'zero issues' },
        { name: 'test', command: 'go test ./...', requirement: testReq },
        { name: 'build', command: 'go build ./...', requirement: 'exit 0' },
      ];
    case 'unknown':
    default:
      return [
        { name: 'lint', command: '<TODO: lint command>', requirement: 'zero errors' },
        { name: 'test', command: '<TODO: test command>', requirement: testReq },
        { name: 'build', command: '<TODO: build command>', requirement: 'exit 0' },
      ];
  }
}

function renderGateIterationProtocol(): string {
  return [
    `## §A. Gate-iteration protocol`,
    ``,
    `> Verbatim from successful pi-forge runs. Follow this loop exactly — it is`,
    `> the single biggest determinant of whether a run finishes cleanly.`,
    ``,
    `1. **Stage one file at a time.** After every edit, run the smallest`,
    `   relevant gate (lint for style, typecheck for signatures, test for`,
    `   behaviour). Never write three files then run all gates at once.`,
    `2. **Read the FIRST error.** Gate output is a stack — fix the top of the`,
    `   stack, then re-run. Do not skim down the list looking for the "easy"`,
    `   error to fix first.`,
    `3. **Never disable a gate.** If lint complains, fix the lint. Don't add`,
    `   \`// eslint-disable-next-line\`, don't lower the threshold, don't`,
    `   comment the rule out of the config. The gate exists because past runs`,
    `   failed without it.`,
    `4. **Never delete or skip a failing test.** Fix the implementation, not`,
    `   the test. If the test is genuinely wrong (e.g. captures old`,
    `   behaviour that this PR changes), update the test in the same commit`,
    `   that changes the behaviour and explain in the commit body.`,
    `5. **Re-run the full gate sequence after every fix.** Lint → typecheck →`,
    `   test → build. A change that fixes typecheck can break lint; a change`,
    `   that fixes lint can break a test. Don't trust partial green.`,
    `6. **Stop when all four gates are green AND \`git status\` matches the`,
    `   File Map in §3.** If \`git status\` shows files outside the map, you've`,
    `   silently expanded scope — back the change out.`,
  ].join('\n');
}

function renderStrictModeSurvivalGuide(input: PlanTemplateInput): string {
  const prefList = input.strictPrefs.length > 0
    ? input.strictPrefs.map((p) => `- \`${p}\``).join('\n')
    : '- <!-- TODO: list strict-mode preferences -->';
  return [
    `## §B. Strict-mode survival guide`,
    ``,
    `> Strict-mode preferences active for this run:`,
    ``,
    prefList,
    ``,
    `### How to survive each preference`,
    ``,
    `- **\`no-any\`** — Reach for \`unknown\` plus a narrowing guard, not`,
    `  \`any\`. If a third-party lib returns \`any\`, wrap the call site in a`,
    `  narrow helper that returns a typed value.`,
    `- **\`no-as\`** — Type assertions hide bugs. Use a discriminated union`,
    `  + exhaustive switch, or a type predicate (\`x is Foo\`). Reserve \`as\``,
    `  for serialisation boundaries (JSON.parse → schema validation).`,
    `- **\`no-console-log\`** — Use the project logger. The CLI's user-facing`,
    `  output channel is an explicit exception, called out in the action`,
    `  handler.`,
    `- **\`import-type\`** — Anything used only as a type goes through`,
    `  \`import type\`. Saves a runtime import and keeps the dep graph honest.`,
    `- **\`verbatim-module-syntax\`** — If the codebase has \`verbatimModule\``,
    `  \`Syntax: true\`, every type-only import must be \`import type\`. Mixed`,
    `  \`import { type Foo, bar }\` works too. Re-exports of types need`,
    `  \`export type\`.`,
  ].join('\n');
}

function renderEslintRules(): string {
  return [
    `## §C. ESLint rules in play`,
    ``,
    `> The implementer must surface and obey every active ESLint rule. The`,
    `> common landmines:`,
    ``,
    `- \`@typescript-eslint/no-explicit-any\` — see §B.`,
    `- \`@typescript-eslint/explicit-function-return-type\` — every exported`,
    `  function needs an explicit return type. Don't rely on inference.`,
    `- \`@typescript-eslint/no-unused-vars\` — prefix intentionally-unused`,
    `  args with \`_\`. Don't delete them if they're part of a contract.`,
    `- \`@typescript-eslint/prefer-nullish-coalescing\` — use \`??\` for`,
    `  null/undefined, \`||\` only for "any falsy" semantics.`,
    `- \`@typescript-eslint/prefer-optional-chain\` — \`a?.b?.c\`, not`,
    `  \`a && a.b && a.b.c\`.`,
    `- \`no-floating-promises\` — every Promise needs an \`await\`, a \`.then\`,`,
    `  or an explicit \`void\` prefix when fire-and-forget is genuinely`,
    `  intended.`,
  ].join('\n');
}

function renderVerbatimCodePatterns(input: PlanTemplateInput): string {
  const langTag = codeFenceLanguage(input.projectType);
  return [
    `## §D. Verbatim code patterns`,
    ``,
    `> Paste any non-obvious patterns the implementer must copy verbatim.`,
    `> Examples: a specific way to call an SDK, a known-good async cleanup`,
    `> pattern, a regex that took ten tries to get right.`,
    ``,
    '```' + langTag,
    `// <TODO: paste verbatim code pattern #1>`,
    '```',
    ``,
    '```' + langTag,
    `// <TODO: paste verbatim code pattern #2>`,
    '```',
  ].join('\n');
}

function codeFenceLanguage(t: ProjectType): string {
  switch (t) {
    case 'typescript':
      return 'typescript';
    case 'javascript':
      return 'javascript';
    case 'python':
      return 'python';
    case 'rust':
      return 'rust';
    case 'go':
      return 'go';
    case 'unknown':
    default:
      return '';
  }
}

function renderCommonFailuresChecklist(input: PlanTemplateInput): string {
  const langSpecific = input.projectType === 'typescript' || input.projectType === 'javascript'
    ? [
        `- [ ] **Module-resolution drift** — \`NodeNext\` requires explicit \`.js\``,
        `      suffixes on relative imports even in \`.ts\` files. Check this`,
        `      before running typecheck.`,
        `- [ ] **ESM/CJS confusion** — top-level \`await\` only works in ESM`,
        `      modules. If a file is CJS, use an IIFE.`,
      ]
    : [];
  return [
    `## §E. Common-failures checklist`,
    ``,
    `> Run through this list before declaring the task complete. Every item`,
    `> is a failure mode that has bitten a previous pi-forge run.`,
    ``,
    `- [ ] **Scope creep.** \`git status\` matches §3 File Map exactly.`,
    `- [ ] **No \`TODO\` placeholders left.** Every \`<TODO: …>\` in PLAN.md`,
    `      either resolved or explicitly deferred to a follow-up.`,
    `- [ ] **No silenced gates.** Grep for \`eslint-disable\`, \`@ts-ignore\`,`,
    `      \`@ts-expect-error\`, \`# type: ignore\`, \`#[allow(\` — every`,
    `      occurrence justified in a comment.`,
    `- [ ] **No swallowed errors.** Every \`catch\` block either re-throws,`,
    `      logs with context, or surfaces a typed result.`,
    `- [ ] **No hardcoded secrets.** Grep for \`sk-\`, \`Bearer \`, \`password=\`,`,
    `      \`api_key\`.`,
    `- [ ] **Tests run in CI shape.** Not just locally — verify the test`,
    `      script in package.json / pyproject.toml / Cargo.toml actually`,
    `      runs the new tests.`,
    `- [ ] **Behaviour Matrix complete.** Every row in §5 traceable to a`,
    `      test or to a manual demo step in §9.`,
    ...langSpecific,
  ].join('\n');
}

function renderTaskDagGuidance(input: PlanTemplateInput): string {
  const verifyOnlyHint = input.includeUnitTests
    ? `plan → implement → test → verify`
    : `plan → implement → verify  (skip the "test" task; behaviours validated by verify)`;
  return [
    `## §F. Task-DAG guidance`,
    ``,
    `> pi-forge decomposes the goal into a small DAG of tasks. When a PLAN.md`,
    `> is present, the planner trusts the file map / contracts / behaviour`,
    `> matrix to define each task's surface.`,
    ``,
    `**Suggested DAG for this PLAN.md:** \`${verifyOnlyHint}\``,
    ``,
    `- **plan** — re-read PLAN.md, confirm the file map and type contracts`,
    `  still hold, no new dependencies appeared between PLAN.md commit and`,
    `  run start. Should be a no-op when the plan is fresh.`,
    `- **implement** — write the code described in §3 File Map, conforming`,
    `  to §4 Type Contracts and §5 Behaviour Matrix. Run gates after every`,
    `  file per §A.`,
    input.includeUnitTests
      ? `- **test** — add the unit tests promised in §5 Behaviour Matrix.`
      : `- **(test task omitted)** — operator declined unit tests; verify task carries the burden.`,
    `- **verify** — full gate sweep, §E common-failures checklist, then a`,
    `  manual walk through §9 Demo flow.`,
  ].join('\n');
}

function renderDemoFlow(): string {
  return [
    `## 9. Demo flow`,
    ``,
    `> Step-by-step script the operator runs after pi-forge finishes, to`,
    `> verify the goal end-to-end. One numbered step per observable check.`,
    ``,
    `1. <TODO: step 1 — e.g. "npm run dev, open http://localhost:5173">`,
    `2. <TODO: step 2 — e.g. "click X, observe Y">`,
    `3. <TODO: step 3 — e.g. "open devtools console, verify no errors">`,
  ].join('\n');
}

function renderSelfCheck(input: PlanTemplateInput): string {
  return [
    `## 10. Self-check before declaring success`,
    ``,
    `> The implementer's own final pass before reporting success to the`,
    `> orchestrator. Treat every box as a hard gate.`,
    ``,
    `- [ ] All four mechanical gates from §7 green.`,
    `- [ ] \`git status\` clean apart from the files in §3 File Map.`,
    `- [ ] §5 Behaviour Matrix complete: every row demonstrably works.`,
    `- [ ] §E common-failures checklist walked through, every box ticked.`,
    `- [ ] PLAN.md still up-to-date — if the implementation diverged, the`,
    `      divergence is reflected in the relevant section.`,
    `- [ ] Commit message references the goal sentence from §1.`,
    input.includeUnitTests
      ? `- [ ] New unit tests added per §5 / §F; coverage ≥ the project threshold.`
      : `- [ ] §9 Demo flow walked through manually; every step observed.`,
  ].join('\n');
}
