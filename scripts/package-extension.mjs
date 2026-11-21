import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {releaseChannel} from './release-channel.mjs';

const channel = releaseChannel(JSON.parse(readFileSync('package.json', 'utf8')));
const args = process.argv.slice(2);
if (args.some(arg => arg === '--pre-release' || arg.startsWith('--pre-release='))) {
  throw new Error('Set fscriptReleaseChannel in package.json instead of overriding the package channel');
}
const result = spawnSync('vsce', ['package', ...(channel === 'next' ? ['--pre-release'] : []), ...args], {stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
