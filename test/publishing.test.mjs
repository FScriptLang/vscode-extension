import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
  writeFileSync(path.join(root, 'fscript-1.2.3.vsix'), 'fixture');
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(readFileSync(env.PUBLISH_TEST_LOG, 'utf8')),
    ['publish', '--packagePath', 'fscript-1.2.3.vsix', '--oidc', '--skip-duplicate']);
  assert.equal(run({PUBLISH_TEST_EXIT: '7'}).status, 7, 'OIDC or Marketplace errors must fail publication');
  writeFileSync(path.join(root, 'second.vsix'), 'fixture');
  assert.notEqual(run().status, 0, 'Ambiguous artifacts must fail');
});
