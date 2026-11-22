import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateConfig} from '../server-manager.js';

export function readServerConfig(directory = fileURLToPath(new URL('../', import.meta.url))) {
  return validateConfig(JSON.parse(readFileSync(path.join(directory, 'language-server.json'), 'utf8')));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  readServerConfig();
  console.log('Verified language-server acquisition configuration.');
}
