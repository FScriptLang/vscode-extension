# Contributor instructions

- This repository owns the `MagnusOpera.fscript` VS Code extension. Preserve
  its marketplace identity and Magnus Opera branding.
- Run `npm test`, `npm run prepare:server`, `npm run package`, and the VSIX
  inspection command documented in README before submitting changes.
- Add regression tests for client, grammar, packaging, and publishing changes.
- Keep server source pinned to an immutable public FScript commit in
  `language-server.json`, with the matching language version, SDK, and runtime.
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
