# FScript for Visual Studio Code

FScript is a typed, functional scripting language in the ML family, inspired by
F#. It combines type inference, pattern matching, and immutable data with concise
syntax for scripts and application rules. Run it as a script, compile it to .NET,
or embed it in your application.

```fsharp
let double x = x * 2
let values = [1; 2; 3] |> List.map double
// [2; 4; 6]
```

[Explore FScript](https://fscript.magnusopera.io/) ·
[Language manual](https://fscript.magnusopera.io/manual/)

## Editor features

- **Code assistance:** completion, type errors, hover information, and inlay hints.
- **Navigation and refactoring:** go to definition, find references, and rename.
- **Highlighting:** syntax and semantic highlighting for `.fss` files.
- **Run and debug:** run scripts, set breakpoints, step through code, and inspect variables.
- **Interactive REPL:** send a selection or the current script to an FScript terminal.
- **Test Explorer:** discover, run, debug, and profile FScript tests.

## Get started

Install the extension in VS Code 1.91 or later and open a `.fss` file. The language
server is downloaded from FScript GitHub Releases on first use, and its required
.NET runtime is acquired automatically. Cached installations work offline.

To run, debug, or test scripts, also install the
[FScript CLI](https://fscript.magnusopera.io/manual/learn/editor-setup) and make
`fscript` available on your PATH. Use a current CLI for debugger and Test Explorer
support.

Use **FScript: Run Current Script** from the Command Palette, press **F5** to
debug, or choose **FScript: Open REPL** for an interactive session. Tests in
`*_test.fss` files appear in the Testing view. Script execution and external
providers require a trusted workspace.

## Configuration

Editor assistance works with the defaults. Search for **FScript** in VS Code
Settings to customize it:

| Setting | Purpose |
| --- | --- |
| `fscript.inlayHints.enabled` | Show inferred type hints (default: `true`). |
| `fscript.hoverHints.enabled` | Show hover hints (default: `true`). |
| `fscript.cli.path` | CLI executable or `fscript.dll`; empty uses `fscript` on PATH. |
| `fscript.repl.command` | REPL launch command; default `auto` detects a local CLI or uses PATH. |
| `fscript.config` | Workspace-relative `fscript.toml` path; overrides the configuration picker. |
| `fscript.server.path` | Optional custom language server; empty acquires a supported released server. |
| `fscript.server.version` | Pin an exact supported server version; empty offers upgrades. |
| `fscript.lsp.enabled` | Enable editor language services (default: `true`). |
| `fscript.server.logLevel` | Server logging level (default: `info`). |

For projects with external functions or NuGet providers, add a `fscript.toml`.
The extension automatically finds the nearest containing manifest within the
workspace folder. Use **FScript: Select Configuration** to choose one explicitly
or select **No configuration**. Run and debug use the selected environment;
REPL commands have their own launch configuration.

See the [settings and commands reference](https://fscript.magnusopera.io/manual/reference/editor)
and [environment configuration guide](https://fscript.magnusopera.io/manual/reference/environment-configuration)
for examples and advanced options. For startup problems, run
**FScript: Show Language Server Output**.

On startup the extension checks for newer language servers in the background.
Accept **Update Language Server** to install one, then reload when convenient.
If the latest server needs a newer extension, it offers **Update Extension**.
Use **FScript: Check for Language Server Updates** to check manually. Previous
servers stay cached: set `fscript.server.version` to a supported older version
to roll back. Updates never change your CLI installation.

## Stable and Next

Stable is the default. When a Next pre-release is available, choose **Switch to
Pre-Release Version** on the extension's details page to try the Next extension. Both channels acquire released
language servers within their declared compatibility ranges. Choose **Switch to Release Version** to return to Stable.
The CLI is installed separately; use a compatible version when running Next code.

[Report an issue](https://github.com/FScriptLang/vscode-extension/issues) ·
[Contribute](https://github.com/FScriptLang/vscode-extension/blob/main/CONTRIBUTING.md)
