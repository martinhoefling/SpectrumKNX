// jsdom has no layout. Give the TelegramTable virtualizer a 800 px viewport and
// 85 px rows so it renders items and the anchor logic finds rows. Newer
// @tanstack/virtual-core versions read clientHeight / offsetHeight, which jsdom
// leaves at 0, so a ResizeObserver stub alone no longer renders any row.
const VIEWPORT = 800;
const ROW = 85;

const isScrollport = (el: Element) => el.classList?.contains('custom-scrollbar');
const isRow = (el: Element) => el.classList?.contains('log-row');

export function installVirtualLayout(): void {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      const size = { inlineSize: 1000, blockSize: isRow(el) ? ROW : VIEWPORT };
      this.cb(
        [{ target: el, contentRect: el.getBoundingClientRect(), borderBoxSize: [size], contentBoxSize: [size] } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1000, height: VIEWPORT, top: 0, bottom: VIEWPORT, left: 0, right: 1000, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return isRow(this) ? ROW : VIEWPORT; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 1000; },
  });
  // Item measurement falls back to offsetHeight without a ResizeObserver entry.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (isScrollport(this)) return VIEWPORT;
      return isRow(this) ? ROW : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (!isScrollport(this)) return 0;
      const inner = this.firstElementChild as HTMLElement | null;
      const height = inner ? Number.parseFloat(inner.style.height) : 0;
      return Number.isFinite(height) && height > 0 ? height : VIEWPORT;
    },
  });
}
