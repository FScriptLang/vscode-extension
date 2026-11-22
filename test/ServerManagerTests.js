const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {test} = require('node:test');
const AdmZip = require('adm-zip');
const {ServerManager, validateConfig, download} = require('../server-manager');
const {createServerController} = require('../server-updates');
const config = {repository: 'FScriptLang/FScript', supportedVersions: '>=0.95.4 <0.96.0', runtime: '11.0'};
const files = ['FScript.LanguageServer.dll', 'FScript.Language.dll', 'FScript.Runtime.dll',
  'FScript.CSharpInterop.dll', 'FScript.Extensibility.dll', 'FScript.LanguageServer.deps.json'];
const metadata = version => ({schemaVersion: 1, version, runtime: '11.0', revision: 'a'.repeat(40)});
function archive(version, change = () => {}) {
  const zip = new AdmZip();
  for (const file of files) zip.addFile(file, Buffer.from('fixture'));
  zip.addFile('FScript.LanguageServer.runtimeconfig.json', Buffer.from(JSON.stringify({runtimeOptions: {tfm: 'net11.0'}})));
  zip.addFile('server.json', Buffer.from(JSON.stringify(metadata(version))));
  zip.addFile('cs/messages.resources.dll', Buffer.from('nested resource'));
  change(zip);
  return zip.toBuffer();
}
const release = version => ({tag_name: `v${version}`, assets: [
  {name: `fscript-lsp-${version}.json`}, {name: `fscript-lsp-${version}-dotnet.zip`} ]});
async function harness(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fscript-acquisition-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const requests = [];
  const payloads = new Map();
  const publish = (version, bytes = archive(version), extra = {}) => {
    payloads.set(`fscript-lsp-${version}-dotnet.zip`, bytes);
    payloads.set(`fscript-lsp-${version}.json`, Buffer.from(JSON.stringify({...metadata(version),
      archive: {name: `fscript-lsp-${version}-dotnet.zip`, sha256: createHash('sha256').update(bytes).digest('hex')}, ...extra})));
  };
  let available = options.releases || [release('0.95.4')];
  const request = async url => {
    requests.push(url);
    if (options.fail) throw new Error('offline');
    if (url.includes('api.github.com')) return Buffer.from(JSON.stringify(available));
    const bytes = payloads.get(url.split('/').at(-1));
    if (!bytes) throw new Error(`404: ${url}`);
    return bytes;
  };
  publish('0.95.4'); publish('0.95.5');
  const manager = new ServerManager({directory, config, request, ...options});
  return {manager, directory, requests, publish, payloads, setReleases(value) { available = value; }};
}

test('first installation verifies the distribution and reuses the cache offline', async t => {
  const h = await harness(t);
  const server = await h.manager.resolve();
  assert.equal(server.version, '0.95.4');
  assert.equal(await fs.readFile(path.join(server.directory, 'cs/messages.resources.dll'), 'utf8'), 'nested resource');
  const offline = new ServerManager({directory: h.directory, config, request: async () => { throw new Error('offline'); }});
  assert.equal((await offline.resolve()).dll, server.dll);
  await assert.rejects(offline.checkForUpdates(server), /offline/);
  assert.deepEqual((await fs.readdir(h.directory)), ['0.95.4']);
});

test('releases are filtered and sorted, and a newer incompatible release still allows a compatible upgrade', async t => {
  const h = await harness(t, {releases: [release('0.95.5'), {...release('0.97.0'), prerelease: true},
    release('0.96.0'), {...release('0.99.0'), draft: true}, {tag_name:'v1.0.0', assets: []}, release('0.95.4')]});
  const current = await h.manager.install('0.95.4');
  assert.deepEqual(await h.manager.checkForUpdates(current), {serverUpdate:'0.95.5', extensionUpdate:'0.96.0'});
  assert.equal((await h.manager.resolve()).version, '0.95.4', 'cached startup never silently downloads an update');
  await h.manager.install('0.95.5');
  assert.deepEqual((await h.manager.cached()).map(server => server.version), ['0.95.5', '0.95.4']);
});

