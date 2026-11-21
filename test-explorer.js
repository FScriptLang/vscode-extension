const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {execFile} = require('node:child_process');

function invoke(cli, args, cwd, token) {
  return new Promise(resolve => {
    const abort = new AbortController();
    const cancellation = token?.onCancellationRequested(() => abort.abort());
    if (token?.isCancellationRequested) abort.abort();
    execFile(cli.command, [...cli.args, 'test', ...args], {
      cwd, signal: abort.signal, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      ...(args.includes('--discover') ? {timeout: 10000} : {})
    }, (error, stdout, stderr) => {
      cancellation?.dispose();
      resolve({error, stdout, stderr});
    });
  });
}

async function withReport(cli, args, cwd, token) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fscript-tests-'));
  try {
    const report = path.join(temporary, 'results.json');
    const result = await invoke(cli, [...args, '--report', report], cwd, token);
    let events = [];
    try { events = JSON.parse(await fs.readFile(report, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return {...result, events};
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }
}

function registerTestExplorer(vscode, context, cliFor) {
  if (!vscode.tests?.createTestController) return;
  const controller = vscode.tests.createTestController('fscript', 'FScript');
  context.subscriptions.push(controller);
  const metadata = new WeakMap();
  let discovery = Promise.resolve();
  const trusted = () => vscode.workspace.isTrusted === true;
  const fileArguments = (file, folder) => ['--file', path.relative(folder.uri.fsPath, file.uri.fsPath)];
  const children = collection => {
    const items = [];
    collection.forEach(item => items.push(item));
    return items;
  };

  function updateCases(file, events, replace, staticLocations = false) {
    const cases = [];
    for (const event of events) {
      if (event.Status === 'error') {
        file.error = event.Message;
        continue;
      }
      if (!event.Name) continue;
      const id = JSON.stringify([file.id, event.Name]);
      const item = file.children.get(id) || controller.createTestItem(id, event.Name, file.uri);
      metadata.set(item, {...metadata.get(file), name: event.Name, file});
      if (event.Line > 0 && event.Source === event.File && (!item.range || staticLocations)) {
        const line = event.Line - 1;
        const column = Math.max(0, event.Column - 1);
        item.range = new vscode.Range(line, column, line, column + 1);
      }
      cases.push(item);
      if (!replace) file.children.add(item);
    }
    if (replace) file.children.replace([...new Map(cases.map(item => [item.id, item])).values()]);
  }

  async function readTests(token) {
    const files = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*_test.fss'),
        '**/{node_modules,.git,.fscript}/**', undefined, token);
      for (const uri of uris) {
        if (uri.scheme !== 'file' || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== folder.uri.toString()) continue;
        const id = uri.toString();
        const item = controller.items.get(id) || controller.createTestItem(id, path.relative(folder.uri.fsPath, uri.fsPath), uri);
        metadata.set(item, {folder, file: item});
        files.push(item);
      }
    }
    if (token?.isCancellationRequested) return;
    controller.items.replace(files);
    if (!trusted()) return;
    for (const file of files) {
      if (token?.isCancellationRequested) return;
      const {folder} = metadata.get(file);
      const result = await invoke(cliFor(file.uri, folder), ['--discover', ...fileArguments(file, folder)], folder.uri.fsPath, token);
      if (token?.isCancellationRequested) return;
      if (result.error) {
        file.error = 'Static discovery requires an FScript CLI with Test Explorer support.';
        continue;
      }
      try {
        file.error = undefined;
        updateCases(file, JSON.parse(result.stdout), true, true);
      } catch (error) {
        file.error = `Could not read FScript test discovery: ${error.message}`;
      }
    }
  }

  function refresh(token) {
    discovery = discovery.catch(() => {}).then(() => readTests(token));
    return discovery;
  }

  async function enumerate(file, token) {
    const {folder} = metadata.get(file);
    const result = await withReport(cliFor(file.uri, folder), [...fileArguments(file, folder), '--list'], folder.uri.fsPath, token);
    if (token?.isCancellationRequested) return;
    file.error = undefined;
    updateCases(file, result.events, !result.error);
    if (result.error && !file.error) file.error = result.stderr.trim() || result.error.message;
  }

  controller.resolveHandler = item => item ? undefined : refresh();
  controller.refreshHandler = token => refresh(token);
  context.subscriptions.push(vscode.commands.registerCommand('fscript.discoverGeneratedTests', async () => {
    if (!trusted()) {
      vscode.window.showErrorMessage('FScript: trust this workspace before discovering generated tests.');
      return;
    }
    await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: 'Discover FScript tests', cancellable: true},
      async (_progress, token) => {
        if (!controller.items.size) await refresh(token);
        for (const file of children(controller.items)) {
          if (token.isCancellationRequested) break;
          try {
            await saveWorkspace(metadata.get(file).folder);
            await enumerate(file, token);
          } catch (error) {
            file.error = error.message;
          }
        }
      });
  }));

  function message(text, source, line, column) {
    const result = new vscode.TestMessage(text);
    if (source && line > 0) {
      const col = Math.max(0, (column || 1) - 1);
      result.location = new vscode.Location(vscode.Uri.file(source), new vscode.Position(line - 1, col));
    }
    return result;
  }

  async function saveWorkspace(folder) {
    for (const document of vscode.workspace.textDocuments) {
      if (document.isDirty && document.languageId === 'fscript' &&
          vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === folder.uri.toString() &&
          !await document.save()) throw new Error('Save FScript changes before running tests.');
    }
  }

  async function runItem(item, run, token, profile = false) {
    const {folder, file, name} = metadata.get(item);
    const args = fileArguments(file, folder);
    if (name !== undefined) args.push(`--case=${name}`);
    if (profile) args.push('--profile');
    run.started(item);
    const result = await withReport(cliFor(file.uri, folder), args, folder.uri.fsPath, token);
    file.error = undefined;
    if (token.isCancellationRequested) { run.skipped(item); return; }
    if (result.stdout) run.appendOutput(result.stdout.replace(/\r?\n/g, '\r\n'), undefined, item);
    updateCases(file, result.events, false);
    let failed = false;
    for (const event of result.events) {
      const test = event.Name ? file.children.get(JSON.stringify([file.id, event.Name])) : file;
      if (event.Status === 'passed') run.passed(test);
      if (event.Status === 'failed' || event.Status === 'error') {
        failed = true;
        const description = event.Input ? `${event.Message}\nInput: ${event.Input}` : event.Message;
        const diagnostic = message(description, event.Source === event.File ? file.uri.fsPath : event.Source, event.Line, event.Column);
        if (event.Status === 'error') run.errored(item, diagnostic);
        else run.failed(test, diagnostic);
      }
    }
    if (result.error && !failed) {
      run.errored(item, message(result.stderr.trim() || result.error.message));
    } else if (item === file && !failed) {
      run.passed(file);
    } else if (item === file && failed && result.events.some(event => event.Status === 'failed')) {
      run.failed(file, message('One or more test cases failed.'));
    }
  }

  async function debugItem(item, run, token) {
    const {folder, file, name} = metadata.get(item);
    if (name === undefined) {
      await enumerate(file, token);
      const tests = children(file.children);
      if (!tests.length && !token.isCancellationRequested) run.errored(item, message(file.error || 'No test cases were discovered.'));
      for (const test of tests) {
        if (token.isCancellationRequested) break;
        await debugItem(test, run, token);
      }
      return;
    }
    run.started(item);
    const id = randomUUID();
    await new Promise(resolve => {
      let session;
      let resultReceived = false;
      const owns = candidate => candidate.configuration.fscriptTestRunId === id;
      const stop = () => { if (session) void Promise.resolve(vscode.debug.stopDebugging(session)).catch(() => {}); };
      const subscriptions = [
        vscode.debug.onDidStartDebugSession(candidate => {
          if (!owns(candidate)) return;
          session = candidate;
          if (token.isCancellationRequested) stop();
        }),
        vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
          if (!owns(event.session) || event.event !== 'fscript/testResult') return;
          resultReceived = true;
          const result = event.body;
          if (result.passed) run.passed(item);
          else run.failed(item, message(result.message, result.source, result.line, result.column));
        }),
        vscode.debug.onDidTerminateDebugSession(candidate => {
          if (!owns(candidate)) return;
          if (!resultReceived) {
            if (token.isCancellationRequested) run.skipped(item);
            else run.errored(item, message('The debug session ended before reporting a test result.'));
          }
          finish();
        }),
        token.onCancellationRequested(stop)
      ];
      function finish() {
        for (const subscription of subscriptions) subscription.dispose();
        resolve();
      }
      void vscode.debug.startDebugging(folder, {
        type: 'fscript', request: 'launch', name: `Debug ${name}`, program: file.uri.fsPath,
        testCase: name, fscriptTestRunId: id
      }).then(started => {
        if (started || resultReceived) return;
        run.errored(item, message('FScript could not start the test debugger.'));
        finish();
      }, error => {
        run.errored(item, message(error.message));
        finish();
      });
    });
  }

  function handler(execute) {
    return async (request, token) => {
      const run = controller.createTestRun(request);
      try {
        if (!trusted()) {
          vscode.window.showErrorMessage('FScript: trust this workspace before running tests.');
          return;
        }
        if (!controller.items.size) await refresh(token);
        const excluded = new Set((request.exclude || []).map(item => item.id));
        const saved = new Set();
        for (const item of request.include || children(controller.items)) {
          if (token.isCancellationRequested) break;
          const data = metadata.get(item);
          if (!data || excluded.has(item.id) || excluded.has(data.file.id)) continue;
          try {
            if (!saved.has(data.folder)) {
              await saveWorkspace(data.folder);
              saved.add(data.folder);
            }
            const fileHasExclusions = item === data.file && children(item.children).some(test => excluded.has(test.id));
            if (fileHasExclusions) await enumerate(item, token);
            const targets = fileHasExclusions ? children(item.children).filter(test => !excluded.has(test.id)) : [item];
            for (const target of targets) {
              if (token.isCancellationRequested) break;
              await execute(target, run, token);
            }
          } catch (error) {
            run.errored(item, message(error.message));
          }
        }
      } finally {
        run.end();
      }
    };
  }
  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, handler(runItem), true);
  controller.createRunProfile('Run with Profiling', vscode.TestRunProfileKind.Run,
    handler((item, run, token) => runItem(item, run, token, true)), false);
  controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, handler(debugItem), true);
  const watcher = vscode.workspace.createFileSystemWatcher('**/*_test.fss');
  const update = () => { void refresh().catch(error => console.warn('FScript test discovery:', error.message)); };
  context.subscriptions.push(watcher, watcher.onDidCreate(update), watcher.onDidChange(update), watcher.onDidDelete(update),
    vscode.workspace.onDidChangeWorkspaceFolders(update), vscode.workspace.onDidGrantWorkspaceTrust(update),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('fscript.cli.path')) update(); }));
  update();
}

module.exports = {registerTestExplorer};
