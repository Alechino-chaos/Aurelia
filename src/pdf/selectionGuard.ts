/**
 * Chromium can extend an absolutely positioned text selection to a distant
 * sibling when the pointer enters the whitespace below a line. Keep an empty
 * selection boundary beside the moving endpoint, as PDF.js's TextLayerBuilder
 * does (we use TextLayer directly so we can control double-column DOM order).
 * The guard sits behind the text; it never changes the text or copy order.
 */
const layers = new Map<HTMLElement, HTMLDivElement>();
let controller: AbortController | undefined;
let dragging = false;

function reset(layer: HTMLElement, guard: HTMLDivElement) {
  layer.append(guard);
  guard.removeAttribute('style');
  layer.classList.remove('selecting');
}

function finish() {
  dragging = false;
  for (const [layer, guard] of layers) reset(layer, guard);
}

function updateBoundary() {
  if (!dragging) return;
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  for (const [layer, guard] of layers) {
    if (range.intersectsNode(layer)) layer.classList.add('selecting');
    else reset(layer, guard);
  }
  const focus = selection.focusNode;
  const span = (focus instanceof Element ? focus : focus?.parentElement)?.closest<HTMLElement>('[data-line]');
  const layer = span?.closest<HTMLElement>('.textLayer');
  const guard = layer && layers.get(layer);
  if (!span || !layer || !guard) return;
  const backward = focus === range.startContainer && selection.focusOffset === range.startOffset;
  // At offset zero, a forward range ends immediately before this span.
  const before = backward || selection.focusOffset === 0;
  guard.style.width = layer.style.width;
  guard.style.height = layer.style.height;
  guard.style.userSelect = 'text';
  const sibling = before ? span : span.nextSibling;
  if (sibling !== guard) span.parentNode!.insertBefore(guard, sibling);
}

export function guardTextSelection(layer: HTMLElement): () => void {
  const guard = document.createElement('div');
  guard.className = 'endOfContent';
  guard.setAttribute('aria-hidden', 'true');
  layer.append(guard);
  layers.set(layer, guard);
  if (!controller) {
    controller = new AbortController();
    const options = { signal: controller.signal };
    document.addEventListener('pointerdown', event => {
      finish();
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.textLayer') : null;
      if (target && layers.has(target)) {
        dragging = true;
        target.classList.add('selecting');
      }
    }, options);
    document.addEventListener('selectionchange', updateBoundary, options);
    document.addEventListener('pointerup', finish, options);
    document.addEventListener('pointercancel', finish, options);
    window.addEventListener('blur', finish, options);
  }
  return () => {
    layers.delete(layer);
    guard.remove();
    layer.classList.remove('selecting');
    if (!layers.size) {
      controller?.abort();
      controller = undefined;
      dragging = false;
    }
  };
}
