import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import yaml from 'js-yaml';
import {validateRelease} from '../scripts/check-release.mjs';
import {verifyServer} from '../scripts/verify-server.mjs';
import {readServerConfig} from '../scripts/prepare-server.mjs';

test('extension releases preserve the publisher and require their own tag, version, and notes', () => {
  const manifest = {name: 'fscript', publisher: 'MagnusOpera', version: '1.2.3'};
  const notes = '# Changelog\n\n## [Unreleased]\n\n### [v1.2.3]\n\n- Extension improvement.\n';
  assert.equal(validateRelease('v1.2.3', manifest, notes), '- Extension improvement.');
  for (const tag of ['1.2.3', 'v01.2.3', 'v1.2.3-beta', 'v1.2.3\n', 'v1.2.4']) {
    assert.throws(() => validateRelease(tag, manifest, notes), tag);
  }
  assert.throws(() => validateRelease('v1.2.3', {...manifest, publisher: 'FScriptLang'}, notes));
  assert.throws(() => validateRelease('v1.2.3', manifest, '# Changelog'));
});

test('packaging rejects missing binaries, runtime drift, and stale source revisions', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'extension-server-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const config = readServerConfig();
  assert.throws(() => verifyServer(directory, config), /Missing packaged server file/);
  for (const file of ['FScript.LanguageServer.dll', 'FScript.Language.dll', 'FScript.Runtime.dll',
    'FScript.CSharpInterop.dll', 'FScript.Extensibility.dll', 'FScript.LanguageServer.deps.json']) {
    writeFileSync(path.join(directory, file), 'fixture');
  }
  const runtime = (value) => writeFileSync(path.join(directory, 'FScript.LanguageServer.runtimeconfig.json'),
    JSON.stringify({runtimeOptions: {tfm: value}}));
  writeFileSync(path.join(directory, 'source.json'), JSON.stringify(config));
  runtime(`net${config.runtime}`);
  verifyServer(directory, config);
  runtime('net0.0');
  assert.throws(() => verifyServer(directory, config));
  runtime(`net${config.runtime}`);
  writeFileSync(path.join(directory, 'source.json'), JSON.stringify({...config, revision: '0'.repeat(40)}));
  assert.throws(() => verifyServer(directory, config), /does not match/);
});

test('publishing waits for tested VSIX packaging and consumes only the new repository secrets', () => {
  const workflow = (name) => yaml.load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
  const release = workflow('release');
  const ci = workflow('ci');
  assert.deepEqual(release.on.push.tags, ['v[0-9]*.[0-9]*.[0-9]*']);
  assert.equal(release.jobs.package.needs, 'validate');
  assert.equal(release.jobs.package.uses, './.github/workflows/ci.yml');
  assert.ok(release.jobs.package.with.release_tag.includes('inputs.release_tag'));
  assert.ok(ci.jobs.package.steps[0].with.ref.includes('inputs.release_tag'));
  const steps = ci.jobs.package.steps;
  assert.ok(steps.findIndex(step => step.run === 'npm run prepare:server') < steps.findIndex(step => step.run === 'npm run package'));
  assert.ok(steps.some(step => step.run?.includes('verify-vsix.mjs')));
  assert.equal(release.jobs['github-release'].needs, 'package');
  assert.equal(release.jobs.marketplace.needs, 'github-release');
  assert.equal(release.jobs.marketplace.permissions['id-token'], 'write');
  assert.equal(release.jobs['open-vsx'].needs, 'github-release');
  assert.ok(release.jobs['open-vsx'].steps.some(step => step.env?.OPEN_VSX_TOKEN === '${{ secrets.OPEN_VSX_TOKEN }}'));
  assert.doesNotMatch(JSON.stringify(release), /VSCE_TOKEN|VSCE_PAT/);
  assert.doesNotMatch(JSON.stringify(release), /PAT|repository_dispatch|MagnusOpera\/FScript/);
});
