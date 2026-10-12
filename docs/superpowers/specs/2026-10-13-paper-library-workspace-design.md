# Paper Library and Restorable Reading Workspace

Status: requirements gathered; written design for user review. No implementation has started. Proposed version: 0.7.0.

## 需求与方案速读

### 已确认

- 软件管理用户主动导入的论文，不扫描整个电脑文件夹。
- 左侧按用户自己命名的分组展示论文；分组是软件内的分类，不移动原 PDF。
- 每篇论文要能看出实际所在文件夹。
- 用户可以选择左侧文件树模式或顶部标签模式。
- 顶部只显示当前打开的论文；关闭标签不从论文库移除论文。
- 分组和论文库长期保存；重启后恢复上次打开的标签和当前阅读的论文。

### 推荐的完整体验

1. 点击“导入论文”选择一个或多个 PDF；选中某个分组时导入到该组，否则进入“未分组”。普通“打开 PDF”也会加入论文库并打开阅读。
2. 新建和重命名分组；拖动论文到其他组，或用菜单“移动到分组”。第一版分组只有一层。
3. 文件名下面显示实际父文件夹；悬停查看完整路径；菜单提供“在文件夹中显示”。文件名相同的两篇论文可通过路径区分。
4. 点击论文开始阅读，已打开的论文直接切换过去；每篇记住阅读位置、缩放和右侧面板状态。
5. “文件树模式”显示左侧论文库，标记当前论文及已经打开的论文；“标签模式”显示顶部打开项，左侧收起，可用“论文库”按钮临时打开列表。切换模式不关闭论文，软件记住选择。
6. 关闭论文只关闭阅读项；移出论文库只删除软件中的条目；删除分组会把论文移回“未分组”。这些操作都不删除磁盘 PDF 或已有阅读笔记。
7. 重启后先恢复列表，再加载上次正在看的那篇；其他标签在点击时加载，避免启动时同时读取大量 PDF。
8. 文件找不到时保留条目，提供“重新定位”；恢复失败不会让整份论文库消失。

### 技术方案的大白话

React 负责文件树和标签栏；Electron 负责打开文件、显示所在文件夹；一个本机 JSON 文件保存“论文目录册”和上次的阅读工作区。PDF 仍保留原处，原有批注仍使用现有存储。无需服务器、账号或新数据库。

这项比 Markdown 导出更大：需要把当前“只记住一篇论文”的界面状态改成“每篇各有自己的阅读状态”。真正要保证的是切来切去不丢位置、不串笔记，以及重启恢复可靠。

### 第一版的推荐边界

不增加左右分屏、嵌套分组、标签分类、文件夹自动扫描或云同步。AI 生成沿用当前规则：切换论文时停止当前请求，保存已收到的内容；切回或重启不会自动调用 AI。搜索词在本次打开的论文之间分别保留，重启后不恢复搜索内容。

## Intent and scope

Primary goal: remove repeated manual file opening when reading several papers. User-selected virtual groups organize explicitly imported files, with visible real locations. Sidebar and tab navigation are interchangeable presentations of one library/workspace model, not independent copies.

First release targets the existing Windows desktop application. Keep existing Chinese UI, PDF.js rendering, local-only ordinary reading, optional user-configured AI, and Markdown export. No new runtime dependencies or changes to reading-session JSON schema. Public changelog/release information remains English.

## Navigation and interaction

