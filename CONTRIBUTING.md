# Contributing

Bug reports, questions, documentation fixes, and focused pull requests
are all welcome. Pi Forge is maintained by one person, so response times
vary; small, well-scoped changes land fastest.

## Setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/Unluckyathecking/pi-forge.git
cd pi-forge
npm ci
```

## The gate

```bash
npm run check
```

This runs the typecheck, ESLint, and the Jest suite with coverage. CI
runs the same three steps plus a clean build on Node 20 and 22, so a
change that fails `npm run check` locally will fail there too.

## Tests

Unit tests live in `tests/unit/*.test.ts` and run through Jest's ESM
preset (`npm test`, or `npm run test:watch` while iterating). Coverage
floors are enforced at 80% statements, lines, and functions and 70%
branches; add tests alongside behavior changes rather than trimming the
thresholds.

## Pull requests

- Keep a PR to one concern; split unrelated fixes.
- Add or update tests for any behavior change.
- Record user-visible changes under `[Unreleased]` in `CHANGELOG.md`.
- Write commit messages as `type: summary` (feat, fix, docs, test,
  chore).

## Style

The codebase is strict TypeScript compiled as ESM. ESLint runs the
type-checked rule set: explicit function return types, no `any`, and
`??`/`?.` over manual checks. Match the code around your change, and
write comments only for the why (an invariant, a workaround for a known
sharp edge), not the what. The design constraint that matters most is
the hexagonal boundary: the orchestrator core depends on ports, never on
adapters directly. [ARCHITECTURE.md](ARCHITECTURE.md) covers that
boundary and the rest of the design.

## Security issues

Never open a public issue for a vulnerability; use the private reporting
flow in [SECURITY.md](SECURITY.md).
