# Contributing

[fork]: https://github.com/github/plugin-marketplace-starter/fork
[pr]: https://github.com/github/plugin-marketplace-starter/compare

Hi there! We're thrilled that you'd like to contribute to this project. Your
help is essential for keeping it great.

Contributions to this project are
[released](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license)
to the public under the [project's open source license](LICENSE).

Please note that this project is released with a
[Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this
project you agree to abide by its terms.

## Submitting a pull request

1. [Fork][fork] and clone the repository.
1. Install the dependencies with Node.js 22.14 or newer: `npm ci`
1. Make sure the lint passes on your machine: `npm run lint`
1. Create a new branch: `git checkout -b my-branch-name`
1. Make your change. For a new plugin, follow [Add a plugin](README.md#add-a-plugin).
   Follow the [version rules](README.md#add-a-plugin): bump changes since a
   known released base, but keep an unreleased first version. Never lower
   versions or rewrite history, and ask if release status is unknown.
1. Run `npm run lint` and the relevant
   [catalog, schema, pin, and script checks](docs/checks-and-evals.md#model-free-checks).
   Lint alone doesn't validate marketplace or plugin metadata.
1. Push to your fork and [submit a pull request][pr]. Say what changed, and for
   a plugin that runs code, what it runs, what it reads, writes, and reaches,
   and what data it keeps or sends to the model.
1. Pat yourself on the back and wait for your pull request to be reviewed and merged.

Here are a few things you can do that will increase the likelihood of your pull
request being accepted:

- Keep your change as focused as possible. If there are multiple changes you
  would like to make that are not dependent upon each other, consider
  submitting them as separate pull requests.
- Use only synthetic data. Never commit secrets, tokens, or private code.
- Write a [good commit message](http://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html).

## Resources

- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [Using Pull Requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests)
- [GitHub Docs](https://docs.github.com)
