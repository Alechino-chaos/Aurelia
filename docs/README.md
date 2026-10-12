# Aurelia 目录说明

## 源码仓库

| 位置 | 用途 |
| --- | --- |
| `src/` | React 界面、PDF 渲染、文本选择及 AI 面板 |
| `electron/` | 桌面主进程、隔离接口、AI 请求和本地会话 |
| `public/branding/` | 应用图标及生成说明 |
| `public/examples/` | 自行生成的双栏 PDF 示例 |
| `scripts/` | 开发、构建、打包、安装和验证脚本 |
| `tests/` | 单元与 Electron 端到端测试 |
| `docs/` | 维护说明和安全检查记录 |
| `package.json`、`package-lock.json` | 项目命令与锁定依赖 |
| 根目录其他配置文件 | TypeScript、Vite、Vitest、Playwright 与 Git 配置 |
| `如何启动.txt` | 已安装用户的启动及操作说明 |

## 本地保留、不提交

以下内容已由 `.gitignore` 排除，克隆源码时不会自带。

| 位置 | 用途与恢复方式 |
| --- | --- |
| `node_modules/` | 依赖；运行 `npm ci` 安装 |
| `public/pdf-assets/` | PDF.js 离线资源；开发或构建时自动复制 |
| `dist/`、`dist-electron/` | 生产构建；运行 `npm run build` 生成 |
| `release/` | 打包输出；运行 `npm run dist` 生成。便携包可上传至 GitHub Releases |
| `tmp/`、`test-results/`、`playwright-report/` | 临时配置与测试结果；按需生成 |
| `designs/` | 本地设计方案、历史截图和验收资料，可能含论文摘录 |
| `tests/fixtures/references/*.pdf` | 可选的外部论文测试样本，获取方式见该目录 README |
| `*.local.json` | 本机安装记录和 Electron 运行时路径 |

本次清理移除了旧构建、解包副本和测试输出；保留本机依赖、最新便携包和历史设计资料。根目录原 `design-qa.md` 已归档至 `designs/annotations/design-qa.md`。

## 已安装程序与个人记录

桌面 `Aurelia.lnk` 指向独立安装的程序，实际位置记录在 `.aurelia-install.local.json`。默认目录为 `%LOCALAPPDATA%\Programs\Aurelia\`，可用安装脚本的 `-ApplicationRoot` 参数指定其他磁盘；后续更新沿用已记录的位置。清理工作区构建产物不会影响此程序。

个人 API 设置、最近文件及阅读会话在 `%APPDATA%\paperdesk\`，不属于源码仓库。请勿将此目录复制进项目或上传。根目录 `*.local.json` 继续保留供本机脚本使用。

开发命令见 [项目 README](../README.md)，提交步骤见 [GitHub 提交说明](github-publishing.md)。
