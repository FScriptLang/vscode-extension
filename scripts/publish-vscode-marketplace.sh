#!/usr/bin/env bash
set -euo pipefail

mapfile -t vsix_files < <(find . -maxdepth 1 -type f -name '*.vsix' -print | sort)
if [[ "${#vsix_files[@]}" -ne 1 ]]; then
  echo "Expected exactly one VSIX artifact, found ${#vsix_files[@]}." >&2
  exit 1
fi

vsix_file="${vsix_files[0]#./}"
echo "Publishing VSIX to VS Code Marketplace with Trusted Publishing: ${vsix_file}"
channel="$(node "$(dirname "$0")/release-channel.mjs" "$vsix_file")"
channel_args=()
if [[ "$channel" == next ]]; then
  channel_args+=(--pre-release)
fi
vsce publish --packagePath "$vsix_file" --oidc --skip-duplicate "${channel_args[@]}"