- Default to sidebar mode on first use. Persist `sidebar` or `tabs`; do not persist a transient library drawer being open.
- Sidebar shows one-level collapsible groups plus a built-in `未分组` group. Users can create, rename and delete their groups. Names are trimmed, nonempty, at most 80 characters, and unique case-insensitively; reserve the built-in group name.
- Each paper belongs to one group. Dragging changes membership, never the PDF path. Provide a keyboard-accessible move menu as an alternative. Group sorting/reordering and multiple membership are out of scope.
- Display the PDF basename and a second line with its actual parent path. Long paths use visual ellipsis with the full path available as a tooltip. Current and open state must have accessible text, not only color.
- Clicking a closed library entry opens it in a new reading tab; clicking an already-open entry focuses that tab. Repeated opening of the same canonical Windows path does not duplicate entries or tabs. Different paths can coexist even when names match.
- Top tabs display only open entries, ordered by opening time. Each has a close action. Overflow scrolls horizontally; activating a tab makes it visible. Tab reordering is out of scope for this release.
- In sidebar mode, open entries expose a close action. Closing the active item selects the adjacent item (right neighbor, otherwise left). Closing the last item shows the existing welcome view with the library still accessible.
- Tabs mode has a `论文库` button that opens the same grouped list in a temporary drawer. Selecting a paper closes the drawer and activates its tab. The drawer supports the same group/import actions.
- Preserve existing per-document page-number navigation separately from library navigation; distinguish their controls and accessible labels. In sidebar mode the left area can switch between library and page-number views without losing either state. No new outline tree is implied.
- Add Ctrl+Tab and Ctrl+Shift+Tab for cycling open documents and Ctrl+W for closing the active document. Ctrl+O remains opening a PDF. Do not interfere with IME composition or existing PDF/search shortcuts.
- Sidebar width and mode are workspace settings. On narrow windows, constrain panel widths to keep the reader usable and allow either side panel to collapse; do not replace the reader with horizontal page-wide UI overflow.

## Import, identity and file locations

- `导入论文` supports multiple files from the system picker; files are validated individually. Batch import adds valid files to the chosen group and reports failed filenames without discarding successes. Import opens the first newly imported valid entry; others remain in the library until selected.
- Existing single-file Open, drag/drop and recent-file actions also register the file and activate it. Dropping several files uses batch import semantics. Built-in example reading remains available without requiring a durable library entry for an installation-specific resource path.
- Use an immutable generated library-entry ID. Normalize and compare absolute Windows paths case-insensitively to prevent duplicate paths. Avoid trying to globally deduplicate junctions/hard links in this release.
- Keep library identity separate from PDF content identity. Reading sessions still use the file content hash. Same-content copies share existing notes, as they do today, while navigation state and displayed filenames belong to their library entries.
- On open, revalidate PDF type/size and compute its content identity. If a path now contains changed contents, use the new document's session and reset incompatible navigation state; do not apply old annotations to a changed PDF. Preserve the old session files for recovery.
- Persist paths locally, never send them to AI or publish them. `在文件夹中显示` resolves an existing library ID in the main process and calls the OS reveal operation. Do not expose a general arbitrary-command or URL launcher.
- Missing/moved files remain listed with a clear notice. `重新定位` opens a native PDF picker. Accept a replacement with the same content identity and retain state; if contents differ, explain the mismatch and offer normal import as a different paper rather than silently attaching old notes. Repointing to an existing library path must not create a duplicate.
- Removing an entry from the library closes its tab and deletes its workspace metadata only after pending saves are handled. Retain source PDF and all reading-session data. Deleting a group only reparents entries to `未分组`.

## Persistence and restoration

Create a main-process `library.json` under the existing user-data directory. Store a schema version, groups, paper entries (ID, path, display name, group, last known content identity), open entry IDs/order, active entry ID, presentation mode, group expansion/sidebar preferences and per-entry reading state.

Per-entry persistent reading state contains a 1-based page, normalized viewport anchor within the page, numeric zoom or fit-width, and right-panel open/tab state. Fit-width is recalculated for the current window. Clamp invalid page/zoom/anchor values; missing fields use safe defaults. Do not serialize PDF objects, canvas content, extracted text, search matches, passwords or DOM selections.

Use validated actions and serialized writes in the main process. Debounce frequent reading-position updates and atomically replace JSON via a temporary file with a last-known-good backup. Structural changes are saved promptly. Closing the app flushes both library/workspace state and existing reading sessions; a failed save offers retry/cancel/explicit close rather than silently discarding changes.

Startup restores metadata before loading the active PDF. Other tabs remain lazy until selected. Missing, password-protected or invalid PDFs show an actionable state for that tab without blocking use of other papers. Passwords are requested only when needed and are not persisted. Do not automatically start AI requests.

If library JSON is corrupt, preserve it, attempt the valid backup and surface recovery status. If neither is valid, show a recovery error and do not overwrite the original with an empty library. Never silently discard unknown future schema versions.

For upgrades with no library file, import valid known entries from the existing small recent-file list into `未分组` once; retain missing entries as unavailable. Do not scan unrelated files or automatically open all recent items. On first explicit open, adopt the old page-position preference when no new per-entry state exists. Keep existing reading sessions and settings unchanged.

