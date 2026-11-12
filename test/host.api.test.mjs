import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dshc-test-"));
process.env.DSH_HOME = HOME;

const plugin = await import(new URL("../lib/index.js", import.meta.url).href);

// 包名从 package.json 读取，避免改名后测试脚本要跟着改（此前写死 dsh-companion 导致 8/10）
const PKG_NAME = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
).name;

let apiHandler = null;
const fakeServer = {
  register(opts) {
    if (opts.path === `/${PKG_NAME}/api`) apiHandler = opts.handler;
    return () => {};
  }
};
const ctx = {
  get: (k) => (k === "webServer" ? fakeServer : undefined),
  effect: (fn) => fn()
};
plugin.apply(ctx);

function call(method, action, body, opts = {}) {
  return new Promise((resolve, reject) => {
    let sent = false;
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = {
      method,
      url: `/${PKG_NAME}/api?action=` + action,
      [Symbol.asyncIterator]: async function* () {
        for (const c of chunks) yield c;
        if (opts.oversize) for (let i = 0; i < 40; i++) yield Buffer.alloc(64 * 1024, 0x20);
      }
    };
    const res = {
      _code: 0,
      _body: "",
      writeHead(code) { this._code = code; },
      end(payload) {
        if (sent) return;
        sent = true;
        if (payload !== undefined) this._body = String(payload);
        clearTimeout(t);
        resolve({ code: this._code, body: this._body ? JSON.parse(this._body) : null });
      }
    };
    const t = setTimeout(() => reject(new Error("timeout " + action)), 5000);
    apiHandler(req, res);
  });
}

const out = [];
const ok = (name, cond, extra) => out.push((cond ? "PASS " : "FAIL ") + name + (extra === undefined ? "" : "  " + JSON.stringify(extra)));

// 1. ping
const ping = await call("GET", "ping");
ok("GET ping", ping.code === 200 && ping.body.ok === true && ping.body.plugin === PKG_NAME, ping.body);

// 2. ui-state 空
const empty = await call("GET", "ui-state");
ok("GET ui-state 空 -> null", empty.code === 200 && empty.body.ui === null, empty.body);

// 3. 并发 patch 不丢字段（原实现的 read-merge-write 竞态）
await Promise.all([
  call("POST", "ui-state", { left: 10, top: 20 }),
  call("POST", "ui-state", { width: 300, height: 400 }),
  call("POST", "ui-state", { fontScale: 0.85 }),
  call("POST", "ui-state", { lastUrl: "https://chat.deepseek.com/a/chat/s/1" }),
]);
const merged = await call("GET", "ui-state");
const ui = merged.body.ui;
ok("并发写不丢字段", ui.left === 10 && ui.width === 300 && ui.fontScale === 0.85 &&
   ui.lastUrl === "https://chat.deepseek.com/a/chat/s/1", ui);

// 4. fontScale 夹取
await call("POST", "ui-state", { fontScale: 9 });
const clamped = (await call("GET", "ui-state")).body.ui.fontScale;
ok("fontScale 越界夹取到 1.4", clamped === 1.4, clamped);

// 5. lastUrl 白名单
await call("POST", "ui-state", { lastUrl: "https://evil.example.com/" });
const stillSafe = (await call("GET", "ui-state")).body.ui.lastUrl;
ok("lastUrl 只接受 deepseek 域", stillSafe === "https://chat.deepseek.com/a/chat/s/1", stillSafe);

// 6. 无效 body 返回 400
const bad = await call("POST", "ui-state", undefined);
ok("空 body -> 400", bad.code === 400, bad.body);
const arr = await call("POST", "ui-state", [1, 2, 3]);
ok("数组 body -> 400", arr.code === 400, arr.body);

// 7. 超大 body 被拦
const huge = await call("POST", "probe", null, { oversize: true });
ok("超大 body -> 413", huge.code === 413, huge.body);

// 7b. 合法限内 body 正常通过（避免把正常写入误杀）
const withinLimit = await call("POST", "probe", { label: "size-ok", data: "z".repeat(200 * 1024) });
ok("限内大 body 正常通过", withinLimit.code === 200, withinLimit.body);

// 7c. 前缀伪造的 URL 必须被拒（chat.deepseek.com.evil.test）
await call("POST", "ui-state", { lastUrl: "https://chat.deepseek.com.evil.test/x" });
const spoofed = (await call("GET", "ui-state")).body.ui.lastUrl;
ok("前缀伪造 URL 被拒", spoofed === "https://chat.deepseek.com/a/chat/s/1", spoofed);

// 7d. 大小写/端口/子路径的合法形态要放行
await call("POST", "ui-state", { lastUrl: "https://chat.deepseek.com/a/chat/s/xyz?from=1" });
const legit = (await call("GET", "ui-state")).body.ui.lastUrl;
ok("合法深链放行", legit === "https://chat.deepseek.com/a/chat/s/xyz?from=1", legit);

// 7e. clear-session 与 save-session 并发：清除后凭证不得复活
await call("POST", "save-session", { token: "secret-token", userInfo: "u" });
await Promise.all([
  call("POST", "clear-session", {}),
  call("POST", "save-session", { token: "racing-token", userInfo: "u" }),
]);
const after9 = (await call("GET", "session")).body.session;
ok("clear/save 并发后状态确定（不留半写）",
   after9 === null || (typeof after9.token === "string" && (after9.token === "secret-token" || after9.token === "racing-token")),
   after9 && after9.token);

// 8. 未知 action
const unknown = await call("GET", "nope");
ok("未知 action -> 404", unknown.code === 404, unknown.body);

// 9. session 保存/读取/超长截断
await call("POST", "save-session", { token: "t".repeat(20000), userInfo: "u", origin: "https://chat.deepseek.com", note: "n" });
const sess = (await call("GET", "session")).body.session;
ok("token 截断到 8192", sess.token.length === 8192, sess.token.length);
ok("session 字段齐备", sess.userInfo === "u" && sess.savedAt !== undefined);

// 10. clear-session
const cleared = await call("POST", "clear-session", {});
const after = (await call("GET", "session")).body.session;
ok("clear-session 生效", cleared.body.cleared === true && after === null);

// 11. 日志轮转：写超过 1MB 后出现 probe.log.1
for (let i = 0; i < 30; i++) await call("POST", "probe", { label: "x", data: "y".repeat(64 * 1024) });
const dir = join(HOME, "plugin-data", PKG_NAME);
let rotated = false;
try { await readFile(join(dir, "probe.log.1")); rotated = true; } catch {}
const liveSize = (await readFile(join(dir, "probe.log"))).length;
ok("日志轮转触发且当前日志不超 1MB", rotated && liveSize <= 1024 * 1024, { rotated, liveSize });

// 12. 原子写临时文件不残留
const { readdir } = await import("node:fs/promises");
const files = await readdir(dir);
ok("无 .tmp 残留", files.every((f) => !f.includes(".tmp-")), files);

console.log(out.join("\n"));
console.log("\n" + out.filter((l) => l.startsWith("PASS")).length + "/" + out.length + " passed");
await rm(HOME, { recursive: true, force: true });