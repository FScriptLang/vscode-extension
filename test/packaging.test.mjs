import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import yaml from 'js-yaml';
import {validateRelease} from '../scripts/check-release.mjs';
import {verifyServer} from '../scripts/verify-server.mjs';
import {prepareServer, readServerConfig} from '../scripts/prepare-server.mjs';

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

test('cached source follows a repository transfer without changing its pin or discarding edits', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'extension-source-transfer-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const config = readServerConfig();
  assert.equal(config.repository, 'FScriptLang/FScript');
  const source = path.join(directory, '.build/fscript');
  mkdirSync(path.join(source, '.git'), {recursive: true});
  mkdirSync(path.join(source, 'src/FScript.LanguageServer'), {recursive: true});
  writeFileSync(path.join(directory, 'language-server.json'), JSON.stringify(config));
  writeFileSync(path.join(source, 'WORKSPACE'), `dotnet_sdk: "${config.sdk}"`);
  writeFileSync(path.join(source, 'src/FScript.LanguageServer/FScript.LanguageServer.csproj'), `<TargetFramework>net${config.runtime}</TargetFramework>`);
  const calls = [];
  let dirty = false;
  const run = (command, args) => {
    calls.push({command, args});
    if (command === 'git') {
      const operation = args.slice(2);
      if (operation[0] === 'status') return dirty ? ' M local-edit.fs' : '';
      if (operation[0] === 'remote' && operation[1] === 'get-url') return 'https://github.com/MagnusOpera/FScript.git';
      if (operation[0] === 'rev-parse') return config.revision;
      return '';
    }
    if (command === 'dotnet' && args[0] === 'publish') {
      const output = args[args.indexOf('-o') + 1];
      for (const file of ['FScript.LanguageServer.dll', 'FScript.Language.dll', 'FScript.Runtime.dll',
        'FScript.CSharpInterop.dll', 'FScript.Extensibility.dll', 'FScript.LanguageServer.deps.json']) {
        writeFileSync(path.join(output, file), 'fixture');
      }
      writeFileSync(path.join(output, 'FScript.LanguageServer.runtimeconfig.json'), JSON.stringify({runtimeOptions: {tfm: `net${config.runtime}`}}));
    }
    return '';
  };
  prepareServer({directory, run});
  const operations = calls.filter(call => call.command === 'git').map(call => call.args.slice(2));
  assert.deepEqual(operations.find(args => args[0] === 'remote' && args[1] === 'set-url'),
    ['remote', 'set-url', 'origin', 'https://github.com/FScriptLang/FScript.git']);
  assert.deepEqual(operations.find(args => args[0] === 'fetch'), ['fetch', '--depth=1', 'origin', config.revision]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'server/source.json'), 'utf8')), config);
  const verification = calls.find(({command, args}) => command === 'dotnet' && args[0] === 'run');
  assert.equal(path.basename(verification.args[2]), 'verify-assembly-versions.cs');
  assert.deepEqual(verification.args.slice(-2), [config.version, config.extensibilityAssemblyVersion]);
  calls.length = 0;
  dirty = true;
  assert.throws(() => prepareServer({directory, run}), /Preserve local edits/);
  assert.ok(!calls.some(call => call.args.includes('set-url') || call.args.includes('checkout')));
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
  assert.deepEqual(ci.permissions, {contents: 'read'});
  assert.equal(ci.jobs.package.environment, undefined);
  assert.equal(ci.jobs.package.permissions, undefined);
  assert.doesNotMatch(JSON.stringify(ci), /secrets\.|"secrets"|id-token|pull_request_target/);
  assert.equal(ci.jobs.package.steps[0].with['persist-credentials'], false);
  for (const job of ['github-release', 'marketplace', 'open-vsx']) assert.equal(release.jobs[job].environment, 'release');
});
