import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {validateConfig} from '../server-manager.js';
import {releaseChannel, vsixChannel} from './release-channel.mjs';

const packageFile = process.argv[2];
assert.ok(packageFile, 'Supply the VSIX path');
const listing = execFileSync('unzip', ['-Z1', packageFile], {encoding: 'utf8'}).split('\n');
for (const entry of ['extension/dist/extension.js', 'extension/syntaxes/fscript.tmLanguage.json',
  'extension/language-server.json']) {
  assert.ok(listing.includes(entry), `VSIX is missing ${entry}`);
}
assert.ok(!listing.some(file => /extension\/server\/|\.dll$/.test(file)), 'VSIX must acquire servers instead of bundling binaries');
assert.ok(!listing.some((file) => /extension\/(?:\.build|test|scripts)\//.test(file)), 'Build sources and tests must not enter the VSIX');
const expected = JSON.parse(readFileSync('package.json', 'utf8'));
const packaged = JSON.parse(execFileSync('unzip', ['-p', packageFile, 'extension/package.json'], {encoding: 'utf8'}));
const acquisition = JSON.parse(execFileSync('unzip', ['-p', packageFile, 'extension/language-server.json'], {encoding: 'utf8'}));
validateConfig(acquisition);
assert.deepEqual(acquisition, JSON.parse(readFileSync('language-server.json', 'utf8')));
assert.equal(packaged.publisher, 'MagnusOpera');
assert.equal(packaged.name, 'fscript');
assert.equal(packaged.version, expected.version);
assert.equal(vsixChannel(packageFile), releaseChannel(expected));
console.log(`Verified ${packageFile}: MagnusOpera.fscript ${packaged.version} with downloadable language server.`);
