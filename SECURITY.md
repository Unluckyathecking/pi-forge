# Security Policy

## Reporting a vulnerability

Open a private security advisory on GitHub or email the maintainer. Do not
file public issues for security problems.

## Authentication boundary

Pi Forge **never owns LLM API keys**. All authentication flows through Pi
Coding Agent (`~/.pi/agent/auth.json`, managed by `pi auth login
kimi-coder`). Pi Forge invokes the Pi SDK in-process; tokens are scoped to
the user's Pi configuration and are not read from project-local `.env`
files. If you find a `FORGE_MODEL__KIMI_API_KEY` or similar in a fork or
template, it is stale — delete it and rotate the key.

## Worker isolation

The `PiSdkWorkerAdapter` spawns a Pi `AgentSession` inside an isolated git
worktree (`.pi/worktrees/<goal>/<task>`). The worker is launched with a
restricted tool allowlist:

```text
read, edit, write, grep, ls
```

`bash` is intentionally withheld so the worker cannot execute arbitrary
shell commands. Gates run after the worker finishes and have their own
controlled command surface.

## Gate command surface

`LocalCommandVerifier` resolves gate commands from `package.json` scripts
or falls back to compile-time literals (`eslint .`, `tsc --noEmit`, etc.).
User-supplied input never reaches the shell. Custom gates added via
`config.yaml` should be treated as trusted.

## Secret handling

- `.env` and `.env.*` are gitignored.
- Evidence ledgers truncate command output to 500 characters per gate
  claim by default, configurable via
  `proof_carrying.artifact.max_output_excerpt_length`. Configure your
  secret scan gate to keep secret material out of evidence files.
- Risk scoring scans the diff for patterns including `password`, `secret`,
  `token`, `private_key`, `eval(`, `Function(`. A hit raises the risk
  score and can flip the decision to `security_review` or `auto_deny`.
