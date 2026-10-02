const { Plugin, MarkdownView, Notice } = require("obsidian");

module.exports = class ReadingViewFullRange extends Plugin {
  onload() {
    this.stopped = false;
    this.watchedView = null;
    this.observer = null;
    this.patch = null;
    this.failedRenderers = new WeakSet();
    this.warned = false;

    const sync = () => this.sync();
    for (const event of ["active-leaf-change", "layout-change", "file-open"]) {
      this.registerEvent(this.app.workspace.on(event, sync));
    }
    this.app.workspace.onLayoutReady(sync);
  }

  warn() {
    if (this.warned) return;
    this.warned = true;
    new Notice(`${this.manifest.name}: Reading View is incompatible. Disable this plugin and check for a compatibility update.`);
  }

  sync() {
    if (this.stopped) return;
    const candidate = this.app.workspace.activeLeaf?.view;
    const view = candidate instanceof MarkdownView ? candidate : null;

    if (view !== this.watchedView) {
      this.observer?.disconnect();
      this.observer = null;
      this.watchedView = view;
      if (view) {
        // Private DOM contract: data-mode changes after the native mode switch.
        // Use the view's window so detached desktop windows are supported.
        const Observer = view.containerEl.ownerDocument.defaultView?.MutationObserver;
        if (Observer) {
          this.observer = new Observer(() => this.sync());
          this.observer.observe(view.containerEl, {
            attributes: true,
            attributeFilter: ["data-mode"],
          });
        } else {
          this.restore();
          this.warn();
          this.watchedView = null;
          return;
        }
      }
    }

    const reading = view?.getMode() === "preview" && view.file;
    // renderer and its range/update members are PRIVATE Obsidian internals.
    const renderer = reading ? view.previewMode?.renderer : null;
    if (renderer && renderer === this.patch?.renderer) return;
    this.restore();
    // Keep an unresolved restoration; never replace its saved state.
    if (this.patch || !reading) return;

    if (!renderer || typeof renderer !== "object" ||
        typeof renderer.renderExtra !== "number" ||
        typeof renderer.renderExtraMinPx !== "number" ||
        Number.isNaN(renderer.renderExtraMinPx) ||
        typeof renderer.updateVirtualDisplay !== "function" ||
        typeof renderer.queueRender !== "function" || !renderer.previewEl) {
      this.warn();
      return;
    }
    if (this.failedRenderers.has(renderer)) return;

    this.patch = {
      renderer,
      value: renderer.renderExtraMinPx,
      owned: Object.prototype.hasOwnProperty.call(renderer, "renderExtraMinPx"),
    };
    try {
      // A pixel minimum avoids 0 * Infinity for zero-height viewports.
      // Change only this renderer instance; retain the native render pipeline.
      renderer.renderExtraMinPx = Infinity;
      if (renderer.renderExtraMinPx !== Infinity) throw new Error("Range is not writable");
      renderer.updateVirtualDisplay();
      renderer.queueRender();
    } catch {
      this.failedRenderers.add(renderer);
      this.restore();
      this.warn();
    }
  }

  restore() {
    const saved = this.patch;
    if (!saved) return;
    const { renderer } = saved;
    try {
      // Do not overwrite a subsequent change made by another plugin.
      if (renderer.renderExtraMinPx === Infinity) {
        if (saved.owned) {
          renderer.renderExtraMinPx = saved.value;
          if (!Object.is(renderer.renderExtraMinPx, saved.value)) {
            throw new Error("Range was not restored");
          }
        } else {
          delete renderer.renderExtraMinPx;
          if (Object.prototype.hasOwnProperty.call(renderer, "renderExtraMinPx")) {
            throw new Error("Range override was not removed");
          }
        }
      }
    } catch {
      this.warn();
      return;
    }
    this.patch = null;
    // Refresh failure does not undo a completed property restoration.
    try {
      if (renderer.previewEl?.isConnected) renderer.updateVirtualDisplay();
    } catch {
      this.warn();
    }
  }

  onunload() {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    this.watchedView = null;
    this.restore();
  }
};
