# PDF links, outline and navigation history

## Confirmed intent

用户优先解决论文正文与参考文献、图表、公式之间的往返，同时需要章节目录。首版只读取 PDF 自带的链接和目录，不识别普通文字编号。跳转保持当前缩放；后退恢复跳转前的段落位置和缩放。目录与现有页码导航共用左侧区域。每篇已打开论文拥有独立历史，切换论文保留，关闭或重启清空，正常阅读位置仍按 0.7.0 恢复。

用户已确认这套交互并明确要求直接执行。完成设计和计划记录后持续实现、测试和本机交付，不重复请求开工批准。本任务不包含 GitHub 推送或 Release。

## Scope and experience

- Read native PDF link annotations and native hierarchical outline. Do not infer links, generate outlines with AI, OCR pages, edit PDFs, or add previews/split reading.
- Clicking a supported internal link or outline entry moves to its actual destination, retaining current numeric zoom or fit-width mode. Zoom embedded in a destination is ignored.
- Back/Forward buttons and Alt+Left/Alt+Right restore page, horizontal/vertical reading anchor and prior zoom. These are distinct from Previous/Next Page.
- Record explicit jumps from links, outline, search navigation, annotation/source location, page entry and page-navigation buttons. Do not append history on continuous scroll, zoom, initial restore, sidebar changes or tab switches.
- Capture the actual current viewport before each explicit jump and each history traversal. Back then Forward returns to the location actually left, including intervening scrolling. A new successful jump after Back clears the forward branch; invalid/no-op jumps do not change history.
- Keep at most 100 locations per history direction per open paper. History is transient and keyed by library entry, not PDF content; same-content copies keep separate histories. Cache eviction preserves history. Closing/removing a paper, changed content or app restart resets it.
- Only the current document responds to navigation. Delayed destination/outline/annotation reads cannot navigate a newly selected paper or override a newer navigation intent. Failed destinations show a brief readable message while leaving the viewport/history intact.

## Layout and interactions

Add Back/Forward beside existing page controls, with disabled states and shortcut tooltips. Keep the toolbar usable at 960px and 1440px; existing settings/zoom/file controls remain reachable.

Extend the existing left document-navigation panel with tabs labelled `目录` and `页码`. Preserve the existing page-navigation toggle and selectors used by accessibility/tests; prefer the outline tab when a document has an outline, otherwise show its explicit empty state and the available page tab. Outline entries preserve nesting, can expand/collapse independently, and highlight the clicked/current navigation target without guessing heading positions for ordinary scrolling. No new persistent library schema is required for transient outline expansion/tab state.

Library sidebar and document navigation continue to occupy the same left slot, not two permanently stacked columns. The existing `论文库` drawer entry remains accessible when document navigation is open and in top-tabs mode. Opening/closing the navigation panel must keep the reading anchor coherent in fit-width mode.

Link hit regions align through PDF.js viewport transforms, including crop boxes, intrinsic rotation and UserUnit. A click activates a link; dragging selects text, including linked text, without an accidental jump. Existing copy/highlight/annotation selection has priority over incidental clicks following a drag. Links must be keyboard accessible and expose a readable destination/action label and focus indicator. Do not create a full-page click blocker.

## Destination and link handling

Resolve named destinations via getDestination and page references via getPageIndex, with bounds/type checks. Support ordinary explicit destinations XYZ, Fit, FitB, FitH, FitBH, FitV, FitBV and FitR. Convert target coordinates with getViewport({scale:1}); normalize against displayed page size. XYZ null axes retain the corresponding current axis where meaningful; Fit/FitB goes to page top, FitH/BH uses top, FitV/BV uses left, and FitR aligns the target rectangle without changing zoom. Validate finite values and clamp viewport navigation to usable document bounds.

Support native named navigation actions GoBack, GoForward, NextPage, PrevPage, FirstPage and LastPage through the same controller. Unknown actions, invalid destinations, remote-document actions and attachments do not execute embedded PDF code or launch files; report unsupported targets without interrupting reading.

For normal external HTTP(S) links (for example a DOI), explicit clicks open the system browser. A narrow trusted-main-frame IPC validates the URL again in the main process; reject credentials, control characters, non-HTTP(S) schemes and URLs longer than 8192 characters. No automatic fetching/opening on load, hover or history restore; no file/mailto/custom protocol execution. Browser preview fallback may use a noopener/noreferrer window for the same validated URLs. External links do not change document history.

## Implementation shape

Keep Electron + React + TypeScript + existing PDF.js; add no dependencies. PDF.js supplies native annotation/outline/destination metadata; Aurelia owns its viewport and history rather than replacing the reader with the bundled PDF.js viewer.

Create focused navigation modules for pure history, destination resolution and validated link data. A reader navigation hook coordinates synchronous capture, async destination resolution, current generation, viewport landing and history traversal. Reuse existing normalized view capture/restore semantics while distinguishing transient jump history from persisted ReadingView.

Add a native PDF link layer separate from Aurelia's AnnotationLayer (which paints saved user notes). Keep selection event handling local and explicit. Add an outline component with loading, empty, error/retry states. Lazily retrieve link annotations for visited/near pages and outline once per loaded document, avoiding unbounded background page loads.

Workspace carries transient navigation memory through Reader snapshots and remounts alongside search memory, including resource eviction and same-content entry isolation. Never add transient history to library.json or reading-session JSON. New navigation paths do not start/stop AI, mutate notes or change session ownership.

Search and annotation positioning must complete once per requested jump. Their delayed text/raster readiness must not pull the viewport back after a newer Back/Forward action. Restoration must apply the saved zoom before measuring the landing anchor.

## Verification and acceptance

- Pure history tests: exact back/forward position, scrolled current capture, branching, no-op/error behavior, cap and immutable independent paper memory.
- Native PDF fixtures: named/direct targets; nonzero offset/zoom; null axes; nested outline; crop/rotation; invalid target; external link. Resolve with the installed PDF.js, not only mocks.
- Real Electron UI: click visible link at 125%, verify destination coordinate and unchanged zoom, return to original coordinate; forward; keyboard and editable-field/IME isolation; link text drag remains selectable and copyable; narrow/wide layouts.
- Outline: hierarchy collapse, native jump, no-outline state, failed metadata retry without loss of reading/selection.
- Explicit search, note and page jumps enter history; passive scroll/zoom do not. Delayed stale native/search jumps must not override newer back/tab intents.
- Multi-paper: independent history for two same-content copies, history survives cache eviction/tab switches, closes/reset on restart, changed-file identity clears history, no regressions to 0.7 library close/save races.
- Security: trusted IPC and allowed URL boundary; no execution of PDF JS/remote/file actions or unrequested external launch.
- Full unit/typecheck/Electron regression, then installed-program tests and packaged smoke using disposable profiles.

## Delivery

Version 0.8.0 in package/lock/changelog; English public docs. Package portable EXE, install into recorded application root, update desktop shortcut, verify installed version/executable/app.asar matches. Preserve old installs and personal profiles. Clean only validated obsolete generated workspace outputs. No remote publication in this task.

## Self-review

Scope stays within native navigation. Current-zoom jumps are distinguished from history restoration. PDF content identity differs from entry identity and transient history never alters the persisted library schema. Error/stale navigation semantics preserve the source location. External URL handling is bounded and uses the existing trusted IPC pattern. Tests cover each stated failure class and local delivery is explicit.
