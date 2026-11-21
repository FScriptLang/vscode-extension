# Contributing

## Development

Extension development requires Node.js 24 and the .NET SDK pinned in
`language-server.json`. From this repository:

```sh
npm ci
npm test
npm run prepare:server
npm run package
node scripts/verify-vsix.mjs "fscript-$(node -p 'require("./package.json").version').vsix"
```

`prepare:server` fetches a public FScript checkout into ignored `.build/fscript`,
checks out the immutable commit in `language-server.json`, and builds the
language server into ignored `server/`. It preserves dirty checkouts, verifies
runtime and assembly versions, and tests real provider loading against those
binaries before packaging. No GitHub PAT or marketplace secret is needed to
build. The source repository's canonical `vX.Y.Z` convention applies to future
language tags. Existing tags and releases are not migrated.

Press F5 from this checkout after preparing the server. The .NET Install Tool
acquires the runtime pinned in `language-server.json`, with PATH fallback.
`npm test` covers activation, configuration selection, debugger routing, grammar,
and release packaging. `test/vscode/` contains the on-demand real editor smoke
test. To use it, build the CLI and provider fixtures in a FScript checkout,
then run `FSCRIPT_SOURCE=/absolute/path/to/FScript npm run test:vscode` with
VS Code installed. Set `VSCODE_EXECUTABLE` if it is not on PATH or at the
standard macOS location. Linux requires a graphical session or Xvfb.

To test current language development, set `fscript.server.path` and
`fscript.cli.path` to binaries from your FScript checkout. Normal extension
builds deliberately use the committed server pin rather than a sibling folder.

## Release

The extension keeps the existing `MagnusOpera.fscript` identity and publishes
under the Magnus Opera umbrella. FScript no longer builds or publishes VSIX
artifacts. Extension releases are independent of language releases.

1. Set `OPEN_VSX_TOKEN` in this repository's `release` environment. Restrict that
   environment to `main` and `v*` tags in GitHub's deployment rules. Marketplace uses
   Trusted Publishing through GitHub OIDC, with the policy configured for
   `FScriptLang/vscode-extension`, `.github/workflows/release.yml`, and environment
   `release`. The marketplace job requests `id-token: write` and runs `vsce publish --oidc`;
   no Marketplace token or Azure login is used.
2. Update `language-server.json` when adopting a new language release: pin its
   exact commit, numeric package version, .NET SDK and runtime, and
   Extensibility assembly version together. Keep the
   packaged Runtime/Language assembly versions aligned with that release's
   NuGet packages. The extension version may advance independently.
3. Set `fscriptReleaseChannel` in `package.json` to `stable` or `next` and choose
   a distinct numeric extension version with `npm version X.Y.Z --no-git-tag-version`.
   Follow the [channel version ordering rules](docs/release-channels.md).
4. Document it under `### [vX.Y.Z]` in `CHANGELOG.md`, retaining Unreleased above.
5. Commit, tag `vX.Y.Z`, and push the commit and tag. CI requires the tag to
   match the committed package version and release notes.

The tag workflow validates, tests, builds and inspects one VSIX, creates a GitHub
release, then publishes that artifact to VS Code Marketplace and Open VSX.
Next packages carry pre-release metadata in both registries; their GitHub
releases are marked pre-release and do not replace the latest stable release.
Main pushes and pull requests only test and produce an installable VSIX artifact.
No marketplace publication happens on main. The manual **Publish Extension**
workflow accepts an existing extension tag for retries, checking out that exact
tag even when dispatched from main. For a Marketplace-only retry, select
`marketplace_only` to publish the existing GitHub release VSIX using the
publishing tool from the workflow revision. Already-published marketplace versions are
accepted on retries. Only the extension's restricted `release` environment holds
`OPEN_VSX_TOKEN`. Do not duplicate it as a repository or organization secret,
which a modified same-repository PR could read without entering an environment.
PR validation uses read-only permissions and does not request publishing OIDC
tokens.

Historical language changelog entries are kept because they were included in
earlier VSIX packages. New entries describe only extension changes.
