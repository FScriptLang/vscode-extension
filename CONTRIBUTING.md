# Contributing

## Development

Extension development and packaging require Node.js 24, without a .NET SDK or
FScript source checkout:

```sh
npm ci
npm test
npm run prepare:server
npm run package
node scripts/verify-vsix.mjs "fscript-$(node -p 'require("./package.json").version').vsix"
```

`prepare:server` validates `language-server.json`; packaging never downloads or
bundles a server. F5 acquires a released compatible server into VS Code's global
extension storage and acquires its .NET runtime through the .NET Install Tool,
with PATH fallback. First use requires network access. Subsequent activations
start the cached server and check GitHub Releases in the background.

To prefetch a released server for inspection, run
`npm run prepare:server -- --download` (optionally followed by `X.Y.Z`). This
uses `.build/language-servers`, not the running extension's global cache.
To test unpublished language changes, set `fscript.server.path` and
`fscript.cli.path` to build outputs in your FScript checkout. No implicit local
source build occurs. `FSCRIPT_SOURCE=/absolute/path/to/FScript npm run test:vscode`
runs the real editor smoke test after building that checkout's CLI, server, and
provider fixtures. Set `VSCODE_EXECUTABLE` if necessary; Linux needs a display or
Xvfb. Add `FSCRIPT_MANAGED_SERVER_VERSION=X.Y.Z` to exercise real release
acquisition in the isolated editor host instead of a custom local server.
`npm test` covers acquisition, update prompts, activation, configuration,
debugger routing, grammar, and packaging.

## Language-server releases and compatibility

FScriptLang/FScript owns the server implementation and tests. Its ordinary
canonical `vX.Y.Z` GitHub Releases publish:

- `fscript-lsp-X.Y.Z-dotnet.zip`: a portable managed server and all dependencies.
- `fscript-lsp-X.Y.Z.json`: schema version, language/server version, source
  revision, required .NET runtime, archive name, and SHA-256.

`language-server.json` declares the supported numeric language version range
and .NET runtime. Restrict the range before a breaking server or runtime change;
a new extension can then adopt the new range. No compatibility shim is required.
The initial minimum is 0.95.5, the first prospective release using this artifact
contract. Historical releases are not rewritten. **Publish the first FScript
release with these assets before releasing this extension change.**

Startup selects the newest healthy cached supported server, or installs the
newest supported stable release if none is cached. Update checks ignore drafts,
pre-releases, noncanonical tags, and releases without both assets. A compatible
update is offered, never installed silently over an existing server. A newer
incompatible release offers an extension update. A user-level
`fscript.server.version` pin selects an exact supported version and suppresses
server upgrade offers; older cached installations remain available for rollback.
Clear the pin to resume upgrades. Downloads verify the checksum and distribution
before an atomic installation. Failed downloads leave prior versions usable.
Automatic update-check failures only log; the explicit update command reports
failures. The extension runs acquisition on its own host, including SSH/WSL and
containers. Server updates never install or update the user's CLI.

## Extension release

The extension retains `MagnusOpera.fscript`. FScript publishes language binaries;
this repository publishes the VSIX independently.

1. For breaking server changes, publish the FScript release assets first, then
   adopt their version range/runtime in `language-server.json`. Validate the
   downloaded server and selected CLI together in the real editor smoke test.
2. Set `fscriptReleaseChannel` to `stable` or `next`, choose a distinct numeric
   extension version, and follow [channel ordering](docs/release-channels.md).
3. Add `### [vX.Y.Z]` release notes, retaining Unreleased above, and run the
   development checks above. Tag and push only when requested.

Main and pull requests only build and test. The tag workflow validates, builds,
inspects, and publishes one VSIX to GitHub, Marketplace, and Open VSX. Marketplace
uses GitHub OIDC Trusted Publishing bound to `FScriptLang/vscode-extension`,
`.github/workflows/release.yml`, and the restricted `release` environment, with
job-scoped `id-token: write` and `vsce publish --oidc`. Only Open VSX uses the
`OPEN_VSX_TOKEN` secret, held in that environment. Restrict its deployment rules
to `main` and `v*` tags. PRs receive neither publishing secrets nor OIDC access.

Manual retries select an existing immutable extension tag. For Marketplace-only
failure, use `marketplace_only` to republish its existing GitHub release VSIX
with the corrected workflow revision. Published versions and tags stay immutable.
Historical changelog entries remain; new notes describe extension changes only.
