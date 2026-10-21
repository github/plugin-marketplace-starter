# Security

## Report a vulnerability

Don't report security problems in public issues, discussions, or pull requests.

<!-- Replace this section with your team's reporting channel before you ship. -->
Use this repository's **Security** tab to
[report a vulnerability privately](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository),
if private vulnerability reporting is turned on. Otherwise contact this
marketplace's maintainers privately. After you set up
[.github/CODEOWNERS](.github/CODEOWNERS), list them there so reporters know who
to contact.

Include the affected plugin and version, the host and version you used, steps
to reproduce, and the impact you observed. Leave out real secrets and private
data.

## What plugins can do

Installing a plugin registers it; it runs nothing yet. Once Copilot loads an
installed, enabled plugin, its code can run on the installer's machine with
their permissions, without asking each time:

- **Hooks** run commands automatically on events such as every successful edit,
  and can change files, for example by reformatting them. A hook isn't a
  security boundary and never replaces CI.
- **MCP servers** run as local processes and can do anything their code does.
- **Canvas and SDK extensions** run code in the Copilot host and may start local
  servers. A local server should listen only on `127.0.0.1` and check the
  `Host` and `Origin` of every request.
- **Skills, agents, rules, and commands** shape what the model does, including
  which tools it calls.
- **Remote plugins** come from another repository. This marketplace never enables
  them automatically, and its checks never download or run them. Each one is
  pinned to a commit, which names what was reviewed but doesn't make it safe.
  Review them yourself before installing.

Opening a trusted checkout of this repository enables every local plugin in it,
the same as installing them all.

Review a plugin before you trust it, and install only what you need.
[Security and data handling](docs/security.md) describes what runs when, where
data goes, and a review checklist for new plugins.

## Maintaining this marketplace

- Review changes to `.github/workflows/`, `scripts/`, `evals/`, `plugins/`,
  `marketplace.json`, and `.github/copilot/settings.json` carefully. Same-repository
  pull requests can run changed code in the eval workflow with its token.
- Require review from code owners through branch protection or a ruleset.
- Pin actions to full commit SHAs and remote plugins to full commit SHAs.
  `npm run verify` rejects a remote plugin without one.
- Add required reviewers to the `evals` environment before you turn on pull
  request evals. See [Continuous integration](docs/ci.md#security).
- Keep secrets out of files, fixtures, eval specs, and transcripts.
