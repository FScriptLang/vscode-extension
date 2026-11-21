import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {releaseChannel} from '../scripts/release-channel.mjs';
import {validateRelease} from '../scripts/check-release.mjs';

function harness(t, command) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'extension-channels-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(path.join(root, 'bin'));
  const executable = path.join(root, 'bin', command);
  writeFileSync(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CHANNEL_TEST_LOG, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.CHANNEL_TEST_EXIT || 0));\n`);
  chmodSync(executable, 0o755);
  const env = {...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    CHANNEL_TEST_LOG: path.join(root, 'command.json')};
  return {root, env, args: () => JSON.parse(readFileSync(env.CHANNEL_TEST_LOG, 'utf8'))};
}

test('packaging uses the committed channel, preserves arguments, and propagates failures', (t) => {
  const h = harness(t, 'vsce');
  const script = fileURLToPath(new URL('../scripts/package-extension.mjs', import.meta.url));
  const run = (args = [], extra = {}) => spawnSync(process.execPath, [script, ...args],
    {cwd: h.root, env: {...h.env, ...extra}, encoding: 'utf8'});
  const manifest = (channel) => writeFileSync(path.join(h.root, 'package.json'), JSON.stringify({fscriptReleaseChannel: channel}));
  manifest('stable');
  assert.equal(run().status, 0);
  assert.deepEqual(h.args(), ['package']);
  manifest('next');
  assert.equal(run(['--out', 'next.vsix']).status, 0);
  assert.deepEqual(h.args(), ['package', '--pre-release', '--out', 'next.vsix']);
  assert.equal(run([], {CHANNEL_TEST_EXIT: '7'}).status, 7);
  assert.notEqual(run(['--pre-release']).status, 0, 'Flags must not override the committed channel');
  manifest('typo');
  assert.notEqual(run().status, 0);
  assert.equal(releaseChannel({}), 'stable');
  assert.throws(() => releaseChannel({fscriptReleaseChannel: null}));
  const notes = '### [v1.2.3]\n\n- Preview.\n';
  const base = {publisher: 'MagnusOpera', name: 'fscript', version: '1.2.3'};
  assert.equal(validateRelease('v1.2.3', {...base, fscriptReleaseChannel: 'next'}, notes), '- Preview.');
  assert.throws(() => validateRelease('v1.2.3', {...base, fscriptReleaseChannel: 'typo'}, notes));
});

test('Open VSX reads the artifact channel independently of the publishing checkout', (t) => {
  const h = harness(t, 'ovsx');
  mkdirSync(path.join(h.root, 'extension'));
  const script = fileURLToPath(new URL('../scripts/publish-open-vsx.sh', import.meta.url));
  for (const channel of ['stable', 'next']) {
    writeFileSync(path.join(h.root, 'package.json'), JSON.stringify({fscriptReleaseChannel: channel === 'next' ? 'stable' : 'next'}));
    writeFileSync(path.join(h.root, 'extension/package.json'), JSON.stringify({publisher: 'MagnusOpera', name: 'fscript', fscriptReleaseChannel: channel}));
    writeFileSync(path.join(h.root, 'extension.vsixmanifest'), `<PackageManifest><Metadata><Properties>${channel === 'next'
      ? '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" />' : ''}</Properties></Metadata></PackageManifest>`);
    execFileSync('zip', ['-q', 'fixture.vsix', 'extension/package.json', 'extension.vsixmanifest'], {cwd: h.root});
    const run = (extra = {}) => spawnSync('bash', [script], {cwd: h.root,
      env: {...h.env, OPEN_VSX_TOKEN: 'test-fixture', ...extra}, encoding: 'utf8'});
    assert.equal(run().status, 0);
    assert.deepEqual(h.args(), ['publish', 'fixture.vsix', '--pat', 'test-fixture', ...(channel === 'next' ? ['--pre-release'] : [])]);
    assert.notEqual(run({CHANNEL_TEST_EXIT: '7'}).status, 0);
    assert.notEqual(run({OPEN_VSX_TOKEN: ''}).status, 0);
  }
});

test('GitHub Next releases are marked pre-release and do not replace latest stable', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs['github-release'].steps;
  const inspect = steps.find(step => step.id === 'channel');
  assert.match(inspect.run, /release-channel\.mjs.*\.vsix/);
  const publish = steps.find(step => step.uses?.startsWith('softprops/action-gh-release@'));
  assert.equal(publish.with.prerelease, "${{ steps.channel.outputs.channel == 'next' }}");
  assert.equal(publish.with.make_latest, "${{ steps.channel.outputs.channel != 'next' }}");
});
