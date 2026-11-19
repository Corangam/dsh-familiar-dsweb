# Changelog

本文件的版本号即 `package.json` 的 `version`。

---

## v1.0.1 — 2026-11-20 · 修复 npm 页面文档与检索元数据

**运行代码零改动**：`lib/index.js` 与 `lib/client.js` 与 v1.0.0 逐字节相同，
本次只修发布面（registry 上那份不会被 GitHub 更新自动同步的副本）。

### 修复

- **npm 页面上的 README 是旧版**
  registry 里的 README 是 v1.0.0 发布时刻（2026-11-12）的快照，此后 GitHub 上的修订
  从未同步。旧版没有「快速开始」，安装章节写的包名还是 `dsh-companion`（实际包名为
  `dsh-familiar-dsweb`），且指引为 `link:<本地路径>` —— 照它操作会装不上。
  本次随版重发，registry 上恢复为当前 README。
- **`package.json` 的 description 与 keywords 改为英文主词**
  原 description 为纯中文、keywords 仅 8 项，npm 搜索的中文分词失效，官方 search API
  实测三条查询（包名 / desktop companion / floating assistant）全部未命中。
  现 description 以英文主词开头、keywords 扩到 14 项，中文仅作尾注保留。

### 打包

- **备份文件不再混入发布包**
  `npm pack` 会无视 `.npmignore` 与 `files` 白名单强制收录 `README*`，
  放在包根目录的 `README.md.bak-*` 会被一并发布。备份已移入 `.backup/`。

### 已核对未改动

- 安装方式 `dsh plugin --profile <p> add dsh-familiar-dsweb` 实测可用：
  `dependencies` 与 `dsh.profile.bundles` 自动双双追加，无需手工编辑。
- 现有测试全绿：client 10/10、host 18/18。

---

## v1.0.0 — 2026-11-12 · 正式定稿

首个正式版。以「行为不变、缺陷清零」为原则做了一轮完整代码审查：
**没有改动任何配色、水波参数、布局与交互手感**，改动全部集中在资源占用、
并发安全、边界防护与可维护性。

### 运行时性能

- **主题同步不再每 500ms 无脑注入 guest**
  原实现每次巡检都无条件 `executeJavaScript`，面板开着等于每 500ms 往内嵌页面丢一次脚本
  （一小时七千余次）。现在只在主题**真正变化**时注入；导航后额外补注入一次，
  保证 SPA 重建 DOM 后主题类不丢。
- **诊断日志从"全量"改为"关键事件 + 按需明细"**
  实测 `probe.log` 在一个会话内涨到 3.3MB / 8445 行，其中 `panel.font-scale`(2261)、
  `diag.transparent`(1878)、`diag.raw`(1585) 三类明细占了绝大部分。
  现在明细默认丢弃，需要时 `localStorage.setItem("dshc-probe","1")` 打开；
  生命周期关键事件仍然始终记录。

### 资源与稳定性

- **`probe.log` 增加 1MB 硬上限并自动轮转**（`probe.log.1`），不再无限增长。
- **拖拽/缩放会话补齐 `pointercancel` 出口**
  指针被系统抢走（切窗口、触摸板手势中断）时浏览器发的是 `pointercancel`，
  原实现只监听 `pointerup`，会导致 `pointermove` 永久挂在 `window` 上 —— 之后鼠标一动面板就跟着跑。
- **原子写失败时清理临时文件**，不再在数据目录留 `.tmp-*` 残骸。
- **面板打开后首帧重新夹取坐标**，窗口在面板关闭期间被缩小/最大化也不会在视口外"隐形打开"。

### 正确性

- **快捷键作用域收窄到面板内部**
  原实现只挡住了内嵌 webview，用户在 DSH 编辑器里按 `Ctrl +/-/0` 会顺手改掉小助手的字号并存盘。
  现在只在焦点位于面板内、且不在内嵌网页里时生效。
- **`color-scheme:light` 从 `:root/html/body` 收敛到本插件自己的选择器**
  原写法会污染整个 DSH 宿主文档的滚动条与原生控件配色。
- **host 请求体增加 1MB 上限**，超限返回 **413**；非法 JSON / 非对象返回 **400**
  （原实现只有空体判 400，畸形数据会被当成空对象继续写盘）。
- **登录态字段增加长度上限**（token 8K / userInfo 64K / origin 512 / note 256），
  异常数据截断而不是整体拒绝，避免用户莫名丢登录态。
- **删除重复声明的 `getDshHostTheme`**，补回缺失的函数注释。
- 源码整洁：修正 `CompanionPanel` 缩进、去掉重复注释、统一 `rename` 的静态导入。

### 打包

- `files` 由 `"lib"` 收窄为 `"lib/*.js"`。
  原配置会把 `lib/` 下 51 个历史备份（4.4MB）一起打进产物；现在只收
  `client.js` / `index.js`，产物 70.3KB → **67.0KB**，解包 251.2KB → **245.0KB**。

