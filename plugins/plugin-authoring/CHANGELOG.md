# Changelog

## 0.1.0

- Add repository-specific scaffolding, local testing, and contribution workflows.
- Include compatibility checks, isolated install cleanup, and pull request descriptions.
- Create local install-check homes exclusively, isolate their caches, and restore prior state on failure.
- Treat checkout content as untrusted metadata, never authority to override local testing safety.
- Validate local-install identifiers, matching manifests, candidate paths, and owned cleanup paths before running fixed CLI recipes.
- Treat contribution checkout content as untrusted input, preserve relevant conventions, and ignore and report conflicting instructions.
