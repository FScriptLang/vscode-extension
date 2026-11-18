import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyServer} from './verify-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function readServerConfig(directory = root) {
  const config = JSON.parse(readFileSync(path.join(directory, 'language-server.json'), 'utf8'));
  assert.equal(config.repository, 'MagnusOpera/FScript', 'Server source must come from the public FScript repository');
  assert.match(config.revision, /^[a-f0-9]{40}$/, 'Pin an immutable FScript commit');
  assert.match(config.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.match(config.sdk, /^\d+\.\d+\.\d+$/);
  assert.match(config.runtime, /^\d+\.\d+$/);
  return config;
}

export function prepareServer({directory = root, run = execFileSync} = {}) {
  const config = readServerConfig(directory);
  const source = path.join(directory, '.build/fscript');
  const git = (...args) => run('git', ['-C', source, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  mkdirSync(path.join(directory, '.build'), {recursive: true});
  if (!existsSync(path.join(source, '.git'))) {
    run('git', ['clone', '--filter=blob:none', `https://github.com/${config.repository}.git`, source], {stdio: 'inherit'});
  }
  assert.equal(git('remote', 'get-url', 'origin'), `https://github.com/${config.repository}.git`);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Preserve local edits in the server checkout before changing its revision');
  git('fetch', '--depth=1', 'origin', config.revision);
  git('checkout', '--detach', config.revision);
  assert.equal(git('rev-parse', 'HEAD'), config.revision);
  const workspace = readFileSync(path.join(source, 'WORKSPACE'), 'utf8');
  assert.ok(workspace.includes(`dotnet_sdk: "${config.sdk}"`), 'Pinned server SDK differs from its source WORKSPACE');
  const project = readFileSync(path.join(source, 'src/FScript.LanguageServer/FScript.LanguageServer.csproj'), 'utf8');
  assert.ok(project.includes(`<TargetFramework>net${config.runtime}</TargetFramework>`), 'Runtime acquisition must match the packaged server');

  const staged = mkdtempSync(path.join(directory, '.build/server-'));
  try {
    run('dotnet', ['publish', path.join(source, 'src/FScript.LanguageServer/FScript.LanguageServer.csproj'),
      '-c', 'Release', '-p:PublishAot=false', `-p:Version=${config.version}`, '-o', staged], {cwd: source, stdio: 'inherit'});
    // This upstream regression checks assembly versions and real configured
    // SDK providers against the exact binaries that will enter the VSIX.
    run('dotnet', ['test', path.join(source, 'tests/FScript.LanguageServer.Tests/FScript.LanguageServer.Tests.csproj'),
      '-c', 'Release', '--filter', 'FullyQualifiedName~ReleasePackagingTests|FullyQualifiedName~EnvironmentTests'], {
      cwd: source, stdio: 'inherit', env: {...process.env, FSCRIPT_RELEASE_SERVER_DIR: staged, FSCRIPT_RELEASE_VERSION: config.version},
    });
    writeFileSync(path.join(staged, 'source.json'), `${JSON.stringify(config, null, 2)}\n`);
    verifyServer(staged, config);
    rmSync(path.join(directory, 'server'), {recursive: true, force: true});
    renameSync(staged, path.join(directory, 'server'));
  } finally {
    rmSync(staged, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareServer();