test('exact pin can roll back offline and never proposes a server upgrade', async t => {
  const h = await harness(t, {releases: [release('0.95.5')]});
  await h.manager.install('0.95.4'); await h.manager.install('0.95.5');
  const pinned = new ServerManager({directory:h.directory, config, pinnedVersion:'0.95.4', request:h.manager.request});
  const current = await pinned.resolve();
  assert.equal(current.version, '0.95.4');
  assert.equal((await pinned.checkForUpdates(current)).serverUpdate, undefined);
  assert.throws(() => new ServerManager({directory:h.directory, config, pinnedVersion:'0.96.0'}), /outside/);
  assert.throws(() => validateConfig({...config, supportedVersions:'nonsense'}));
});

test('a pin can install an older release directly without release discovery', async t => {
  const h = await harness(t, {pinnedVersion: '0.95.4'});
  await h.manager.resolve();
  assert.ok(h.requests.every(url => !url.includes('api.github.com')));
});

test('checksum failures preserve the old server and never expose partial installations', async t => {
  const h = await harness(t);
  await h.manager.install('0.95.4');
  h.payloads.set('fscript-lsp-0.95.5-dotnet.zip', Buffer.from('corrupted'));
  await assert.rejects(h.manager.install('0.95.5'), /checksum mismatch/);
  assert.equal((await h.manager.resolve()).version, '0.95.4');
  assert.deepEqual(await fs.readdir(h.directory), ['0.95.4']);
});

