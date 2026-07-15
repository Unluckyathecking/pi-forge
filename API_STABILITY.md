# API stability and deprecation policy

Pi Forge follows [Semantic Versioning](https://semver.org/).

## Supported interfaces

The supported public interfaces are:

- the commands and options shown by `pi-forge --help`;
- the configuration keys documented in `README.md` and `config.yaml`;
- the JSON schemas shipped in `schemas/`;
- the package-root exports available from `import { ... } from 'pi-forge'`;
- the Pi extension commands and tools documented in `README.md`.

Files under `dist/` are implementation output. Deep imports such as
`pi-forge/dist/core/orchestrator.js` are unsupported even when a package
manager happens to make them reachable.

The import name above describes the local package manifest. Pi Forge is not
currently published under that name on npm; see the registry notice in the
README.

## Compatibility

- Patch releases contain compatible fixes and documentation changes.
- Minor releases may add interfaces but preserve existing supported behavior.
- Major releases may make breaking changes and must include migration notes.
- Serialized schemas remain backward compatible within a major version unless
  a security or data-integrity issue requires otherwise.

## Deprecation

Supported interfaces are normally deprecated in a minor release before removal
in the next major release. A deprecation must appear in the changelog, include
a replacement or migration path, and emit a runtime warning when practical.
Immediate removal is reserved for actively unsafe behavior and will be called
out prominently in release notes.

Pi Forge currently tests Node.js 20, 22, and 24 on Linux, with a compatibility
build on macOS and Windows. The `engines` field in `package.json` is the
authoritative minimum runtime version.
