# dsh-familiar-dsweb · 小助手

DSH 桌面端的悬浮小助手：左侧栏入口 + 可拖拽悬浮窗，内嵌 DeepSeek 网页版。

> **当前版本：v1.0.0**
> 作者：[Corangam](https://github.com/Corangam)

---

## 一、缘起

> 本插件灵感来源于使用 dsh 的日常经历。有时候突然想起来要查个无关紧要的事，又不想污染当前任务窗口上下文，另外切一个 dsh 窗口，又没法盯着工作中的窗口，而且切来切去也烦，或者有时候遇到不懂的问题想随手查一下，又或者分开做任务需要一个随手记事本，抑或是一些问题没必要调用付费模型，但是专门打开浏览器又显得麻烦 …… 所以本插件应运而生。
>
> 本插件以可爱的蓝色大肥鱼为灵感，将其设定为陪伴你工作的小副手，随时可以在 dsh 里打开，内置一个网页版 deepseek，方便聊各种不想在 dsh 里聊的话题，建议将它缩小成手机屏幕大小状态的小悬浮窗。
>
> 这个插件的功能实现不算很难，但是外观美化费了不少劲，它可以随着 dsh 原生主题色变化而变化，我设计了两套主题，浅色的以青色白色和金色为主，联想到碧波荡漾的海边夏日阳光；深色的以蓝色黑色为主，有一种深海的深邃幻想的感觉，多带一些神秘感。（我个人比较喜欢用深色，这个插件也是先做的深色后再做的浅色）。 背景以透明气泡上浮带来一些活力，边框设计了模仿水流波动的动态效果。
>
> 希望这个小助手能陪伴各位的工作或者生活！
>
> 注：作者完全不懂写代码，所有的代码皆由 deepseek-v4.1-flash-1017 与 gemini 3.8 flash 实现，感谢两位的付出！
>
> 后续再有精力的话，会考虑再加上蓝色大肥鱼的 Q 版拟人形象，目前初步设计已经想好了，应该会让她趴在左上角漏个头，再在右下角露出个晃动的尾巴，不过能不能实现也是后续的事了，目前简洁版的也蛮好。

---

## 二、功能清单

| 功能 | 状态 | 说明 |
|---|---|---|
| 左侧栏入口 | ✅ | `sidebar.footer.action` 槽位，30×30 圆形头像 |
| 悬浮窗 | ✅ | 可拖动、四角缩放（最小 280×220），松手吸附最近边缘 |
| 位置/尺寸记忆 | ✅ | 存 `ui.json`，重启后恢复；窗口变小会自动夹回可视区 |
| 记住上次聊天页 | ✅ | 存 `lastUrl`，仅接受 `chat.deepseek.com` 域 |
| 登录态持久化 | ✅ | token 自存自注入，一次登录长期有效 |
| UA 伪装 | ✅ | 消除 DeepSeek 的「使用环境异常」警告 |
| 正文字号缩放 | ✅ | 60%–140%，只作用于正文容器，记忆到 `ui.json` |
| 深/浅主题跟随 | ✅ | 跟随 DSH 宿主主题，水波与玻璃同步换色 |
| 水波外框 | ✅ | Canvas 全周长涌浪 + 浪尖高光，深色/浅色两套渐变 |
| 悬停动效 | ✅ | 放大 + 蓝色光晕 + 左右摇摆 |

### 交互细节

- **悬停**：`scale(1.12)` + `#4D6BFE` 光晕 + `dshc-wiggle` 摇摆（9°→8°→6°→5°→3° 收势）
- **点击**：`scale(.92)`，打开面板
- **标题栏**：拖动移动；右侧按钮依次是 `A-` / 当前百分比（点击复位）/ `A+` / `⟳` 重新加载 / `×` 收起
- **快捷键**：`Ctrl/⌘ + =` 放大、`Ctrl/⌘ + -` 缩小、`Ctrl/⌘ + 0` 复位
  —— **仅在焦点位于面板内、且不在内嵌网页里时**生效；在 DSH 编辑器里按这些键不会误伤字号
- **缩放**：四角把手

---

## 三、技术架构

### 三层结构

```
DSH 桌面端
├─ Electron 主进程
│   └─ 提供 dshDesktop.browser.acquire / <webview> 租约校验
├─ Node host 进程
│   └─ lib/index.js（host 半区）
│       ├─ /dsh-companion/api?action=...   业务接口
│       └─ /dsh-companion/assets/...        图标静态资源
└─ 渲染进程（dsh-app://app）
    └─ lib/client.js（client 半区）
        ├─ 左侧栏入口按钮
        └─ 悬浮窗 + <webview>（createPortal 挂到 document.body）
```

### 接口一览

| 方法 | action | 说明 |
|---|---|---|
| GET | `ping` | 存活探针 |
| GET | `ui-state` | 读窗口位置/尺寸/字号/lastUrl |
| GET | `session` | 读登录态 |
| POST | `ui-state` | 合并写入（字段级），越界字号自动夹取 |
| POST | `save-session` | 写入登录态（字段带长度上限） |
| POST | `probe` | 诊断日志上报 |
| POST | `clear-session` | 清除登录态 |

请求体上限 1MB，超限返回 413；非法 JSON / 非对象返回 400。

### 关键实现点

1. **必须用 Electron `<webview>`，不能用 iframe**
   `chat.deepseek.com` 返回 `content-security-policy: frame-ancestors 'none'`

2. **webview 需要主进程租约**
   ```js
   const reservation = await dshDesktop.browser.acquire("dsh-companion");
   webview.setAttribute("name", reservation.lease);
   webview.setAttribute("partition", reservation.partition);
   webview.setAttribute("src", "about:blank#" + reservation.lease);
   ```

3. **登录态持久化**
   ```js
   const token = await webview.executeJavaScript("localStorage.getItem('userToken')");
   // 存到 host → 下次打开时注入 → reload
   ```

4. **面板必须 createPortal 到 body**
   侧边栏折叠动画带 `transform`，会让 `position:fixed` 的定位基准退化为侧边栏

5. **顶部必须留 52px**
   Electron 的 `titleBarOverlay` 是原生层，DOM 压不住（`z-index`、`-webkit-app-region:no-drag` 都无效）

6. **玻璃层必须独立于面板**
   `backdrop-filter` 若直接写在 `.dshc-panel` 上，会把内嵌 webview 一并拉进滤镜栈，
   部分 Electron 版本下表现为 webview 整块不显示

---

## 四、目录结构

```
dsh-companion/
├── package.json          # 包声明（v1.0.0）
├── cordis.patch.yml      # profile 插入声明
├── README.md             # 本文件
├── assets/
│   ├── icon.png          # 主图标
│   └── icon-48.png       # 备选
├── lib/
│   ├── index.js          # host：API + 静态资源路由
│   ├── client.js         # client：入口 + 悬浮窗 + 登录态
│   └── *.bak-*           # 历史备份（本机留档，不入包）
└── .backup/              # 版本回滚留档
```

> 打包时 `files` 只收 `lib/*.js`，`lib/` 下的历史备份不会进入产物。

---

## 五、安装

编辑 `~/.dsh/profiles/<profile>/package.json`：

```json
{
  "dependencies": { "dsh-companion": "link:<插件绝对路径>" },
  "dsh": { "profile": { "bundles": [ "...", "dsh-companion" ] } }
}
```

插件**不热重载**，改完必须重启 DSH 桌面端。

---

## 六、数据与日志

```
~/.dsh/plugin-data/dsh-companion/
├── session.json    # 登录态（明文 token + userInfo）
├── ui.json         # 窗口位置/尺寸 + lastUrl + fontScale
├── probe.log       # 诊断日志（上限 1MB，超限轮转为 probe.log.1）
└── probe.log.1     # 上一代日志
```

- `session.json` 里是**明文**登录凭证，请勿外传。
- 日志有 1MB 硬上限，超出自动轮转，不会无限增长。

### 诊断开关

关键生命周期事件（导航、登录态、字号回填）默认记录。明细负载（DOM 诊断、每次注入结果）
默认丢弃，需要排查时在控制台执行：

```js
localStorage.setItem("dshc-probe", "1");  // 打开，重开面板生效
localStorage.removeItem("dshc-probe");    // 关闭
```

---

## 七、已知限制

| 限制 | 原因 | 能否解决 |
|---|---|---|
| 不能拖到标题栏区域 | Electron `titleBarOverlay` 是 OS 级原生层 | ❌ 平台限制 |
| 不能飘出 DSH 窗口外 | 面板是渲染进程 DOM | ❌ 除非打补丁改主进程 |
| 重启后需重新登录 | webview 分区无 `persist:` 前缀 | ✅ 已用 token 自存解决 |
| 关闭再打开有加载间隔 | 每次重建 webview | ⚠️ 可优化为保活（v1.1 候选） |
| 正文缩放依赖 DeepSeek 类名 | 对方改版可能失配 | ⚠️ 失配时只停止缩放，不会报错 |

---

## 八、踩过的坑（重要）

1. **`process.env.DSH_HOME` 在 host 进程为空**
   → 用 `os.homedir() + '.dsh'` 兜底，否则写到 `profiles/<name>/.dsh/`

2. **`margin-left` 推不动 flex 子元素**
   → 外层容器 `width:100%` + `justify-content:flex-end`

3. **缓存与持久化必须成对更新**
   → 只写磁盘不更新内存缓存，下次打开读到的仍是旧值

4. **React `useEffect` 挂载必执行一次**
   → 写盘型 effect 必须用 ref 挡住首次

5. **`useState` 的 updater 必须是纯函数**
   → 把副作用写进 updater，StrictMode 下会重复执行或丢失

6. **内联样式优先级高于 `:hover`**
   → 常驻态的 `background:transparent !important` 会永久压死 hover 显底

7. **`color-scheme` 写在 `:root` 会污染宿主**
   → 必须收敛到本插件自己的选择器上

8. **`pointerup` 不是拖拽的唯一出口**
   → 指针被系统抢走时来的是 `pointercancel`，只监听 pointerup 会让监听器永久残留

---

## 九、回滚

每个文件的改动前版本都在同目录留了 `*.bak-v1.0-<时间戳>`：

```bash
cd <插件目录>/lib
cp client.js.bak-v1.0-20261112-1415 client.js
cp index.js.bak-v1.0-20261112-1415  index.js
```

重启 DSH 桌面端即回到改动前状态。

---

## 十、授权

本包由两套许可证分别覆盖，**两者都禁止商业使用**：

| 资产 | 许可证 | 说明 |
|---|---|---|
| 插件源码（`lib/`） | [PolyForm Noncommercial 1.0.0](./LICENSE) | 开源、可自由修改与再分发，**禁止任何商业用途** |
| 图标（`assets/`） | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | 第三方作品，需署名、非商业、相同方式共享 |

图标形象来自 [treapgogo/deepseek-whale-girl](https://treapgogo.github.io/deepseek-whale-girl/)，
作者 **treapgogo**。完整授权全文见
[`licenses/deepseek-whale-girl/`](./licenses/deepseek-whale-girl/)，
总声明见 [NOTICE](./NOTICE)。

如需商业授权，请通过 [GitHub Issues](https://github.com/Corangam/dsh-familiar-dsweb/issues) 联系作者。

---

## 十一、致谢

本插件的全部代码由以下两位 AI 助手协作完成（作者本人不写代码）：

- **deepseek-v4.1-flash-1017**
- **gemini 3.8 flash**

图标形象由 **treapgogo** 创作（[deepseek-whale-girl](https://treapgogo.github.io/deepseek-whale-girl/)）。

