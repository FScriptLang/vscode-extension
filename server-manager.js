const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const AdmZip = require('adm-zip');
const semver = require('semver');

const REQUIRED = ['FScript.LanguageServer.dll', 'FScript.Language.dll', 'FScript.Runtime.dll',
  'FScript.CSharpInterop.dll', 'FScript.Extensibility.dll', 'FScript.LanguageServer.deps.json',
  'FScript.LanguageServer.runtimeconfig.json'];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateConfig(config) {
  if (config.repository !== 'FScriptLang/FScript' || !semver.validRange(config.supportedVersions)
    || !/^\d+\.\d+$/.test(config.runtime)) throw new Error('Invalid language-server compatibility configuration.');
  return config;
}

async function download(url, maxBytes = 2 * 1024 * 1024) {
  if (!url.startsWith('https://')) throw new Error('Language-server downloads require HTTPS.');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'FScript-VSCode', Accept: 'application/json' },
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`GitHub download failed (${response.status}).`);
  if (!response.url.startsWith('https://')) throw new Error('Insecure download redirect.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Download exceeds size limit.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Download exceeds size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

class ServerManager {
  constructor({ directory, config, pinnedVersion = '', request = download }) {
    this.directory = directory;
    this.config = validateConfig(config);
    this.pinnedVersion = pinnedVersion;
    this.request = request;
    this.installing = new Map();
    if (pinnedVersion && (!VERSION.test(pinnedVersion) || !this.supports(pinnedVersion))) {
      throw new Error(`Pinned language server ${pinnedVersion} is outside ${config.supportedVersions}.`);
    }
  }

  supports(version) { return VERSION.test(version) && semver.satisfies(version, this.config.supportedVersions); }
  assetUrl(version, name) { return `https://github.com/${this.config.repository}/releases/download/v${version}/${name}`; }
  async json(url) { return JSON.parse((await this.request(url)).toString('utf8')); }

  async releases() {
    if (!this.releaseQuery) this.releaseQuery = (async () => {
      const versions = [];
      // GitHub orders releases by creation time, not semantic version. Inspect all pages.
      for (let page = 1; ; page++) {
        const releases = await this.json(`https://api.github.com/repos/${this.config.repository}/releases?per_page=100&page=${page}`);
        if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response.');
        for (const release of releases) {
          const version = release.tag_name?.slice(1);
          if (release.draft || release.prerelease || release.tag_name !== `v${version}` || !VERSION.test(version || '')) continue;
          if (release.assets?.some(asset => asset.name === `fscript-lsp-${version}.json`)
            && release.assets.some(asset => asset.name === `fscript-lsp-${version}-dotnet.zip`)) versions.push(version);
        }
        if (releases.length < 100) break;
      }
      return [...new Set(versions)].sort(semver.rcompare);
    })().catch(error => { this.releaseQuery = undefined; throw error; });
    return this.releaseQuery;
  }

  validateMetadata(metadata, version) {
    if (metadata.schemaVersion !== 1 || metadata.version !== version || !this.supports(version)
      || metadata.runtime !== this.config.runtime || !/^[a-f0-9]{40}$/.test(metadata.revision)) {
      throw new Error(`Language-server ${version} metadata is incompatible with this extension.`);
    }
  }

  async readInstalled(version) {
    return this.readDirectory(version, path.join(this.directory, version));
  }

  async readDirectory(version, directory) {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'server.json'), 'utf8'));
    this.validateMetadata(metadata, version);
    for (const name of REQUIRED) {
      if (!(await fs.stat(path.join(directory, name))).isFile()) throw new Error(`Missing server file: ${name}`);
    }
    const runtime = JSON.parse(await fs.readFile(path.join(directory, 'FScript.LanguageServer.runtimeconfig.json'), 'utf8'));
    if (runtime.runtimeOptions.tfm !== `net${metadata.runtime}`) throw new Error('Language-server runtime mismatch.');
    return { ...metadata, directory, dll: path.join(directory, 'FScript.LanguageServer.dll') };
  }

  async cached() {
    let entries;
    try { entries = await fs.readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const installed = [];
    for (const version of entries.filter(version => this.supports(version)).sort(semver.rcompare)) {
      try { installed.push(await this.readInstalled(version)); } catch { /* Ignore incomplete/corrupt cache entries. */ }
    }
    return installed;
  }

  async resolve() {
    const cached = await this.cached();
    const existing = this.pinnedVersion ? cached.find(server => server.version === this.pinnedVersion) : cached[0];
    if (existing) return existing;
    const version = this.pinnedVersion || (await this.releases()).find(version => this.supports(version));
    if (!version) throw new Error(`No published language server supports ${this.config.supportedVersions}. Update the extension or configure fscript.server.path.`);
    return this.install(version);
  }

  async checkForUpdates(current) {
    const releases = await this.releases();
    const latest = releases[0];
    const compatible = releases.find(version => this.supports(version));
    return {
      extensionUpdate: latest && !this.supports(latest) && semver.gt(latest, current.version) ? latest : undefined,
      serverUpdate: !this.pinnedVersion && compatible && semver.gt(compatible, current.version) ? compatible : undefined
    };
  }

  install(version) {
    if (!this.supports(version)) return Promise.reject(new Error(`Unsupported language server: ${version}`));
    if (!this.installing.has(version)) {
      const pending = this.installVersion(version).finally(() => this.installing.delete(version));
      this.installing.set(version, pending);
    }
    return this.installing.get(version);
  }

  async installVersion(version) {
    try { return await this.readInstalled(version); } catch { /* Install a complete verified replacement. */ }
    const manifest = await this.json(this.assetUrl(version, `fscript-lsp-${version}.json`));
    this.validateMetadata(manifest, version);
    const archiveName = `fscript-lsp-${version}-dotnet.zip`;
    if (manifest.archive?.name !== archiveName || !/^[a-f0-9]{64}$/.test(manifest.archive?.sha256 || '')) throw new Error('Invalid archive manifest.');
    const archive = await this.request(this.assetUrl(version, archiveName), 128 * 1024 * 1024);
    if (createHash('sha256').update(archive).digest('hex') !== manifest.archive.sha256) throw new Error('Language-server checksum mismatch.');
    await fs.mkdir(this.directory, { recursive: true });
    const staging = await fs.mkdtemp(path.join(this.directory, '.install-'));
    try {
      const zip = new AdmZip(archive);
      let expandedSize = 0;
      const names = new Set();
      for (const entry of zip.getEntries()) {
        const name = entry.entryName;
        // Only ordinary files/directories with portable relative paths are allowed.
        const fileType = (entry.attr >>> 16) & 0o170000;
        if (!name || name.includes('\\') || path.posix.isAbsolute(name) || name.split('/').some(part => part === '..')
          || name.includes(':') || ![0, 0o040000, 0o100000].includes(fileType)) throw new Error('Unsafe language-server archive entry.');
        const relative = path.posix.normalize(name).replace(/^\.\//, '').replace(/\/$/, '');
        if (!relative || relative === '.') continue;
        if (names.has(relative.toLowerCase())) throw new Error('Duplicate language-server archive entry.');
        names.add(relative.toLowerCase());
        expandedSize += entry.header.size;
        if (expandedSize > 512 * 1024 * 1024 || names.size > 10000) throw new Error('Expanded archive exceeds size limit.');
        const target = path.join(staging, relative);
        if (entry.isDirectory) await fs.mkdir(target, {recursive: true});
        else {
          await fs.mkdir(path.dirname(target), {recursive: true});
          await fs.writeFile(target, entry.getData(), {flag: 'wx'});
        }
      }
      const metadata = await this.readDirectory(version, staging);
      if (metadata.revision !== manifest.revision) throw new Error('Server source revision mismatch.');
      const destination = path.join(this.directory, version);
      // A corrupt prior installation is never selected; healthy prior versions stay available for rollback.
      try { await fs.rename(staging, destination); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        try { return await this.readInstalled(version); }
        catch { await fs.rm(destination, {recursive: true, force: true}); await fs.rename(staging, destination); }
      }
      return await this.readInstalled(version);
    } finally { await fs.rm(staging, {recursive: true, force: true}); }
  }
}

module.exports = { ServerManager, validateConfig, download };
