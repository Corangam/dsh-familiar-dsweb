import { mkdir, appendFile, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * dsh-familiar-dsweb host 半区。
 *
 * 职责：
 *   1. 维护插件私有数据目录；
 *   2. 暴露 /dsh-familiar-dsweb/api，提供登录态、窗口状态与探针上报；
 *   3. 提供 /dsh-familiar-dsweb/assets 静态资源（图标）。
 *
 * token 以明文 JSON 存储（用户已确认接受）。文件权限由用户目录本身保护。
 */

const name = "dsh-familiar-dsweb";
const inject = ["webServer"];

const API_PREFIX = "/dsh-familiar-dsweb/api";
const ASSET_PREFIX = "/dsh-familiar-dsweb/assets";

/** 允许解析的 JSON 文件白名单，避免任意文件名穿越。 */
const SESSION_FILE = "session.json";
const UI_FILE = "ui.json";

const DEEPSEEK_ORIGIN = "https://chat.deepseek.com";

/** 静态资源白名单：文件名 → MIME。 */
const ASSETS = new Map([
  ["icon.png", "image/png"],
  ["icon-48.png", "image/png"],
  ["icon.svg", "image/svg+xml"]
]);

/**
 * 插件私有数据目录：`$DSH_HOME/plugin-data/dsh-familiar-dsweb`。
 *
 * host 进程不一定设置 DSH_HOME，且 cwd 可能被切到 profile 目录；
 * 用 homedir 兜底，保证数据落在用户主目录下而不是 profile 里。
 */
function dataDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "plugin-data", name);
}

/**
 * 探针日志体积上限。
 *
 * 为什么需要：正文缩放注入每 1.5s 一次、每次回报整份诊断负载，
 * 实测单个会话就能把 probe.log 撑到 3.3MB / 8445 行。日志本身只是
 * 排查手段，不该无限增长 —— 超过上限即整体轮转（只保留一代），
 * 既不丢现场，也不会滚成雪球。
 */
const LOG_MAX_BYTES = 1024 * 1024;

let logBytes = 0;
let logRotated = false;

/** 超限削减：删除 oversized → 改名为 probe.log.1，新日志重新计长。 */
async function rotateLog(file) {
  const rotated = `${file}.1`;
  try {
    await rm(rotated, { force: true });
    await rename(file, rotated);
  } catch {
    // 轮转失败就继续往原文件追加，绝不阻断主流程
    try {
      await rm(file, { force: true });
    } catch {}
  }
  logBytes = 0;
}

async function appendLog(line) {
  try {
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    const file = join(dir, "probe.log");
    const text = `[${new Date().toISOString()}] ${line}\n`;
    const size = Buffer.byteLength(text);
    if (!logRotated) {
      logRotated = true;
      try {
        logBytes = (await stat(file)).size;
      } catch {
        logBytes = 0;
      }
    }
    if (logBytes + size > LOG_MAX_BYTES) await rotateLog(file);
    await appendFile(file, text, "utf8");
    logBytes += size;
  } catch {
    // 日志失败绝不能影响主流程
  }
}

/** 安全读 JSON：不存在、损坏、非对象一律返回 null。 */
async function readJson(fileName) {
  const file = join(dataDir(), fileName);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch (error) {
    await appendLog(`READ_ERROR ${fileName} ${String(error)}`);
    return null;
  }
}

/**
 * 每个文件的写队列。
 *
 * 为什么需要：原子写用「写临时文件 → rename」两步，但 rename 本身不是
 * 互斥的。两个请求同时写同一个 ui.json 时，A 的临时文件可能已被 B 的
 * rename 处理掉，A 再 rename 就 ENOENT —— 实测日志里出现过：
 *   API_ERROR ENOENT: rename 'ui.json.tmp-...' -> 'ui.json'
 * 而且并发 rename 还可能让目标文件出现交错内容，读侧直接 JSON 解析失败。
 *
 * 解决：按文件名串行化，后到的写等前一个彻底完成再开始。
 */
const writeQueues = new Map();

function enqueueWrite(fileName, task) {
  const previous = writeQueues.get(fileName) ?? Promise.resolve();
  // 无论上一个成功还是失败，都继续排队（失败不能卡死后续写入）
  const next = previous.then(task, task);
  // 保存一个永不 reject 的尾巴，避免未捕获拒绝
  writeQueues.set(fileName, next.then(() => {}, () => {}));
  return next;
}

/**
 * 纯写入（不入队）：先写临时文件再改名。
 *
 * 必须与 writeJsonAtomic 分开两层，否则会死锁：
 * patchUiState 已经把自己排进 UI_FILE 的队列，若它在队列任务内部
 * 再调用一个同样入队的写入函数，就等于「等自己完成」——永远等不到。
 * 所以队列内的调用一律用这个 direct 版本。
 */
