# Full-text Search Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 搜索当前论文的文字并准确定位，保留既有阅读交互。
**Architecture:** 共享文本缓存，纯函数构建带偏移映射的搜索索引，React hook 管理异步搜索与导航，独立覆盖层显示匹配。
**Tech Stack:** TypeScript, React, PDF.js, Vitest, Electron/Playwright；不新增依赖。
**Spec:** ../specs/2026-10-12-full-text-search.md

## Global Constraints

- 200 ms 输入防抖；IME 期间不搜索/导航；不做 NFKC。
- 仅当前 PDF，内存缓存；遵守 autoColumns 模式；结果上限 10000 并明确提示。
- 保留文本 DOM 和选择复制；独立 pointer-events:none 高亮。
- 用户要求直接改动，当前工作区实施，不额外等待设计/计划审批，不自动提交。

## Review Focus

- 连字和 Unicode 大小写展开后的真实字符偏移：算法范围断言。
- 尚未渲染页导航：桌面末页搜索测试。
- 输入/换文档和迟到提取：取消测试与桌面文档切换。
- 搜索与选区、缩放、批注共存：桌面回归及矩形断言。
- 提取失败与大量匹配：缓存重试、部分结果和截断测试。

## Task 1: 文本缓存与搜索算法

Files: src/pdf/documentText.ts, src/pdf/search.ts, tests/search.test.ts, tests/documentText.test.ts.
Interfaces: getPageText(pdf, page, autoColumns) returns ordered text; buildSearchIndex(entries, options), findMatches(index, query, page, limit) return source item ranges.

- [x] 编写并运行失败的算法/缓存测试。
- [x] 实现文本缓存、归一化及偏移映射、段落边界和匹配限额。
- [x] 运行 npm test，确认全量通过。

## Task 2: 搜索交互与页面高亮

Files: src/search/usePdfSearch.ts, src/components/SearchBar.tsx, src/components/SearchHighlights.tsx, src/App.tsx, src/components/PdfPage.tsx, src/styles.css, tests/e2e/search.spec.ts.
Interfaces: hook consumes PDF and order mode; returns per-page matches and a navigation request. SearchHighlights consumes matches, text divs, active ID, navigation request, scale and scroll root.

- [x] 编写桌面行为测试，先验证搜索入口缺失的失败。
- [x] 实现异步分批搜索、失效处理、进度及导航。
- [x] 接入搜索栏、共享文本缓存和独立高亮，处理快捷键和 IME。
- [x] typecheck、build、search.spec.ts；修正实际失败。

## Task 3: 回归和交付

Files: docs/reading-guide.md, README.md, implementation ledger.

- [x] 完成失败、取消、限额及布局边界测试。
- [x] 更新使用指南。
- [x] 运行全量单测、typecheck、build、桌面回归；审查 diff 和截图。
- [x] 独立最终审查，修正重要问题并验证。

## Execution ledger

- Ruling: 依用户“确认，直接开始改动吧”在当前干净工作区持续执行；不再插入审批，不做提交/发布。
- Pre-flight: Task 2 使用 Task 1 的同一 ordered entries 和源字符范围，避免搜索顺序与 DOM 顺序不一致。
- Task 1: complete — 首次 search/searchScan 单测运行因模块尚不存在失败；实现后全量 50/50 单测通过（2026-10-13）。
- Task 2: complete — 首次桌面测试因搜索入口尚不存在失败；实现后 5/5 搜索桌面测试通过，typecheck/build 通过。
- 验证修正：关闭搜索栏后可视区变高，文档底部 scrollTop 被浏览器约束到新最大值；窄窗口测试据此验证合法位置，而不是要求保留越界偏移。
- Final review: 独立只读 reviewer（gpt-6-astra）未发现 Critical/Important 问题。
- Final: minor (deferred): 索引进度更新会重建分页匹配数组，可能引发可见页重复 Range 测量；未观察到确定卡顿，后续保留未变化数组引用优化。
- Final: minor (deferred): Unicode 展开字符已有映射单测，但真实 PDF 的 DOM 矩形断言仍使用 ASCII；后续补专门字形 fixture。
- Final: Ruling: OCR/跨文档/正则/跨页短语按已确认范围排除；代价是这些查询仍不可用。
- Final: Ruling: 复用现有 orderText 推断栏和段落；复杂版式的识别准确率不在本次改动中扩大承诺，可能影响搜索结果。
- Final: Ruling: reviewer 只读审查，UI 和完整 Electron 回归由主代理实测；测试覆盖范围外仍需后续真实使用反馈。
- Task 3: complete — 最终 typecheck 通过，单测 50/50，完整 Electron E2E 38/38（含 5 项搜索测试），build 成功，git diff --check 无错误；已查看搜索与批注共存截图。构建仍有原有大 chunk 提示。
- Initial delivery: 改动保留当前工作区，不提交、不发布；当时未更新独立安装副本。
- Local release (2026-10-13): 按用户后续要求发布本机 0.5.0，完成便携包构建、本机安装和桌面快捷方式更新；已核对安装版本、快捷方式目标及 app.asar 哈希一致，安装版冒烟测试通过，单测 50/50、安装版完整 Electron E2E 38/38。
- Release verification: 修正桌面测试打开文件时的等待条件，先确认目标文件名再等待页面就绪，避免误用上一个文档的就绪状态；打包冒烟测试统一设备缩放并等待搜索结束。
- Repository cleanup: 清理临时测试目录、测试结果和旧便携包，共约 628.7 MiB；保留当前版本安装包、校验值和验证记录，均由 Git 忽略。后续完整更新规则写入根目录 AGENTS.md，未执行 Git 提交或推送。
