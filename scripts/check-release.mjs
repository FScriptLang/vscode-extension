import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {releaseChannel} from './release-channel.mjs';

export function validateRelease(tag, manifest, changelog) {
  assert.equal(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag)?.[0], tag,
    'Use a canonical vX.Y.Z extension tag');
  releaseChannel(manifest);
  assert.equal(tag, `v${manifest.version}`, 'Tag must match the committed extension version');
  assert.equal(manifest.publisher, 'MagnusOpera');
  assert.equal(manifest.name, 'fscript');
  const escaped = tag.replaceAll('.', '\\.');
  const section = new RegExp(`^### \\[${escaped}\\]\\n([\\s\\S]*?)(?=^#{1,3} |$(?![\\s\\S]))`, 'm').exec(changelog)?.[1];
  assert.ok(section && /^- /m.test(section), `Missing extension release notes for ${tag}`);
  return section.trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  console.log(validateRelease(process.env.RELEASE_TAG, JSON.parse(readFileSync(new URL('package.json', root), 'utf8')),
    readFileSync(new URL('CHANGELOG.md', root), 'utf8')));
}
