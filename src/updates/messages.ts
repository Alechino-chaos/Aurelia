import type { UiLocale, UpdateError, UpdatePhase } from '../types';

const en = {
  closingTitle: 'Saving before closing', closingHelp: 'Please wait while your reading and changes are saved.',
  about: 'About & updates', version: 'Current version', lastCheck: 'Last checked', never: 'Never',
  autoCheck: 'Automatically check for updates', autoHelp: 'Checks at startup. Downloads and installation always require your choice.',
  check: 'Check for updates', download: 'Download update', cancel: 'Cancel download', retryCheck: 'Retry check',
  retryDownload: 'Retry download', restart: 'Restart and update', retryInstall: 'Retry restart and update',
  later: 'Later', view: 'View update', releases: 'Official releases', summary: 'Release summary', noNotes: 'No release summary provided.',
  notesHelp: 'Official release notes are shown in their original language.', newVersion: 'A new version is available', ready: 'Update ready to install',
  downloadHelp: 'You can continue reading while the update downloads.', restartHelp: 'Restart saves your reading and installs the update. You can also update later.',
  transport: 'Unable to communicate with the update service. Please retry.', retryConnection: 'Retry connection', loading: 'Loading update information…',
  unsupportedHelp: 'Automatic updates are unavailable in this portable or development copy. Install Aurelia from the official releases to receive updates.',
  preferenceRetry: 'Retry saving preference', cancelPending: 'Cancelling download…', checkingButton: 'Checking…',
  checkFailed: 'Update check did not complete.',
  savingTitle: 'Preparing to update', savingHelp: 'Complete any confirmation and wait while your reading and changes are saved.',
} as const;
type Key = keyof typeof en;
const zh: Record<Key, string> = {
  closingTitle: '正在保存并关闭', closingHelp: '请稍候，正在保存阅读记录与修改。',
  about: '关于与更新', version: '当前版本', lastCheck: '上次检查', never: '尚未检查',
  autoCheck: '启动时自动检查更新', autoHelp: '启动后检查新版本。下载和安装均由你主动选择。',
  check: '检查更新', download: '下载更新', cancel: '取消下载', retryCheck: '重试检查',
  retryDownload: '重试下载', restart: '重启并更新', retryInstall: '重试重启并更新',
  later: '稍后', view: '查看更新', releases: '官方发布页', summary: '更新摘要', noNotes: '此版本未提供更新摘要。',
  notesHelp: '官方发布说明按原始语言展示。', newVersion: '发现新版本', ready: '更新已下载，可以安装',
  downloadHelp: '下载期间可以继续阅读。', restartHelp: '重启前会保存阅读记录，然后安装更新。也可以稍后更新。',
  transport: '无法连接更新服务，请重试。', retryConnection: '重试连接', loading: '正在读取更新信息…',
  unsupportedHelp: '此便携版或开发版无法自动更新。请从官方发布页安装 Aurelia，以获取后续更新。',
  preferenceRetry: '重试保存设置', cancelPending: '正在取消下载…', checkingButton: '正在检查…',
  checkFailed: '本次更新检查未完成。',
  savingTitle: '正在准备更新', savingHelp: '请完成确认并等待阅读记录与修改保存完成。',
};
const phases: Record<UpdatePhase, [string, string]> = {
  idle: ['No check yet.', '尚未检查更新。'], checking: ['Checking for updates…', '正在检查更新…'],
  latest: ['You are up to date.', '当前已是最新版本。'], available: ['A new version is available.', '有新版本可供下载。'],
  downloading: ['Downloading update…', '正在下载更新…'], cancelled: ['Download cancelled.', '下载已取消。'],
  downloaded: ['Update downloaded.', '更新已下载。'], preparing: ['Saving your reading before updating…', '正在保存阅读记录，随后更新…'],
  error: ['Update needs your attention.', '更新遇到问题。'], unsupported: ['Updates unavailable in this copy.', '此程序暂不支持自动更新。'],
};
const errors: Record<UpdateError, [string, string]> = {
  network: ['Could not check for updates. Check your connection and retry.', '无法检查更新，请检查网络后重试。'],
  timeout: ['The update check timed out. Please retry.', '检查更新超时，请重试。'],
  'invalid-version': ['The release information is invalid. Please retry the check or visit official releases.', '版本信息无效，请重新检查或访问官方发布页。'],
  download: ['The update could not be downloaded or verified. Please retry the download.', '更新下载或校验失败，请重试下载。'],
  save: ['Your reading could not be saved. The app is still open. Retry when ready.', '阅读记录未能保存，程序仍保持打开。请重试后再更新。'],
  install: ['The installer could not start. Your downloaded update is retained. Please retry.', '安装程序未能启动，已下载的更新仍保留，请重试。'],
  preferences: ['The update preference could not be saved. Please retry.', '更新设置未能保存，请重试。'],
};
export function updateMessages(locale: UiLocale) {
  const index = locale === 'en' ? 0 : 1;
  return { text: (key: Key): string => locale === 'en' ? en[key] : zh[key],
    phase: (phase: UpdatePhase) => phases[phase][index], error: (error: UpdateError) => errors[error][index] };
}