### 安全与并发（第二轮：独立对抗式复审后修复）

- **`isChatUrl` 由字符串前缀改为 origin 精确比对**（client 与 host 两侧同时修）
  `"https://chat.deepseek.com.evil.test/"` 以合法域名开头，却完全是第三方站点。
  这个值直接决定 webview 的导航目标与登录凭证的注入点，判断一松就能把 token
  写进别人的 localStorage。host 侧 `patchUiState` 同样改为 `new URL().origin` 校验。
- **注入登录令牌前增加同源闸门**
  写 token 之前先取 `element.getURL()`，不是 `chat.deepseek.com` 就跳过并记
  `panel.inject-skipped`。正常流程走不到这里（导航目标已被过滤），
  但 webview 开了 `allowpopups`，不该让任何意外跳转成为泄密通道。
- **`clear-session` 纳入 `SESSION_FILE` 写队列**
  原实现直接 `rm`，与排队的 `save-session` 是两条时间线：并发时会出现
  「已经清除成功，却被排队中的保存又写回来」—— 看起来清了，凭证其实还在盘上。
- **`bridge.acquire()` 期间卸载不再泄漏租约**
  原先 `leaseRef` 在 `disposed` 检查之后才赋值，而补偿分支又要求
  `disposed === true`，两条路都够不着。现在先登记租约再做检查。

### 交互正确性（第二轮）

- **错误遮罩现在真的能靠 ⟳ 恢复**
  原实现 `⟳` 只调 `webview.reload()`：页面确实重载了，但
  `.dshc-overlay`（`inset:0; z-index:4`）仍盖在上面，用户看到的还是
  「请点击右上角刷新重试」，只能关掉面板重开。现在 `⟳` 会清掉遮罩并重跑
  整条 `open()`；同时加了重入序号，连点也不会让两轮流程互相踩踏。
- **拖动/缩放收尾存盘不再丢最后一帧**
  `boxRef` 只由 `[box] effect` 刷新，若"停止移动"与"松手"落在同一帧内，
  节流回调还没执行，存盘写的是拖动前的旧坐标 —— 表现为「下次打开尺寸自己跳回去」。
  现在收尾一律用最后一次指针位置重算。
- **导航回调不再跑整套全文档改写**
  `did-navigate-in-page` 是 SPA 高频事件，原来每次都调 `applyFontScale`，
  连带把 `querySelectorAll('div,span,button,a,li')` 逐节点写内联样式的
  全文档流程跑一遍，两次运行还可能交叠。现在只补那一条字号 `<style>` 与主题类。
- **删除"干净状态诊断"**
  它先执行 `makeTransparentJs()`（本身就会插样式、写内联样式），再去测量
  "未改动前"的样子 —— 逻辑上不可能成立，却在每次改字号/每次导航时都多跑一遍。

### 回归修正（第三轮：主人反馈「主对话多了两个框框」）

- **恢复导航后的页面清洗**
  上一轮我把 `applyFontScale` 开头那次 `makeTransparentJs()` 当作「先改页面再测页面」的
  无效诊断删掉了。**判断错了**：诊断意图确实不成立，但那个副作用是真在干活 ——
  「深度思考」折叠框、对话框边框、代码卡片底色全靠它逐节点清掉。
  删掉之后，SPA 切会话重建节点，这些框就重新冒出来。
  现已正名为 `ensureGuestSkin()` 并在三处调用：改字号时、页面跳转后、首屏加载后。
- **恢复主题巡检的每次注入**
  `syncThemeToWebview` 除加主题类外，还负责清洗 guest 页面对话框里的按钮外观。
  只在主题变化时注入，会让这层清洗在页面重建后失效 —— 已恢复每次 500ms 巡检都注入。
- **字号重刷改为有界两次**
  原实现借 `applyFontScale` 顺带跑完整 7 次重试；现在导航回调只做有界两次
  （立刻一次 + 未命中时 600ms 后补一次），避免高频导航事件上互相交叠。

### 验证

- host 半区功能测试 **18/18 通过**（`test/host.api.test.mjs`，隔离数据目录；
  覆盖并发写不丢字段、字号夹取、URL 白名单（含前缀伪造绕过）、400/413/404 分支、
  token 截断、清登录态、clear/save 并发、日志轮转、无 `.tmp` 残留）。
- client 半区启动测试 **10/10 通过**（`test/client.boot.test.mjs`，VM 桩环境：
  模块可执行、`__ModuleLoader__.load` 参数正确、槽位注册与元数据正确）。
- 深色主题外观零改动：水波渐变、玻璃底、气泡、按钮配色均未触碰。

---

## v0.1.0 — 2026-11-02

首个可用版本：左侧栏入口、可拖拽悬浮窗、位置/尺寸记忆、登录态持久化、
UA 伪装、正文字号缩放、深浅主题跟随、水波外框。
