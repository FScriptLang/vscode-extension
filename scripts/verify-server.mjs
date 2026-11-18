import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function verifyServer(directory, config) {
  for (const file of ['FScript.LanguageServer.dll', 'FScript.Language.dll', 'FScript.Runtime.dll',
    'FScript.CSharpInterop.dll', 'FScript.Extensibility.dll', 'FScript.LanguageServer.deps.json']) {
    assert.ok(existsSync(path.join(directory, file)), `Missing packaged server file: ${file}. Run npm run prepare:server.`);
  }
  const runtime = JSON.parse(readFileSync(path.join(directory, 'FScript.LanguageServer.runtimeconfig.json'), 'utf8'));
  assert.equal(runtime.runtimeOptions.tfm, `net${config.runtime}`);
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'source.json'), 'utf8')), config,
    'Packaged server does not match language-server.json. Run npm run prepare:server.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  verifyServer(path.join(root, 'server'), JSON.parse(readFileSync(path.join(root, 'language-server.json'), 'utf8')));
}
