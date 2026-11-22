// Validate the acquisition contract. Extension packaging deliberately needs no server or SDK.
// To prefetch a released server for local testing, pass --download and optionally X.Y.Z.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ServerManager} from '../server-manager.js';
import {readServerConfig} from './verify-server.mjs';

export async function prepareServer({directory = fileURLToPath(new URL('../', import.meta.url)), download = false, version = ''} = {}) {
  const config = readServerConfig(directory);
  if (!download) return config;
  return new ServerManager({directory: path.join(directory, '.build/language-servers'), config, pinnedVersion: version}).resolve();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await prepareServer({download: process.argv.includes('--download'), version: process.argv[3] || ''});
  console.log(server.dll || 'Server acquisition configured; no binaries are bundled.');
}
