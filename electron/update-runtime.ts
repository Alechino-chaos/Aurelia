import { app } from 'electron';
import updaterPackage from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { UpdateDriver } from './update-service.js';
import { PRODUCTION_INSTALL_GUID, TEST_INSTALL_GUID, testFeed, isolatedUpdateTestProfile } from './update-policy.js';
const { NsisUpdater, CancellationToken } = updaterPackage;
const execute = promisify(execFile);

export function isUpdateTestBuild(): boolean {
  try { return app.isPackaged && JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).aureliaUpdateTest === true; }
  catch { return false; }
}
/** Test binaries have a separate registry identity and profile; production ignores these variables. */
export function preserveUpdateTestProfile(): void {
  if (!isUpdateTestBuild()) return;
  const commandProfile = app.commandLine.getSwitchValue('user-data-dir');
  const profile = isolatedUpdateTestProfile(app.getPath('exe'), commandProfile, process.env.AURELIA_UPDATE_TEST_PROFILE);
  app.setPath('userData', profile);
  process.env.AURELIA_UPDATE_TEST_PROFILE = profile;
}
export async function registeredInstallDirectory(testBuild: boolean): Promise<string | undefined> {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;
  const guid = testBuild ? TEST_INSTALL_GUID : PRODUCTION_INSTALL_GUID;
  try {
    // reg.exe emits the machine's legacy console codepage. Read .NET Unicode
    // values and explicitly emit UTF-8 JSON so Chinese paths survive any locale.
    // The script contains only fixed application registry keys, never renderer input.
    const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
$install = $null
$uninstall = $null
try {
  $install = $base.OpenSubKey('Software\\${guid}')
  $uninstall = $base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}')
  if ($null -eq $install -or $null -eq $uninstall) { exit 1 }
  [Console]::WriteLine((@{ InstallLocation = $install.GetValue('InstallLocation'); UninstallString = $uninstall.GetValue('UninstallString') } | ConvertTo-Json -Compress))
} finally {
  if ($null -ne $install) { $install.Dispose() }
  if ($null -ne $uninstall) { $uninstall.Dispose() }
  $base.Dispose()
}`;
    const registryReader = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await execute(registryReader, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024 });
    const registry: unknown = JSON.parse(stdout);
    if (!registry || typeof registry !== 'object') return;
    const { InstallLocation: location, UninstallString: uninstall } = registry as Record<string, unknown>;
    if (typeof location !== 'string' || !path.isAbsolute(location) || typeof uninstall !== 'string') return;
    const executable = app.getPath('exe');
    if (path.basename(executable).toLowerCase() !== 'aurelia.exe') return;
    const directory = await realpath(location);
    if ((await realpath(path.dirname(executable))).toLowerCase() !== directory.toLowerCase()) return;
    const uninstaller = /^"([^"]+)"(?:\s|$)/.exec(uninstall)?.[1];
    if (!uninstaller || (await realpath(path.dirname(uninstaller))).toLowerCase() !== directory.toLowerCase()) return;
    if (!(await stat(uninstaller)).isFile()) return;
    // Electron's patched fs presents an ASAR archive as a virtual directory.
    // Eligibility requires the underlying physical archive file, not that view.
    const physicalFs = await import('original-fs');
    if (!(await physicalFs.promises.stat(path.join(directory, 'resources', 'app.asar'))).isFile()) return;
    return directory;
  } catch { return; }
}

/** Native updater normally starts the installer before asynchronous close handlers can save.
 * This adapter starts only after the coordinator has saved and awaits the spawn result.
 */
class CoordinatedNsisUpdater extends NsisUpdater {
  private launch?: Promise<boolean>;
  protected override doInstall(_options: { isSilent: boolean; isForceRunAfter: boolean; isAdminRightsRequired: boolean }): boolean {
    if (!this.installerPath || !this.installDirectory) return false;
    this.launch = this.spawnLog(this.installerPath, ['--updated', '/S', '--force-run', `/D=${this.installDirectory}`]);
    return true;
  }
  async launchInstaller(): Promise<void> {
    try { if (!this.install(true, true) || !this.launch || !await this.launch) throw new Error('Installer did not start'); }
    catch (error) { this.quitAndInstallCalled = false; throw error; }
  }
}
export function createUpdateDriver(options: { installDirectory: string; testBuild: boolean; onInstallStarted(): void }): UpdateDriver {
  let updater: CoordinatedNsisUpdater | undefined;
  let updateInfo: UpdateInfo | undefined;
  let downloadedFile: string | undefined;
  const initialize = () => {
    const feed = testFeed(options.testBuild, process.env.AURELIA_UPDATE_TEST_URL);
    const instance = new CoordinatedNsisUpdater(feed ? { provider: 'generic', url: feed, channel: 'latest' }
      : { provider: 'github', owner: 'Alechino-chaos', repo: 'Aurelia', private: false, releaseType: 'release' });
    instance.autoDownload = false; instance.autoInstallOnAppQuit = false; instance.allowPrerelease = false; instance.allowDowngrade = false;
    instance.disableWebInstaller = true; instance.installDirectory = options.installDirectory; instance.logger = null;
    // Provider promises still carry errors; avoid an unhandled EventEmitter error and external-body logging.
    instance.on('error', () => {});
    return instance;
  };
  return {
    async check() {
      // A timed-out previous check cannot replace the updater selected for a new operation.
      const candidate = initialize(); updater = candidate; updateInfo = undefined; downloadedFile = undefined;
      const result = await candidate.checkForUpdates();
      if (!result) throw new Error('No update response');
      if (updater === candidate) updateInfo = result.updateInfo;
      const notes = result.updateInfo.releaseNotes;
      return { version: result.updateInfo.version, releaseNotes: typeof notes === 'string' ? notes : notes?.map(note => `${note.version}\n${note.note}`).join('\n\n') };
    },
    download(progress) {
      if (!updater || !updateInfo) throw new Error('Check required');
      const candidate = updater, token = new CancellationToken();
      candidate.on('download-progress', progress);
      const promise = candidate.downloadUpdate(token).then(files => {
        if (!token.cancelled && updater === candidate) downloadedFile = files[0];
      }).finally(() => candidate.removeListener('download-progress', progress));
      return { promise, cancel: () => token.cancel() };
    },
    async validateDownloaded() {
      if (!downloadedFile || !updateInfo || !updater) throw new Error('No downloaded installer');
      const installers = updateInfo.files.filter(file => /\.exe(?:$|\?)/i.test(file.url));
      const metadata = installers.find(file => path.basename(new URL(file.url, 'https://updates.invalid/').pathname) === path.basename(downloadedFile!))
        ?? (installers.length === 1 ? installers[0] : undefined);
      if (!metadata?.sha512 || !(await stat(downloadedFile)).isFile()) throw new Error('Invalid installer');
      const hash = createHash('sha512');
      for await (const chunk of createReadStream(downloadedFile)) hash.update(chunk);
      if (hash.digest('base64') !== metadata.sha512) throw new Error('Installer checksum changed');
      // Reconfirm the current executable still belongs to this registered installation.
      if (await registeredInstallDirectory(options.testBuild) !== options.installDirectory) throw new Error('Installation registration changed');
    },
    async install() {
      if (!updater) throw new Error('No updater');
      await updater.launchInstaller(); options.onInstallStarted(); app.quit();
    },
  };
}
