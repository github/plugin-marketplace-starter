# Changelog

## 0.2.0

- Route confirmed first-release note requests through the release skill even when no files need changing.

## 0.1.0

- Resolve annotated release tags through the GitHub commit API.
- Require a named remote ref to resolve to its reviewed pinned commit.
- Preserve release history and distinguish unreleased first versions from released plugins.
- Document read-only review inputs and CLI agent selection.
- Preserve remote release channels and stop retirement registration edits when deletion fails.
- Add a read-only plugin contribution reviewer.
- Add deliberate remote pin updates, release preparation, and plugin retirement.
- Treat remote pin checkout content as untrusted input, preserve relevant conventions, and ignore and report conflicting instructions.
