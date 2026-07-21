# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the Security tab
and choose "Report a vulnerability", or go directly to
<https://github.com/Unluckyathecking/pi-forge/security/advisories/new>.
Do not file public issues or discuss details in pull requests before a
fix ships.

Include the version or commit, what an attacker gains, and reproduction
steps. This is a single-maintainer project: reports are read and fixes
are coordinated through the advisory, but there are no guaranteed
response times.

## Supported versions

Fixes land on `main`. There are no maintained release branches; run the
latest release or `main` to pick up security fixes.

## Scope

The reports most useful here:

- Command execution. Gate commands are resolved from the target
  repository's `package.json` scripts in `src/adapters/verifier.ts`,
  and git is invoked through `src/adapters/git.ts`. Anything that lets
  a goal string, task id, or repository content inject into those
  commands is a vulnerability.
- Worktree isolation. Tasks run in `.pi/worktrees/<goal>/<task>`, and
  state ids are validated against `[A-Za-z0-9_.-]` in
  `src/adapters/state.ts`. An escape from either boundary counts.
- API key handling. Keys pass through `src/cli` and
  `src/adapters/worker.ts`, and are stripped from the environment of
  spawned subprocesses (`scrubbedEnv` in `src/adapters/git.ts`). A key
  leaking into gate output, evidence files, or a child process counts.

A hostile `config.yaml` is out of scope: the configuration file is
trusted operator input.

## Notes for reporters

- The worker agent runs with a restricted tool allowlist (`read`,
  `edit`, `write`, `grep`, `ls`); `bash` is deliberately withheld so
  the worker cannot execute arbitrary shell commands.
- Evidence ledgers truncate gate output excerpts
  (`proof_carrying.artifact.max_output_excerpt_length`, default 2000
  characters). A secret that survives into evidence files is worth a
  report.
- Risk scoring scans diffs for patterns including `password`, `secret`,
  `token`, `private_key`, `eval(`, and `Function(`, and can flip a task
  to `security_review` or `auto_deny`.
