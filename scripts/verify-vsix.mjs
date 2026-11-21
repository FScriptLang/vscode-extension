import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {releaseChannel, vsixChannel} from './release-channel.mjs';

const packageFile = process.argv[2];
assert.ok(packageFile, 'Supply the VSIX path');
const listing = execFileSync('unzip', ['-Z1', packageFile], {encoding: 'utf8'}).split('\n');
for (const entry of ['extension/dist/extension.js', 'extension/syntaxes/fscript.tmLanguage.json',
  'extension/server/FScript.LanguageServer.dll', 'extension/server/FScript.Runtime.dll',
  'extension/server/FScript.Extensibility.dll', 'extension/server/source.json']) {
  assert.ok(listing.includes(entry), `VSIX is missing ${entry}`);
}
assert.ok(!listing.some((file) => /extension\/(?:\.build|test|scripts)\//.test(file)), 'Build sources and tests must not enter the VSIX');
const expected = JSON.parse(readFileSync('package.json', 'utf8'));
const packaged = JSON.parse(execFileSync('unzip', ['-p', packageFile, 'extension/package.json'], {encoding: 'utf8'}));
assert.equal(packaged.publisher, 'MagnusOpera');
assert.equal(packaged.name, 'fscript');
assert.equal(packaged.version, expected.version);
assert.equal(vsixChannel(packageFile), releaseChannel(expected));
console.log(`Verified ${packageFile}: MagnusOpera.fscript ${packaged.version} with bundled language server.`);
