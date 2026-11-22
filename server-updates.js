const path = require('node:path');
const { ServerManager } = require('./server-manager');

function createServerController({ vscode, context, config, log = () => {}, manager }) {
  const pinnedVersion = (vscode.workspace.getConfiguration('fscript').get('server.version', '') || '').trim();
  manager ||= new ServerManager({directory: path.join(context.globalStorageUri.fsPath, 'language-servers'), config, pinnedVersion});
  let resolving;
  let checking;
  let disposed = false;
  const dispose = () => { disposed = true; };
  context.subscriptions.push({dispose});
  const resolve = () => resolving ||= manager.resolve().catch(error => { resolving = undefined; throw error; });
  async function check(manual = false) {
    if (checking) return checking;
    checking = (async () => {
      let reportErrors = manual;
      try {
        const current = await resolve();
        // A manual check refreshes an earlier startup query.
        if (manual) manager.releaseQuery = undefined;
        const update = await manager.checkForUpdates(current);
        if (disposed) return;
        if (update.extensionUpdate) {
          const action = await vscode.window.showInformationMessage(
            `FScript language server ${update.extensionUpdate} is available and requires a newer extension.`, 'Update Extension');
          if (action === 'Update Extension' && !disposed) {
            await vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', ['MagnusOpera.fscript']);
          }
        }
        if (update.serverUpdate && !disposed) {
          const action = await vscode.window.showInformationMessage(
            `FScript language server ${update.serverUpdate} is available (installed: ${current.version}).`, 'Update Language Server');
          if (action === 'Update Language Server' && !disposed) {
            reportErrors = true;
            await manager.install(update.serverUpdate);
            if (disposed) return;
            const restart = await vscode.window.showInformationMessage('FScript language server updated. Reload the window to use it.', 'Reload Window');
            if (restart === 'Reload Window' && !disposed) await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        } else if (manual && !update.extensionUpdate && !disposed) {
          await vscode.window.showInformationMessage(pinnedVersion
            ? `FScript language server is pinned to ${pinnedVersion}. Clear fscript.server.version to receive server upgrades.`
            : 'FScript language server is up to date.');
        }
      } catch (error) {
        log(`Language-server update check: ${error.message}`);
        if (reportErrors && !disposed) await vscode.window.showWarningMessage(`FScript: ${error.message}`);
      }
    })().finally(() => { checking = undefined; });
    return checking;
  }
  return { resolve, check, dispose };
}

module.exports = { createServerController };