async function writeJsonDirect(fileName, payload) {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, fileName);
  // 临时名带随机后缀，同一毫秒的多写也不会撞名
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, file);
  } catch (error) {
    // 写失败必须清掉临时文件，否则每次失败都在数据目录留一份残骸
    try {
      await rm(tmp, { force: true });
    } catch {}
    throw error;
  }
  return file;
}

/** 安全写 JSON：串行 + 原子替换，避免并发/断电损坏。 */
function writeJsonAtomic(fileName, payload) {
  return enqueueWrite(fileName, () => writeJsonDirect(fileName, payload));
}

/**
 * 只接受 chat.deepseek.com 这一来源下的 URL。
 *
 * 为什么要解析 origin 而不是比字符串前缀：
 * "https://chat.deepseek.com.evil.test/" 同样以它开头，却完全是第三方站点。
 * 这个值会被原样存盘并在下次打开面板时喂给 webview.loadURL()，
 * 校验一松，浮窗就可能被一个被篡改的 ui.json 带去任意地址。
 */
function isDeepSeekUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).origin === DEEPSEEK_ORIGIN;
  } catch {
    return false;
  }
}

/** 只接受有限数值；否则回退到旧值 / null。 */
function pickNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 正文字号缩放允许的区间。
 * 语义：1.0 = 原始大小，只作用于正文容器，不影响框架 UI。
 */
const FONT_SCALE_MIN = 0.6;
const FONT_SCALE_MAX = 1.4;
const FONT_SCALE_DEFAULT = 0.9;

/**
 * 规整字体缩放值。
 *
 * 与 client 侧 clampFontScale 保持完全一致的语义：
 *   - 合法数值 → 夹进 [MIN, MAX] 再规整到两位小数；
 *   - 非数值（脏数据/未传）→ 回退 fallback。
 *
 * 注意这里用"夹取"而不是"超界即丢弃"：用户从 UI 拖到边界外
 * 应当停在边界，而不是莫名跳回旧值。
 */
function pickFontScale(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const bounded = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  return Math.round(bounded * 100) / 100;
}

/**
 * 窗口状态：位置/尺寸/lastUrl/字体缩放。
 *
 * 整个「读旧值 → 合并 → 写回」必须放进同一个写队列任务里，
 * 否则两个并发请求会各自读到同一份旧值，后写的把先写的覆盖掉。
 * 这正是拖动/缩放时高频写 ui-state 会丢位置的原因。
 */
function patchUiState(payload) {
  return enqueueWrite(UI_FILE, async () => {
    const previous = (await readJson(UI_FILE)) ?? {};
    const lastUrl = isDeepSeekUrl(payload.lastUrl) ? payload.lastUrl : (previous.lastUrl ?? null);
    // 已在 UI_FILE 队列内，必须用 direct，不能再次入队
    return writeJsonDirect(UI_FILE, {
      left: pickNumber(payload.left, pickNumber(previous.left, null)),
      top: pickNumber(payload.top, pickNumber(previous.top, null)),
      width: pickNumber(payload.width, pickNumber(previous.width, null)),
      height: pickNumber(payload.height, pickNumber(previous.height, null)),
      lastUrl,
      fontScale: pickFontScale(
        payload.fontScale,
        pickFontScale(previous.fontScale, FONT_SCALE_DEFAULT)
      )
    });
  });
}

/** 登录态：只保留明确需要的字段，整体覆盖写。 */
async function patchSession(payload) {
  // 字段上限：凭证本身就是个小 JSON 字符串，超过这个长度只可能是异常数据。
  // 截断而不是整体拒绝 —— 拒绝会让用户莫名其妙丢登录态。
  const clip = (value, max) => (typeof value === "string" && value.length > max ? value.slice(0, max) : typeof value === "string" ? value : null);
  const session = {
    token: clip(payload.token, 8192),
    userInfo: clip(payload.userInfo, 65536),
    origin: clip(payload.origin, 512),
    note: clip(payload.note, 256),
    savedAt: new Date().toISOString()
  };
  await appendLog(`SESSION_SAVED tokenLen=${session.token === null ? 0 : session.token.length}`);
  return writeJsonAtomic(SESSION_FILE, session);
}

const send = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
};

