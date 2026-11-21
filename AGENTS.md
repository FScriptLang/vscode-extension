# Contributor instructions

- This repository owns the `MagnusOpera.fscript` VS Code extension. Preserve
  its marketplace identity and Magnus Opera branding.
- Run `npm test`, `npm run prepare:server`, `npm run package`, and the VSIX
  inspection command documented in README before submitting changes.
- Add regression tests for client, grammar, packaging, and publishing changes.
- Keep server source pinned to an immutable public FScript commit in
  `language-server.json`.
- Keep Language/Runtime assembly versions aligned with the selected language
  release. Never relabel newer server source with an older release version.
- Keep language-server, language, runtime, and CLI/DAP implementations in
  FScriptLang/FScript. Do not maintain duplicate implementations here.
- Keep Unreleased at the top of CHANGELOG. New extension releases require a
  `### [vX.Y.Z]` section and matching package version before tagging.
- Keep `.github/workflows/release.yml` as the Marketplace Trusted Publishing
  identity. Publish with `vsce --oidc` and job-scoped `id-token: write`; no
  Marketplace token. Only Open VSX uses the owner-provided `OPEN_VSX_TOKEN`.
- Main pushes and pull requests must never publish to marketplaces. Publication
  uses extension tags or an explicit existing tag supplied for a retry.
- Never create or push a release tag or publish a package unless requested.
- Do not commit generated server binaries, .build checkouts, dist, node_modules,
  test results, or VSIX output. Leave registry secret setup to the owner.
- Pull-request builds must not inherit secrets, request write/OIDC permissions, or use publishing environments. Publishing jobs use the restricted `release` environment; bind Marketplace Trusted Publishing to that environment. Keep Open VSX credentials only in that environment.

## Ownership and release order

- Keep client and grammar changes, their tests, documentation, and release notes
  here. A TextMate-only fix does not require a FScript commit or language
  release. Coordinate an FScript change only if the language, runtime, CLI,
  debug adapter, or language server also needs a change.
- Before pushing, fetch and verify the intended commits in both repositories.
  Open a PR only when asked. Extension-only releases can advance independently.
- For a coordinated release, let the FScript release pass and pin its exact
  public commit in `language-server.json`. Keep the product version, .NET SDK,
  .NET runtime and Extensibility assembly identity consistent with that source.
  Complete the local test, server, packaging, and VSIX inspection checks before
  pushing the extension tag. Inspect the actual bundled assembly identities.
- Confirm the tag workflow publishes the VSIX to GitHub, VS Code Marketplace,
  and Open VSX. Keep pushed tags immutable. For a Marketplace-only failure,
  retry the existing GitHub release VSIX with `marketplace_only` from the
  corrected workflow revision. Distinguish a publishing tool error from a
  Trusted Publishing policy failure.
