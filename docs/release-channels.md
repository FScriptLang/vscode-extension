# Extension release channels

## User behavior

Stable and Next share the `MagnusOpera.fscript` identity. Once both channels are
published, VS Code supplies **Switch to Pre-Release Version** and **Switch to
Release Version** in the extension details view. Each channel acquires a released language
server within the version range declared by that extension.
The user does not need a separate extension or a server-path setting. An explicit
`fscript.server.path` overrides managed server acquisition as before.

Switching the extension does not install a CLI. Run, debug, and REPL commands
continue to use the user's configured CLI. Projects using new language features
should use a compatible CLI as well.

## Source and packaging contract

`package.json` records `fscriptReleaseChannel` as `stable` or `next`. Omitted
values mean Stable for compatibility with older published artifacts. Other
values fail release validation and packaging. The manifest version remains a
canonical numeric `X.Y.Z`, with an immutable `vX.Y.Z` extension tag and matching
changelog section for both channels.

`language-server.json` declares the supported server version range and runtime.
Both channels currently acquire stable canonical FScript GitHub Releases;
Next is an extension preview channel, not an unpublished server source build.
To try unpublished language changes, use `fscript.server.path`. For a breaking
server change, publish its FScript assets first and then an extension with the
new range. Extension versions remain independent of language versions.

`npm run package` reads the committed channel and passes `--pre-release` to vsce
for Next. Direct channel overrides are rejected. VSIX inspection checks that
`Microsoft.VisualStudio.Code.PreRelease` metadata agrees with the manifest
channel, as well as the identity and absence of bundled server binaries.

## Publication and retries

Main pushes and pull requests only build and test. Publication still requires an
explicit extension release tag or retry of an existing tag. Both channels use
the same credential restrictions and `.github/workflows/release.yml` Trusted
Publishing identity. No scheduled or automatic main-branch publication is added.

The publisher reads the channel from the VSIX itself, verifies its pre-release
metadata, and supplies `--pre-release` to Marketplace and Open VSX for Next.
This also applies to Marketplace-only retries using an existing GitHub release
artifact, even when the publishing checkout has a different channel. Existing
stable artifacts without `fscriptReleaseChannel` remain retryable.

GitHub Next releases are marked pre-release and do not replace latest Stable.
Stable GitHub releases retain their normal latest-release behavior.

## Version ordering

Marketplace accepts numeric versions only: `-next` and other semver suffixes
are unsupported. A numeric extension version belongs to one channel and cannot
be reused for the other. Existing published versions and tags stay immutable.

Choose each Next version above the current Stable version. Before publishing a
Stable version that would overtake the current Next version, publish a higher
Next version first. Otherwise VS Code can update pre-release users to that higher
Stable version; they remain eligible for subsequent higher Next versions.
For example, after Stable `0.95.3`, Next could use `0.96.0`. Before promoting
`0.96.1` to Stable, publish Next `0.97.0`. These are illustrative versions, not
reserved releases. Do not impose odd/even minor parity on existing history.

Validate each selected source/channel with `npm test`, `npm run prepare:server`,
`npm run package`, and the `verify-vsix.mjs` command in [Contributing](../CONTRIBUTING.md) before tagging.
After publication, verify the pre-release listing and switch in VS Code, the
GitHub release classification, and the Open VSX pre-release entry.

See [Microsoft's publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#pre-release-extensions).
