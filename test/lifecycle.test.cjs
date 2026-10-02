const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const notices = [];
  const observers = [];
  const events = new Map();
  let ready;
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(element, options) { this.element = element; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  class MarkdownView {
    constructor(renderer) {
      this.mode = "preview";
      this.file = {};
      this.previewMode = { renderer };
      this.containerEl = { ownerDocument: { defaultView: { MutationObserver: Observer } } };
    }
    getMode() { return this.mode; }
  }
  class Plugin {
    registerEvent(ref) { this.registered.push(ref); }
  }
  const workspace = {
    activeLeaf: null,
    on(event, callback) { events.set(event, callback); return { event, callback }; },
    onLayoutReady(callback) { ready = callback; },
  };
  const context = {
    module: { exports: {} },
    require(id) {
      assert.equal(id, "obsidian");
      return { Plugin, MarkdownView, Notice: class { constructor(text) { notices.push(text); } } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"), context);
  const plugin = new context.module.exports();
  plugin.app = { workspace };
  plugin.manifest = { name: "Reading View Full Range" };
  plugin.registered = [];
  plugin.onload();
  function renderer(value = 731) {
    return {
      renderExtra: 3,
      renderExtraMinPx: value,
      previewEl: { isConnected: true, clientHeight: 0 },
      updates: 0,
      queued: 0,
      updateVirtualDisplay() { this.updates++; },
      queueRender() { this.queued++; },
    };
  }
  function activate(r = renderer()) {
    const view = new MarkdownView(r);
    workspace.activeLeaf = { view };
    events.get("active-leaf-change")();
    return view;
  }
  return { plugin, workspace, events, notices, observers, renderer, activate, ready: () => ready() };
}

test("activates the native range without changing renderExtra, including zero height", () => {
  const h = setup();
  const r = h.renderer();
  h.activate(r);
  assert.equal(r.renderExtraMinPx, Infinity);
  assert.equal(r.renderExtra, 3);
  assert.equal(Math.max(r.previewEl.clientHeight * r.renderExtra, r.renderExtraMinPx), Infinity);
  assert.equal(r.updates, 1);
  assert.equal(r.queued, 1);
  h.ready();
  h.events.get("layout-change")();
  h.events.get("file-open")();
  assert.equal(r.updates, 1, "repeat events do not repeatedly render");
  assert.equal(h.plugin.registered.length, 3);
});

test("mode observer restores the actual original value and reactivates on Reading View", () => {
  const h = setup();
  const r = h.renderer(1234);
  const v = h.activate(r);
  const o = h.observers[0];
  assert.deepEqual(Array.from(o.options.attributeFilter), ["data-mode"]);
  v.mode = "source";
  o.callback();
  assert.equal(r.renderExtraMinPx, 1234);
  v.mode = "preview";
  o.callback();
  assert.equal(r.renderExtraMinPx, Infinity);
  h.plugin.onunload();
  assert.equal(r.renderExtraMinPx, 1234);
  assert.equal(o.disconnected, true);
});

test("changing active panes restores old renderer and disconnects its observer", () => {
  const h = setup();
  const a = h.renderer(111), b = h.renderer(222);
  h.activate(a);
  h.activate(b);
  assert.equal(a.renderExtraMinPx, 111);
  assert.equal(b.renderExtraMinPx, Infinity);
  assert.equal(h.observers[0].disconnected, true);
  h.workspace.activeLeaf = { view: {} };
  h.events.get("active-leaf-change")();
  assert.equal(b.renderExtraMinPx, 222);
  assert.equal(h.observers[1].disconnected, true);
});

test("renderer replacement within the same view restores the old instance", () => {
  const h = setup();
  const a = h.renderer(), b = h.renderer(917);
  const v = h.activate(a);
  v.previewMode.renderer = b;
  h.events.get("file-open")();
  assert.equal(a.renderExtraMinPx, 731);
  assert.equal(b.renderExtraMinPx, Infinity);
  assert.equal(h.observers.length, 1);
});

test("closing the active pane restores a detached renderer without updating it", () => {
  const h = setup();
  const r = h.renderer();
  h.activate(r);
  r.previewEl.isConnected = false;
  h.workspace.activeLeaf = null;
  h.events.get("layout-change")();
  assert.equal(r.renderExtraMinPx, 731);
  assert.equal(r.updates, 1);
  assert.equal(h.plugin.patch, null);
});

test("unload ignores late layout-ready and mutation callbacks", () => {
  const h = setup();
  const r = h.renderer();
  h.activate(r);
  h.plugin.onunload();
  const count = r.updates;
  h.ready();
  h.observers[0].callback();
  assert.equal(r.renderExtraMinPx, 731);
  assert.equal(r.updates, count);
  assert.equal(h.plugin.watchedView, null);
});

test("no file and Editing View are left alone", () => {
  const h = setup();
  const r = h.renderer();
  const v = h.activate(r);
  v.file = null;
  h.events.get("file-open")();
  assert.equal(r.renderExtraMinPx, 731);
  v.file = {};
  v.mode = "source";
  h.plugin.sync();
  assert.equal(r.renderExtraMinPx, 731);
});

test("missing renderer internals warn once without making a partial change", () => {
  const h = setup();
  const r = h.renderer();
  delete r.queueRender;
  const v = h.activate(r);
  h.plugin.sync();
  assert.equal(r.renderExtraMinPx, 731);
  assert.equal(r.updates, 0);
  delete v.previewMode;
  h.plugin.sync();
  assert.equal(h.notices.length, 1);
});

for (const method of ["updateVirtualDisplay", "queueRender"]) {
  test(`native ${method} failure rolls back and is not retried on each event`, () => {
    const h = setup();
    const r = h.renderer();
    let calls = 0;
    r[method] = () => { calls++; throw new Error("Incompatible native method"); };
    h.activate(r);
    assert.equal(r.renderExtraMinPx, 731);
    assert.equal(h.plugin.patch, null);
    const count = calls;
    h.plugin.sync();
    assert.equal(calls, count);
    assert.equal(h.notices.length, 1);
  });
}

test("a read-only range fails safely", () => {
  const h = setup();
  const r = h.renderer();
  Object.defineProperty(r, "renderExtraMinPx", { value: 731, writable: false });
  h.activate(r);
  assert.equal(r.renderExtraMinPx, 731);
  assert.equal(h.plugin.patch, null);
  assert.equal(h.notices.length, 1);
});

test("inherited range does not leave an own property after restoration", () => {
  const h = setup();
  const r = h.renderer();
  delete r.renderExtraMinPx;
  Object.setPrototypeOf(r, { renderExtraMinPx: 815 });
  h.activate(r);
  assert.equal(r.renderExtraMinPx, Infinity);
  h.plugin.onunload();
  assert.equal(r.renderExtraMinPx, 815);
  assert.equal(Object.hasOwn(r, "renderExtraMinPx"), false);
});

test("restoration does not overwrite another plugin's subsequent range changes", () => {
  const h = setup();
  const r = h.renderer();
  h.activate(r);
  r.renderExtraMinPx = 953;
  r.renderExtra = 6;
  h.plugin.onunload();
  assert.equal(r.renderExtraMinPx, 953);
  assert.equal(r.renderExtra, 6);
  assert.equal(h.plugin.patch, null);
});

test("failed restoration retains its patch and blocks patching a new pane", () => {
  const h = setup();
  const a = h.renderer(111), b = h.renderer(222);
  h.activate(a);
  const saved = h.plugin.patch;
  Object.defineProperty(a, "renderExtraMinPx", { writable: false });
  h.activate(b);
  assert.equal(h.plugin.patch, saved);
  assert.equal(a.renderExtraMinPx, Infinity);
  assert.equal(a.updates, 1, "failed property restoration must not refresh");
  assert.equal(b.renderExtraMinPx, 222);
  assert.equal(b.updates, 0);
  assert.equal(h.notices.length, 1);
  Object.defineProperty(a, "renderExtraMinPx", { writable: true });
  h.events.get("layout-change")();
  assert.equal(a.renderExtraMinPx, 111);
  assert.equal(b.renderExtraMinPx, Infinity);
  h.plugin.onunload();
  assert.equal(b.renderExtraMinPx, 222);
});

test("a silently ignored restoration keeps the saved state", () => {
  const h = setup();
  const r = h.renderer();
  h.activate(r);
  const saved = h.plugin.patch;
  Object.defineProperty(r, "renderExtraMinPx", {
    configurable: true, get() { return Infinity; }, set() {},
  });
  h.plugin.restore();
  assert.equal(h.plugin.patch, saved);
  assert.equal(r.updates, 1);
  assert.equal(h.notices.length, 1);
  Object.defineProperty(r, "renderExtraMinPx", { value: Infinity, writable: true });
  h.plugin.onunload();
  assert.equal(r.renderExtraMinPx, 731);
  assert.equal(h.plugin.patch, null);
});

test("failed removal of an inherited range override retains the patch on unload", () => {
  const h = setup();
  const r = h.renderer();
  delete r.renderExtraMinPx;
  Object.setPrototypeOf(r, { renderExtraMinPx: 815 });
  h.activate(r);
  const saved = h.plugin.patch;
  Object.defineProperty(r, "renderExtraMinPx", { configurable: false });
  h.plugin.onunload();
  assert.equal(h.plugin.patch, saved);
  assert.equal(r.renderExtraMinPx, Infinity);
  assert.equal(r.updates, 1);
  assert.equal(h.notices.length, 1);
});

test("refresh failure releases an already restored patch and permits the next pane", () => {
  const h = setup();
  const a = h.renderer(111), b = h.renderer(222);
  h.activate(a);
  a.updateVirtualDisplay = () => { throw new Error("Refresh failed"); };
  h.workspace.activeLeaf = null;
  h.events.get("active-leaf-change")();
  assert.equal(a.renderExtraMinPx, 111);
  assert.equal(h.plugin.patch, null);
  assert.equal(h.notices.length, 1);
  h.activate(b);
  assert.equal(b.renderExtraMinPx, Infinity);
  h.plugin.onunload();
  assert.equal(b.renderExtraMinPx, 222);
});

test("a foreign change after a failed restoration releases the patch without a write", () => {
  const h = setup();
  const r = h.renderer();
  h.activate(r);
  Object.defineProperty(r, "renderExtraMinPx", { writable: false });
  h.plugin.restore();
  assert.ok(h.plugin.patch);
  Object.defineProperty(r, "renderExtraMinPx", { value: 953 });
  r.updateVirtualDisplay = () => { throw new Error("Refresh failed"); };
  h.plugin.restore();
  assert.equal(r.renderExtraMinPx, 953);
  assert.equal(h.plugin.patch, null);
  assert.equal(h.notices.length, 1);
});

test("failed activation rollback preserves the original value until unload retries", () => {
  const h = setup();
  const r = h.renderer(917);
  r.queueRender = () => {
    Object.defineProperty(r, "renderExtraMinPx", { writable: false });
    throw new Error("Queue failed");
  };
  h.activate(r);
  assert.equal(h.plugin.patch.value, 917);
  assert.equal(r.renderExtraMinPx, Infinity);
  Object.defineProperty(r, "renderExtraMinPx", { writable: true });
  h.plugin.onunload();
  assert.equal(r.renderExtraMinPx, 917);
  assert.equal(h.plugin.patch, null);
});

test("missing observer window avoids patching and disconnects the previous observer", () => {
  const h = setup();
  const r = h.renderer();
  const v = h.activate(r);
  h.workspace.activeLeaf = null;
  h.plugin.sync();
  v.containerEl.ownerDocument.defaultView = null;
  h.workspace.activeLeaf = { view: v };
  h.plugin.sync();
  assert.equal(r.renderExtraMinPx, 731);
  assert.equal(h.notices.length, 1);
});