## Architecture and state boundaries

### Main process

Introduce focused library model/store modules for schema validation, actions, persistence and migration. Introduce a file service for importing, opening by ID, revealing and relocating registered files. Keep IPC wiring in `electron/main.ts`, reusing its trusted-main-frame handler wrapper and existing validation for PDF files.

The main process is the authority for library structure, paths, and persisted workspace state. Renderer requests contain IDs, explicitly bounded state and operation-specific parameters. Renderer cannot overwrite arbitrary profile files or invent unrestricted OS actions. Normal exports continue to use the existing export service.

### Renderer

Separate the outer workspace (library, open tabs, active ID, navigation mode) from a reusable active reader component. Extract the existing reader logic from `App.tsx` only where necessary for this feature; retain its tested selection, zoom, annotation, search and export behavior.

The workspace owns each tab's lightweight state independently. The active reader receives a tab identity and document resources. Capture an outgoing viewport anchor before switching; restore the incoming anchor only after layout and zoom settle. Use generation tokens per open operation so a slower file load cannot replace a newer selected tab.

Render only the active document's pages and interactive text layers. As an implementation default, retain at most two loaded PDF instances (active plus most recently used inactive); PDFs larger than 32 MiB are not retained as inactive instances. Release evicted loading tasks, search caches and text caches explicitly. Tab metadata survives eviction, so selecting an evicted tab reloads its file and restores state.

Keep each open tab's search query/options/open state in memory for tab switches; restart and tab closure clear these ephemeral values. Recompute matches after resource reload without automatically moving the reading position. Clear browser text selection and floating selection UI on switches.

Keep AI/session behavior explicit: switching or closing saves the original document's records and stops its in-flight AI requests using existing semantics. Returning shows partial/interrupted content with existing retry controls. The first release does not introduce background AI generation. Failed session saves must not be hidden by another document's saved indicator.

An export already in progress retains its original document snapshot; success/error notifications do not appear on another paper. Same-content copies must share current annotation data when activated rather than retaining independent stale session copies.

## Validation and acceptance

- Library model: group lifecycle, move/remove without file deletion, unique IDs, duplicate canonical paths, same-named different files, unknown IDs, invalid schema and bounded state validation.
- Persistence: restart restoration of mode/groups/open order/active paper/page anchor/zoom, concurrent actions, corrupt-primary recovery, backup failure protection, recent migration and close-save failure.
- Files: batch partial success, missing/moved PDFs, same-content relocation, changed-content rejection, password prompt isolation, source files untouched, and untrusted IPC rejection.
- Desktop navigation: sidebar/tab modes address the same entries, library drawer remains usable, keyboard navigation/closing works, selected tab stays visible, close differs from remove, and group moves do not interrupt reading.
- Document isolation: page/zoom/search state survives A/B switching; notes, draft, AI partial output and exports never switch ownership. Fast repeated switching with delayed PDF loads cannot show stale content.
- Resource lifecycle: restoring many tabs loads only the active one; switching among more than two documents evicts old heavy resources but preserves state; failed/closed loads are destroyed.
- Full regression: existing copying, high-DPI zoom, search, annotations, AI sessions, export and security tests remain green. Extend packaged smoke to import two documents, switch and restore after restart.

## Delivery

Follow root `AGENTS.md`: update package/lock/changelog together, run checks, package the Windows portable, install into the existing local application root, update the desktop shortcut, and verify installed version/resources and the new workflow using an isolated profile. Keep personal data and old installed versions intact; clean only validated temporary outputs.

Remote push and Release follow explicit user publishing instructions. An authorized Release uses English information and only the portable executable attachment.

## Design self-review

- Confirmed requirements are separated from recommended defaults (single-level groups, sidebar initial mode, lazy restore, resource cache and existing AI interruption semantics).
- Group identity, library-path identity and content-based session identity are distinct; deletion/relocation behavior specifies what is preserved.
- Missing files, duplicate paths, damaged persistence and out-of-order loads do not silently delete data or replace the active document.
- Detailed implementation planning follows review of this written design; this document does not authorize adding a document-management backend, filesystem moves or extra output formats.