/** 请求体上限。本插件的 POST 只有几十字节的窗口状态与登录态，1MB 已是余量。 */
const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * 读 JSON 请求体。
 *
 * 返回值语义（调用方据此决定状态码）：
 *   - 对象       → 正常
 *   - null       → 空体 / 非 JSON / 非对象 → 400
 *   - undefined  → 超过 BODY_LIMIT_BYTES   → 413
 *
 * 三条硬约束：
 *   1. 超限立刻停止累积 —— 否则一个畸形请求就能让 host 进程把内存吃干净；
 *   2. 只接受 JSON 对象，数组/数字/字符串一律判无效（后续 handler 都按对象读字段）；
 *   3. 解析失败返回 null，不抛异常。
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) return undefined;
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 业务接口处理表：action + 方法 → handler。 */
function createRouter() {
  const routes = {
    "GET:ping": () => ({ ok: true, plugin: name, at: Date.now() }),

    "GET:ui-state": async () => ({ ok: true, ui: await readJson(UI_FILE) }),

    "GET:session": async () => ({ ok: true, session: await readJson(SESSION_FILE) })
  };

  const postRoutes = {
    "probe": async (payload) => {
      await appendLog(JSON.stringify(payload));
      return { ok: true };
    },

    "ui-state": async (payload) => {
      if (payload === null) return { code: 400, body: { ok: false, error: "invalid body" } };
      return { ok: true, file: await patchUiState(payload) };
    },

    "save-session": async (payload) => {
      if (payload === null) return { code: 400, body: { ok: false, error: "invalid body" } };
      return { ok: true, file: await patchSession(payload) };
    },

    "clear-session": async () => {
      /* 必须走 SESSION_FILE 的写队列：
         直接 rm 与排队的 writeJsonAtomic 是两条互不相干的时间线，
         并发时会出现「已经清除成功，却被排队中的 save-session 又写回来」
         —— 用户的登录凭证看起来清了，其实还在盘上。 */
      let cleared = true;
      try {
        await enqueueWrite(SESSION_FILE, () => rm(join(dataDir(), SESSION_FILE), { force: true }));
      } catch {
        cleared = false;
      }
      await appendLog(`SESSION_CLEARED ${cleared}`);
      return { ok: true, cleared };
    }
  };

  return { routes, postRoutes };
}

function registerApi(webServer) {
  const { routes, postRoutes } = createRouter();

  return webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: (req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", "http://x");
          const action = url.searchParams.get("action") ?? "";
          const isPost = req.method === "POST";

          if (isPost) {
            const handler = postRoutes[action];
            if (handler === undefined) {
              send(res, 404, { ok: false, error: "unknown action" });
              return;
            }
            const payload = await readBody(req);
            if (payload === undefined) {
              send(res, 413, { ok: false, error: "payload too large" });
              return;
            }
            const result = await handler(payload);
            // handler 可返回 { code, body } 表示错误；否则按成功响应
            if (result !== null && typeof result === "object" && "code" in result && "body" in result) {
              send(res, result.code, result.body);
              return;
            }
            send(res, 200, result);
            return;
          }

          const key = `${req.method ?? "GET"}:${action}`;
          const handler = routes[key] ?? (action === "session" ? routes["GET:session"] : undefined);
          if (handler === undefined) {
            send(res, 404, { ok: false, error: "unknown action" });
            return;
          }
          send(res, 200, await handler());
        } catch (error) {
          void appendLog(`API_ERROR ${String(error)}`);
          send(res, 500, { ok: false, error: String(error) });
        }
      })();
    }
  });
}

function registerAssets(webServer) {
  return webServer.register({
    kind: "prefix",
    path: ASSET_PREFIX,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405);
            res.end();
            return;
          }
          const url = new URL(req.url ?? "/", "http://x");
          let fileName;
          try {
            fileName = decodeURIComponent(url.pathname.slice(ASSET_PREFIX.length + 1));
          } catch {
            res.writeHead(400);
            res.end();
            return;
          }
          const mime = ASSETS.get(fileName);
          if (mime === undefined) {
            res.writeHead(404);
            res.end();
            return;
          }
          // 白名单已排除 ../ 之类穿越，路径固定为包内 assets/
          const body = await readFile(new URL(`../assets/${fileName}`, import.meta.url));
          res.writeHead(200, {
            "content-type": mime,
            "cache-control": "public, max-age=86400"
          });
          res.end(req.method === "HEAD" ? undefined : body);
        } catch {
          res.writeHead(404);
          res.end();
        }
      })();
    }
  });
}

function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) {
    console.warn("[dsh-familiar-dsweb] webServer 服务不可用，端点未注册");
    return;
  }

  ctx.effect(() => {
    const disposeApi = registerApi(webServer);
    const disposeAssets = registerAssets(webServer);
    return () => {
      try {
        disposeApi();
      } catch {}
      try {
        disposeAssets();
      } catch {}
    };
  }, "dsh-familiar-dsweb: routes");

  console.info(`[dsh-familiar-dsweb] host 已加载，端点 ${API_PREFIX}，数据目录 ${dataDir()}`);
}

export { apply, inject, name };