test('rejects incompatible metadata, unsafe archives, and incomplete distributions', async t => {
  const h = await harness(t);
  h.publish('0.95.4', archive('0.95.4'), {runtime:'12.0'});
  await assert.rejects(h.manager.install('0.95.4'), /incompatible/);
  h.publish('0.95.4', archive('0.95.4', zip => zip.deleteFile('FScript.Runtime.dll')));
  await assert.rejects(h.manager.install('0.95.4'), /ENOENT/);
  h.publish('0.95.4', archive('0.95.4', zip => {
    zip.addFile('link', Buffer.from('/tmp/outside'));
    zip.getEntry('link').attr = (0o120777 << 16) >>> 0;
  }));
  await assert.rejects(h.manager.install('0.95.4'), /Unsafe/);
  h.publish('0.95.4', archive('0.95.4', zip => {
    zip.addFile('fifo', Buffer.from(''));
    zip.getEntry('fifo').attr = (0o010644 << 16) >>> 0;
  }));
  await assert.rejects(h.manager.install('0.95.4'), /Unsafe/);
  // ZIP filename bytes can contain traversal even when a ZIP authoring API sanitizes paths.
  const unsafe = archive('0.95.4', zip => zip.addFile('aa/escape', Buffer.from('bad')));
  const traversal = Buffer.from(unsafe.toString('binary').replaceAll('aa/escape', '../escape'), 'binary');
  h.publish('0.95.4', traversal);
  await assert.rejects(h.manager.install('0.95.4'), /Unsafe/);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('ignores corrupt cache entries and repairs them from verified releases', async t => {
  const h = await harness(t);
  await h.manager.install('0.95.4');
  await fs.unlink(path.join(h.directory, '0.95.4/FScript.Runtime.dll'));
  assert.deepEqual(await h.manager.cached(), []);
  assert.equal((await h.manager.resolve()).version, '0.95.4');
});

test('concurrent installation requests share a complete atomic installation', async t => {
  const h = await harness(t);
  const [one, two] = await Promise.all([h.manager.install('0.95.4'), h.manager.install('0.95.4')]);
  assert.equal(one.dll, two.dll);
  assert.equal(h.requests.filter(url => url.endsWith('.zip')).length, 1);
  const another = new ServerManager({directory: h.directory, config, request:h.manager.request});
  const [a, b] = await Promise.all([h.manager.install('0.95.5'), another.install('0.95.5')]);
  assert.equal(a.dll, b.dll);
});

test('first install fails clearly without a compatible published asset', async t => {
  const h = await harness(t, {releases:[release('0.96.0')]});
  await assert.rejects(h.manager.resolve(), /No published language server/);
});

function controllerHarness({update = {}, choices = [], fail, installFailure, pin = ''} = {}) {
  const messages = [], calls = [], logs = [];
  const current = {version:'0.95.4', dll:'/cache/server.dll'};
  const manager = {
    async resolve() { calls.push('resolve'); return current; },
    async checkForUpdates() { if (fail) throw new Error('offline'); return update; },
    async install(version) { calls.push(['install',version]); if (installFailure) throw new Error('Download failed'); }
  };
  const context = {subscriptions:[]};
  const vscode = {
    workspace: {getConfiguration: () => ({get: () => pin})},
    window: {
      async showInformationMessage(message, ...actions) { messages.push({message,actions}); return choices.shift(); },
      async showWarningMessage(message) { messages.push({message}); }
    },
    commands: {async executeCommand(...args) { calls.push(args); }}
  };
  return {controller:createServerController({vscode, context, config, manager, log: message => logs.push(message)}), messages, calls, logs, context};
}

test('update check offers installation only with user acceptance and reloads only on acceptance', async () => {
  const declined = controllerHarness({update:{serverUpdate:'0.95.5'}});
  await declined.controller.check();
  assert.deepEqual(declined.calls, ['resolve']);
  const accepted = controllerHarness({update:{serverUpdate:'0.95.5'}, choices:['Update Language Server','Reload Window']});
  await accepted.controller.check();
  assert.deepEqual(accepted.calls, ['resolve', ['install','0.95.5'], ['workbench.action.reloadWindow']]);
});

test('incompatible latest release offers extension update without installing a server', async () => {
  const h = controllerHarness({update:{extensionUpdate:'0.96.0'}, choices:['Update Extension']});
  await h.controller.check();
  assert.deepEqual(h.calls, ['resolve', ['workbench.extensions.action.showExtensionsWithIds', ['MagnusOpera.fscript']]]);
});

test('offline background checks only log; explicit checks explain failures', async () => {
  const h = controllerHarness({fail:true});
  await h.controller.check();
  assert.equal(h.messages.length,0);
  assert.match(h.logs[0], /offline/);
  await h.controller.check(true);
  assert.match(h.messages[0].message, /offline/);
});

test('disposed controllers suppress delayed prompts', async () => {
  const h = controllerHarness({update:{serverUpdate:'0.95.5'}});
  h.context.subscriptions.forEach(subscription => subscription.dispose());
  await h.controller.check();
  assert.equal(h.messages.length,0);
});


test('release discovery follows pagination instead of assuming the first page contains a compatible server', async t => {
  const h = await harness(t);
  let pages = [];
  const manager = new ServerManager({directory:h.directory, config, request:async url => {
    pages.push(url);
    const releases = url.endsWith('page=1') ? Array.from({length:100}, () => release('0.96.0')) : [release('0.95.4')];
    return Buffer.from(JSON.stringify(releases));
  }});
  assert.deepEqual(await manager.releases(), ['0.96.0','0.95.4']);
  assert.equal(pages.length,2);
});

test('HTTP transport rejects failed responses, insecure URLs, and oversized bodies', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  await assert.rejects(download('http://github.com/asset'), /HTTPS/);
  global.fetch = async () => ({ok:false,status:403});
  await assert.rejects(download('https://github.com/asset'), /403/);
  const response = body => ({ok:true,url:'https://github.com/asset',headers:new Headers(),body});
  global.fetch = async () => response((async function* () { yield Buffer.alloc(3); yield Buffer.alloc(3); })());
  await assert.rejects(download('https://github.com/asset',5), /size limit/);
  global.fetch = async () => response((async function* () { yield Buffer.from('ok'); })());
  assert.equal((await download('https://github.com/asset')).toString(),'ok');
});


test('accepted background upgrades report download failures while retaining the current server', async () => {
  const h = controllerHarness({update:{serverUpdate:'0.95.5'}, choices:['Update Language Server'], installFailure:true});
  await h.controller.check();
  assert.match(h.messages.at(-1).message,/Download failed/);
  assert.deepEqual(h.calls,['resolve',['install','0.95.5']]);
});
