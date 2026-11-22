import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import yaml from 'js-yaml';
import {validateRelease} from '../scripts/check-release.mjs';
import {readServerConfig} from '../scripts/verify-server.mjs';
import {prepareServer} from '../scripts/prepare-server.mjs';

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

test('packaging validates acquisition without a server checkout, binaries, or network access', async () => {
  const config = readServerConfig();
  assert.equal(config.repository, 'FScriptLang/FScript');
  assert.equal(config.supportedVersions, '>=0.95.5 <0.96.0');
  assert.deepEqual(await prepareServer(), config);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.contributes.configuration.properties['fscript.server.version'].scope, 'machine');
  const ignored = readFileSync(new URL('../.vscodeignore', import.meta.url), 'utf8');
  assert.match(ignored, /server\/\*\*/);
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
  assert.deepEqual(release.jobs.marketplace.needs, ['validate', 'github-release']);
  assert.ok(release.jobs.package.if.includes('!inputs.marketplace_only'));
  assert.ok(release.jobs.marketplace.if.includes("needs.validate.result == 'success'"));
  assert.ok(release.jobs.marketplace.if.includes("inputs.marketplace_only && needs.github-release.result == 'skipped'"));
  assert.equal(release.jobs.marketplace.steps[0].with.ref, undefined, 'Publisher uses the workflow revision');
  const downloadPublished = release.jobs.marketplace.steps.find(step => step.run?.startsWith('gh release download'));
  assert.equal(downloadPublished.if, 'inputs.marketplace_only');
  assert.equal(release.jobs.marketplace.permissions['id-token'], 'write');
  assert.equal(release.jobs['open-vsx'].needs, 'github-release');
  assert.ok(release.jobs['open-vsx'].steps.some(step => step.env?.OPEN_VSX_TOKEN === '${{ secrets.OPEN_VSX_TOKEN }}'));
  assert.doesNotMatch(JSON.stringify(release), /VSCE_TOKEN|VSCE_PAT/);
  assert.doesNotMatch(JSON.stringify(release), /PAT|repository_dispatch|MagnusOpera\/FScript/);
  assert.deepEqual(ci.permissions, {contents: 'read'});
  assert.equal(ci.jobs.package.environment, undefined);
  assert.equal(ci.jobs.package.permissions, undefined);
  assert.doesNotMatch(JSON.stringify(ci), /secrets\.|"secrets"|id-token|pull_request_target/);
  assert.equal(ci.jobs.package.steps[0].with['persist-credentials'], false);
  for (const job of ['github-release', 'marketplace', 'open-vsx']) assert.equal(release.jobs[job].environment, 'release');
});
