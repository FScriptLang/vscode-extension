const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {registerTestExplorer} = require('../test-explorer');

const disposable = () => ({dispose() {}});
function signal() {
  const callbacks = new Set();
  return {
    on(callback) { callbacks.add(callback); return {dispose: () => callbacks.delete(callback)}; },
    emit(value) { for (const callback of callbacks) callback(value); }
  };
}
function collection() {
  let items = new Map();
  return {
    get size() { return items.size; },
    get: id => items.get(id),
    add: item => items.set(item.id, item),
    forEach: callback => items.forEach(callback),
    replace: values => { items = new Map(values.map(item => [item.id, item])); }
  };
}

function fixture(t, trusted = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fscript-test-explorer-'));
  const file = path.join(directory, 'math_test.fss');
  const log = path.join(directory, 'commands.jsonl');
  const cli = path.join(directory, 'fake-cli.cjs');
  fs.writeFileSync(file, '');
  fs.writeFileSync(cli, `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
    const File = ${JSON.stringify(file)};
    const row = {Status:'discovered', Name:'table / row', File, Source:File, Line:3, Column:2};
    if (args.includes('--discover')) {
      console.log(JSON.stringify([row]));
    } else {
      const report = args[args.indexOf('--report') + 1];
      const events = args.includes('--list')
        ? [row, {...row, Name:'generated'}]
        : [{...row, Status:'failed', Line:7, Message:'Expected 3, got 4.', Input:'2'}];
      fs.writeFileSync(report, JSON.stringify(events));
      if (!args.includes('--list')) {
        console.log('console from the test');
        if (args.includes('--profile')) console.log('Test profile (wall-clock time)', 'File setup', 'Slowest cases');
        process.exitCode = 1;
      }
    }
  `);
  const uri = filename => ({scheme: 'file', fsPath: filename, toString: () => filename});
  const folder = {uri: uri(directory)};
  const profiles = new Map();
  const actions = new Map();
  const commands = new Map();
  const starts = signal();
  const results = signal();
  const ends = signal();
  const launches = [];
  const token = {isCancellationRequested: false, onCancellationRequested: disposable};
  const controller = {
    items: collection(),
    dispose() {},
    createTestItem: (id, label, uri) => ({id, label, uri, children: collection()}),
    createRunProfile: (label, kind, invoke, isDefault) => profiles.set(label, {kind, invoke, isDefault}),
    createTestRun: () => Object.fromEntries(['started', 'passed', 'failed', 'errored', 'skipped', 'appendOutput', 'end']
      .map(action => [action, (...args) => actions.set(action, args)]))
  };
  const vscode = {
    Uri: {file: uri},
    RelativePattern: class {},
    Range: class {constructor(line, column) { this.line = line; this.column = column; }},
    Position: class {constructor(line, column) { this.line = line; this.column = column; }},
    Location: class {constructor(uri, position) { this.uri = uri; this.position = position; }},
    TestMessage: class {constructor(message) { this.message = message; }},
    TestRunProfileKind: {Run: 1, Debug: 2},
    ProgressLocation: {Notification: 15},
    tests: {createTestController: () => controller},
    workspace: {
      isTrusted: trusted, workspaceFolders: [folder], textDocuments: [],
      getWorkspaceFolder: () => folder,
      findFiles: async () => [uri(file)],
      createFileSystemWatcher: () => ({dispose() {}, onDidCreate: disposable, onDidChange: disposable, onDidDelete: disposable}),
      onDidChangeWorkspaceFolders: disposable,
      onDidGrantWorkspaceTrust: disposable,
      onDidChangeConfiguration: disposable
    },
    commands: {registerCommand(name, callback) { commands.set(name, callback); return disposable(); }},
    window: {
      showErrorMessage() {},
      withProgress: (_options, task) => task({}, token)
    },
    debug: {
      onDidStartDebugSession: starts.on,
      onDidReceiveDebugSessionCustomEvent: results.on,
      onDidTerminateDebugSession: ends.on,
      async startDebugging(_folder, configuration) {
        launches.push(configuration);
        const session = {configuration};
        starts.emit(session);
        results.emit({session, event: 'fscript/testResult', body: {passed: true}});
        ends.emit(session);
        return true;
      }
    }
  };
  registerTestExplorer(vscode, {subscriptions: []}, () => ({command: process.execPath, args: [cli]}));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return {controller, file, profiles, actions, commands, launches, token, calls};
}

test('Test Explorer lists static rows, runs exact selections and starts a test debug session', async t => {
  const view = fixture(t);
  await view.controller.refreshHandler(view.token);
  const file = view.controller.items.get(view.file);
  const row = file.children.get(JSON.stringify([file.id, 'table / row']));
  assert.equal(row.range.line, 2);
  assert.ok(view.calls().length > 0);
  assert.ok(view.calls().every(args => args.includes('--discover') && !args.includes('--list')));

  await view.profiles.get('Run').invoke({include: [row]}, view.token);
  assert.ok(view.calls().at(-1).includes('--case=table / row'));
  const [failed, diagnostic] = view.actions.get('failed');
  assert.equal(failed, row);
  assert.equal(diagnostic.message, 'Expected 3, got 4.\nInput: 2');
  assert.equal(diagnostic.location.position.line, 6);

  await view.profiles.get('Debug').invoke({include: [row]}, view.token);
  assert.equal(view.launches[0].testCase, 'table / row');
  assert.equal(view.actions.get('passed')[0], row);
  assert.ok(view.actions.has('end'));

  await view.commands.get('fscript.discoverGeneratedTests')();
  assert.ok(view.calls().at(-1).includes('--list'));
  assert.ok(file.children.get(JSON.stringify([file.id, 'generated'])));
});

test('Run with Profiling adds timing output to the selected test run', async t => {
  const view = fixture(t);
  await view.controller.refreshHandler(view.token);
  const file = view.controller.items.get(view.file);
  const row = file.children.get(JSON.stringify([file.id, 'table / row']));
  const request = {include: [row]};

  const ordinary = view.profiles.get('Run');
  assert.equal(ordinary.isDefault, true);
  await ordinary.invoke(request, view.token);
  assert.ok(!view.calls().at(-1).includes('--profile'));
  assert.equal(view.actions.get('appendOutput')[0], 'console from the test\r\n');

  const profiled = view.profiles.get('Run with Profiling');
  assert.equal(profiled.kind, ordinary.kind);
  assert.equal(profiled.isDefault, false);
  await profiled.invoke(request, view.token);
  assert.ok(view.calls().at(-1).includes('--case=table / row'));
  assert.ok(view.calls().at(-1).includes('--profile'));
  assert.deepEqual(view.actions.get('appendOutput'), [
    'console from the test\r\nTest profile (wall-clock time) File setup Slowest cases\r\n', undefined, row
  ]);
  assert.equal(view.actions.get('failed')[0], row);
  assert.ok(view.actions.has('end'));
});

test('Restricted Mode shows test files without invoking the CLI', async t => {
  const view = fixture(t, false);
  await view.controller.refreshHandler(view.token);
  const file = view.controller.items.get(view.file);
  assert.ok(file);
  await view.commands.get('fscript.discoverGeneratedTests')();
  await view.profiles.get('Run').invoke({include: [file]}, view.token);
  assert.deepEqual(view.calls(), []);
});
