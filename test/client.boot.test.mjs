import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// 包名从 package.json 读取，避免改名后测试脚本要跟着改
const PKG_NAME = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).name;

const out = [];
const ok = (name, cond, extra) => out.push((cond ? "PASS " : "FAIL ") + name + (extra === undefined ? "" : "  " + JSON.stringify(extra)));

// ---- 最小 DOM / 宿主桩 ----
const el = (tag) => ({
  tagName: String(tag).toUpperCase(),
  className: "", id: "", textContent: "", style: {},
  dataset: {}, children: [],
  classList: { add() {}, remove() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
  appendChild(c) { this.children.push(c); return c; },
  removeChild() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ width: 400, height: 600, left: 0, top: 0, right: 400, bottom: 600 }),
  closest: () => null,
  getContext: () => null
});

const head = el("head");
const body = el("body");
const documentStub = {
  head, body,
  documentElement: Object.assign(el("html"), { clientWidth: 1440, clientHeight: 900 }),
  getElementById: () => null,
  createElement: el,
  querySelector: () => null,
  querySelectorAll: () => []
};

let intervalCount = 0;
let listenerCount = 0;
const ctx = {
  React: null,
  console,
  JSON, Math, Number, String, Object, Array, Boolean, Date, RegExp, Error, Promise, Node: class {},
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (t) => clearTimeout(t),
  setInterval: (...a) => { intervalCount++; return 0; },
  clearInterval: () => {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  AbortSignal,
  location: { href: "https://dsh-app.example/app" }
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
ctx.document = documentStub;
ctx.navigator = { userAgent: "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36" };
ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
ctx.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
ctx.fetch = async () => ({ json: async () => ({ ok: true, ui: null, session: null }) });
ctx.addEventListener = () => { listenerCount++; };
ctx.removeEventListener = () => {};
ctx.innerWidth = 1440;
ctx.innerHeight = 900;
ctx.devicePixelRatio = 1;

let captured = null;
ctx.__ModuleLoader__ = { load: (def) => { captured = def; } };

vm.createContext(ctx);

// ---- 1. 模块可执行并完成注册 ----
let thrown = null;
try { vm.runInContext(src, ctx, { filename: "client.js" }); } catch (e) { thrown = e; }
ok("模块顶层无异常", thrown === null, thrown ? String(thrown).slice(0, 200) : undefined);
ok("调用 __ModuleLoader__.load", captured !== null);
ok("id 与包名一致", captured?.id === PKG_NAME, captured?.id);
ok("factory 是函数", typeof captured?.factory === "function");

// ---- 2. factory 可执行（React 桩） ----
const mkRef = (v) => ({ current: v });
const React = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  Fragment: Symbol("Fragment"),
  useRef: (v) => mkRef(v),
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn()
};
const ReactDOM = { createPortal: (node) => node };
const require = (name) => ({ react: React, "react-dom": ReactDOM })[name];

let exportsObj = null;
let fThrown = null;
try { exportsObj = captured.factory(require); } catch (e) { fThrown = e; }
ok("factory 执行无异常", fThrown === null, fThrown ? String(fThrown).slice(0, 300) : undefined);
ok("导出 apply/inject", typeof exportsObj?.apply === "function" && Array.isArray(exportsObj?.inject), exportsObj?.inject);

// ---- 3. apply(ctx) 注册槽位 ----
const registrations = [];
const injected = [];
let aThrown = null;
try {
  exportsObj.apply({
    slots: {
      inject: (name, fn) => { injected.push(name); fn(); },
      register: (meta, Component) => { registrations.push({ meta, Component }); }
    }
  });
} catch (e) { aThrown = e; }
ok("apply 执行无异常", aThrown === null, aThrown ? String(aThrown).slice(0, 300) : undefined);
ok("注入 sidebar.footer.action", injected[0] === "sidebar.footer.action", injected);
ok("注册 id/order 正确",
   registrations.length === 1 && registrations[0].meta.id === PKG_NAME && registrations[0].meta.order === 50,
   registrations[0]?.meta);
ok("注册的是组件", typeof registrations[0]?.Component === "function");

console.log(out.join("\n"));
console.log("\n" + out.filter((l) => l.startsWith("PASS")).length + "/" + out.length + " passed");
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);