# Contributing to Pi Forge

Thank you for helping improve Pi Forge. Bug reports, documentation fixes,
tests, and focused feature proposals are welcome.

## Before opening a change

- Search existing issues and pull requests to avoid duplicate work.
- Open a feature request before investing in a large or breaking change.
- Never include credentials, private repository data, or generated `.pi/`
  runtime state in an issue or commit.
- For a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue.

## Local development

Pi Forge requires Node.js 20 or newer and npm.

```bash
git clone https://github.com/Unluckyathecking/pi-forge.git
cd pi-forge
npm ci
npm run check
npm run build:clean
```

To exercise the CLI without a global install:

```bash
npm run dev -- forge "Describe the goal" --dry-run
npm run dev -- status
```

## Pull requests

1. Keep the change focused and add or update tests for behavior changes.
2. Update the README or architecture documentation when user-facing behavior
   or a public interface changes.
3. Add a concise entry under `CHANGELOG.md`'s `[Unreleased]` section.
4. Run `npm run check`, `npm run build:clean`, and `npm pack --dry-run`.
5. Complete the pull request template and call out compatibility or migration
   effects explicitly.

Maintainers may ask for changes to preserve the hexagonal boundaries described
in [ARCHITECTURE.md](ARCHITECTURE.md). By contributing, you agree that your
contribution is licensed under the repository's [MIT License](LICENSE).

## Review and release

Maintainers merge changes after the required checks and review pass. Releases
follow Semantic Versioning and the process documented in
[CHANGELOG.md](CHANGELOG.md). See [API_STABILITY.md](API_STABILITY.md) for the
compatibility contract.
