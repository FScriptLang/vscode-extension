import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function releaseChannel(manifest) {
  // Releases predating channel support are stable.
  const channel = manifest.fscriptReleaseChannel === undefined ? 'stable' : manifest.fscriptReleaseChannel;
  assert.ok(channel === 'stable' || channel === 'next', 'fscriptReleaseChannel must be stable or next');
  return channel;
}

export function vsixChannel(packageFile) {
  const read = (entry) => execFileSync('unzip', ['-p', packageFile, entry], {encoding: 'utf8'});
  const manifest = JSON.parse(read('extension/package.json'));
  assert.equal(manifest.publisher, 'MagnusOpera');
  assert.equal(manifest.name, 'fscript');
  const channel = releaseChannel(manifest);
  const xml = read('extension.vsixmanifest');
  const preRelease = /<Property\b[^>]*\bId="Microsoft\.VisualStudio\.Code\.PreRelease"[^>]*\bValue="true"[^>]*\/>/.test(xml);
  assert.equal(preRelease, channel === 'next', 'VSIX pre-release metadata must match its committed channel');
  return channel;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(process.argv[2] ? vsixChannel(process.argv[2]) : releaseChannel(JSON.parse(readFileSync('package.json', 'utf8'))));
}
