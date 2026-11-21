import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

test('Marketplace publishes one VSIX through OIDC, needs no token, and propagates failures', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'extension-publish-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(path.join(root, 'bin'));
  const command = path.join(root, 'bin/vsce');
  writeFileSync(command, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PUBLISH_TEST_LOG, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.PUBLISH_TEST_EXIT || 0));\n`);
  chmodSync(command, 0o755);
  const env = {...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    PUBLISH_TEST_LOG: path.join(root, 'command.json')};
  delete env.VSCE_TOKEN;
  delete env.VSCE_PAT;
  const script = fileURLToPath(new URL('../scripts/publish-vscode-marketplace.sh', import.meta.url));
  const run = (extra = {}) => spawnSync('bash', [script], {cwd: root, env: {...env, ...extra}, encoding: 'utf8'});
  assert.notEqual(run().status, 0, 'Missing artifacts must fail');
  const makeVsix = (channel, preRelease = channel === 'next') => {
    mkdirSync(path.join(root, 'extension'), {recursive: true});
    writeFileSync(path.join(root, 'extension/package.json'), JSON.stringify({
      publisher: 'MagnusOpera', name: 'fscript', fscriptReleaseChannel: channel,
    }));
    writeFileSync(path.join(root, 'extension.vsixmanifest'), `<PackageManifest><Metadata><Properties>${
      preRelease ? '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" />' : ''
    }</Properties></Metadata></PackageManifest>`);
    execFileSync('zip', ['-q', 'fscript-1.2.3.vsix', 'extension/package.json', 'extension.vsixmanifest'], {cwd: root});
  };
  makeVsix('stable');
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(readFileSync(env.PUBLISH_TEST_LOG, 'utf8')),
    ['publish', '--packagePath', 'fscript-1.2.3.vsix', '--oidc', '--skip-duplicate']);
  assert.equal(run({PUBLISH_TEST_EXIT: '7'}).status, 7, 'OIDC or Marketplace errors must fail publication');
  makeVsix('next');
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(readFileSync(env.PUBLISH_TEST_LOG, 'utf8')),
    ['publish', '--packagePath', 'fscript-1.2.3.vsix', '--oidc', '--skip-duplicate', '--pre-release']);
  makeVsix('next', false);
  assert.notEqual(run().status, 0, 'A Next artifact without pre-release metadata must fail');
  makeVsix('stable', true);
  assert.notEqual(run().status, 0, 'A stable artifact with pre-release metadata must fail');
  makeVsix('typo');
  assert.notEqual(run().status, 0, 'Unknown channels must fail');
  makeVsix(undefined, false);
  assert.equal(run().status, 0, 'Existing stable artifacts without a channel remain retryable');
  writeFileSync(path.join(root, 'second.vsix'), 'fixture');
  assert.notEqual(run().status, 0, 'Ambiguous artifacts must fail');
});
