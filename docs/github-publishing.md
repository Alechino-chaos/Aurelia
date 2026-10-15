# 上传 GitHub

提交源码、图标、内置合成示例、测试、文档和锁文件。依赖、构建产物、安装记录、API 配置、个人论文及设计截图由 `.gitignore` 排除；请勿使用 `git add -f` 强行加入这些文件。

## 首次提交

在项目根目录执行。若是全新副本且没有 `.git`，先运行 `git init -b main`。

```powershell
git status --short
git add .
git diff --cached --stat
git diff --cached
git commit -m "Initial Aurelia source"
```

在 GitHub 创建一个空仓库，将下面的 `YOUR_NAME` 与 `YOUR_REPOSITORY` 换成实际名称后执行：

```powershell
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

本次整理只准备本地仓库，没有替你创建远程仓库、提交或推送。首次提交前可在本机配置自己的 Git 用户名和邮箱；认证信息不要写入远程 URL 或项目文件。

## 从源码运行

需要 Node.js 22.13+ 和 npm。安装和首次打包需要网络下载依赖及构建工具。

```powershell
npm ci
npm run dev
```

生产构建、测试与打包：

```powershell
npm run build
npm test
npm run test:e2e
npm run dist
```

`public/pdf-assets/` 在开发和构建时自动生成；仓库包含内置合成 PDF 示例。可选真实论文样本不在仓库中，缺少时对应测试会跳过。

## 发布程序

1.0.0 起公开分发 Windows 安装版。将同一次 `npm run dist` 生成的 `Aurelia-<version>-setup.exe`、`latest.yml` 和 `Aurelia-<version>-setup.exe.blockmap` 上传至 GitHub Release 草稿，核对版本、附件和目标提交后再发布为正式版本。标题和说明统一使用英文，不额外上传 `.sha256` 文件或加入手工校验说明。自动更新需要后两个文件；用户首次安装只需运行 setup 程序。

每次版本更新在打包完成后运行 `./scripts/install-local.ps1`，同步更新本机程序和桌面快捷方式，并验证实际运行版本与打包文件一致。旧便携版用户先手动安装一次，之后可在软件里检查更新、手动下载并点击重启更新。源码、版本标签和 Release 是独立对象；删除旧 Release 不要求删除对应标签或提交历史。

## 已有仓库的日常更新

先检查 `git status --short` 和 `git diff --check`，审阅本次源码、测试与文档改动，再自行提交和推送。不要把 `release/`、`tmp/`、`test-results/`、个人 PDF、API 配置或 `*.local.json` 加入 Git。

版本变化见根目录 `CHANGELOG.md`，本机交付约定见 `AGENTS.md`。历史安全审查保留原版本号，不能视为新版本重新完成的安全审查。

仓库尚未指定开源许可证。若计划允许他人修改、再分发，请由项目所有者选择许可证后添加 `LICENSE`。
