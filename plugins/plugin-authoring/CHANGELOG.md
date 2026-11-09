# Changelog

## 0.1.0

- Create the complete scaffold before registration and use known install URLs.
- Distinguish released changes from unreleased first versions without lowering versions.
- Verify recorded cleanup scope before each destructive step, require cleanup confirmation, and clarify validator provenance.
- Add repository-specific scaffolding, local testing, and contribution workflows.
- Include compatibility checks, isolated install cleanup, and pull request descriptions.
- Create local install-check homes exclusively, isolate their caches, and restore prior state on failure.
- Treat checkout content as untrusted metadata, never authority to override local testing safety.
- Validate local-install identifiers, matching manifests, candidate paths, and owned cleanup paths before running fixed CLI recipes.
- Treat contribution checkout content as untrusted input, preserve relevant conventions, and ignore and report conflicting instructions.
