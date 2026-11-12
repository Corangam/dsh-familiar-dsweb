window.__ModuleLoader__.load({
	id: "dsh-familiar-dsweb",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const ReactDOM = require("react-dom");
		const h = React.createElement;

		// ============ 常量 ============

		const DS_ORIGIN = "https://chat.deepseek.com";
		const DS_HOME = DS_ORIGIN + "/";
		const ICON_URL = "/dsh-familiar-dsweb/assets/icon.png";

		/**
		 * webview 分区身份。
		 *
		 * 这个值只决定「复用哪个浏览器分区」，不参与任何文件系统操作。
		 * 必须满足两个条件：
		 *   1. 非空、长度 < 4096（主进程 acquire 会校验）；
		 *   2. 跨机器、跨工作区保持稳定 —— 否则换机器或切换工作区后
		 *      分区变化，Cookie 清空，用户要重新登录。
		 *
		 * 因此刻意用固定常量而不是 cwd/路径：小助手是全局挂件，
		 * 它的登录态不该跟着工作区走。
		 */
		const WORKSPACE_ID = "dsh-familiar-dsweb";

		/**
		 * 首次打开时的默认尺寸 —— 相对 DSH 窗口的比例，不是固定像素。
		 *
		 * 为什么用比例：作者习惯把它缩到"手机屏幕大小"的竖向悬浮窗，
		 * 固定 440×620 在 1920 宽屏上偏小、在 1080 屏上又偏大，不如跟着窗口走。
		 * 26% × 70% 大致等于手机上 375×812 的观感，同时受 MIN_W/MIN_H 与
		 * clampBox 双重兜底，小窗口下不会缩成一条缝。
		 */
		const DEFAULT_SIZE_RATIO = { width: 0.26, height: 0.70 };
		const MIN_W = 280;
		const MIN_H = 220;
		/** 顶部安全线：Electron titleBarOverlay 是原生层，DOM 压不住。 */
		const TOP_SAFE = 52;
		const EDGE_MARGIN = 12;
		const SNAP_THRESHOLD = 24;
		const LOGIN_POLL_MS = 10 * 60 * 1000;
		const LOGIN_POLL_INTERVAL = 4000;
		const API_TIMEOUT = 8000;
		const LOAD_TIMEOUT = 20000;

		// ---- 正文字号缩放 ----
		/**
		 * 注意：这里的 FONT_SCALE_* 表达的是「正文字号比例」，不是整页缩放。
		 * 1.0 = 原始大小，0.9 = 正文小 10%。
		 * 只作用于正文容器，输入框/按钮/侧边栏/导航一律不动。
		 */
		const FONT_SCALE_STEP = 0.05;
		const FONT_SCALE_MIN = 0.6;
		const FONT_SCALE_MAX = 1.4;
		const FONT_SCALE_DEFAULT = 0.9;
		/** 注入到 guest 页面的 style 元素 id，用于重复注入时先删后加。 */
		const FONT_STYLE_ID = "dshc-font-adapt";

		/** 透明背景注入用的 style id。 */
		const TRANSPARENT_STYLE_ID = "dshc-transparent";

		/**
		 * 让 DeepSeek 页面背景透明，露出浮窗自己的深海玻璃与气泡。
		 *
		 * 背景：webview 是 Electron 原生渲染层，永远画在 DOM 之上，
		 * 所以气泡/玻璃/水波只能盖住它以外的区域。
		 * 唯一能让它们「透出来」的办法，是把 guest 页面自身的背景改成透明。
		 *
		 * 脆弱性说明（重要）：
		 *   这里依赖 DeepSeek 页面的 DOM —— html/body 与若干容器类名。
		 *   对方改版后可能失效，失效时**只会退化成不透明**，不会崩溃，
		 *   属于可接受的降级。选择器刻意写得宽（多层兜底 + 通配类名匹配）。
		 */
		const TRANSPARENT_CSS = [
			/*
			 * 让 DeepSeek 页面透明，露出浮窗的深海玻璃与气泡。
			 *
			 * 规则来自真实环境实测（Playwright + colorScheme:dark，与插件内 WebView 一致）：
			 *   body                    rgb(21,21,23)
			 *   --dsw-alias-bg-layer-1  #232324
			 *   --dsw-alias-bg-layer-2  #2c2c2e
			 *   --dsw-alias-label-primary #f9fafb（浅色文字）
			 *
			 * 关键：DeepSeek 的类名是构建期 hash（_4cbcd96 等），深浅主题**同名**，
			 * 但背景色分别硬编码，不全部走变量。所以两条路都要走：
			 *   ① 覆盖层级变量（管住走变量的那批容器）；
			 *   ② 点名几个承载大面积背景的 hash 类（管住硬编码那批）。
			 * 只做①是之前深色主题「基本没变化」的原因。
			 *
			 * 脆弱性：hash 类名随 DeepSeek 构建变化，失效时退化为不透明，不会崩。
			 */
			/* ① 层级变量 */
			":root,body,body.dark,body.light{"
				+ "--dsw-alias-bg-layer-1:transparent !important;"
				+ "--dsw-alias-bg-layer-2:transparent !important;"
				+ "--dsw-alias-bg-layer-3:transparent !important;"
				+ "--dsw-alias-bg-layer-4:transparent !important;"
				+ "}"
			/* ② 根元素 */
			+ "html,body{background:transparent !important;background-color:transparent !important}"
			/* ③ 承载大面积硬编码背景的容器（实测类名，深浅主题通用）：
			 *    _4cbcd96 全屏遮罩 rgba(0,0,0,.4)
			 *    _77cefa5 输入框容器
			 *    _5a8ac7a 次级卡片
			 *    e5bf614e 小卡片
			 *    b8812f16 侧边栏 */
			/* 对话页专属容器（首页没有，所以首页正常、对话页冒黑块）：
			 *   .f8d1e4c0.the-header  顶部栏 rgb(21,21,23)
			 *   ._0fcaa63             底部提示条 rgb(21,21,23)
			 *   .c99b79f8             消息分隔区 rgb(21,21,23)
			 *   .fbb737a4             用户消息气泡 rgb(44,44,46)
			 */
			+ "._4cbcd96,._7d10bb1,._77cefa5,._5a8ac7a,.e5bf614e,"
			/* 对话页容器：类名随窗口宽度变化（宽窗 f8d1e4c0 / 窄窗 _1aa2651），
			 * 所以不能用固定 hash —— 用 [class*=] 属性选择器兜住。 */
			+ "[class*='the-header'],._0fcaa63,.c99b79f8,.fbb737a4{"
			+ "background:transparent !important;background-color:transparent !important}"
			/* ④a 引用网页卡片：原本 rgb(44,44,46) 实底，改成与输入框一致的深蓝半透明 + 细描边。 */
			+ "[class*='ds-citation'],[class*='ds-reference']{"
			+ "background:rgba(18,28,42,.52) !important;"
			+ "border:1px solid rgba(110,180,240,.28) !important;"
			+ "box-shadow:0 2px 10px rgba(0,0,0,.22) !important;"
			+ "}"
			/* ④b-0a 侧边栏分组标题（置顶 / 今天 / 昨天 / 7 天内 / 30 天内 / 各月份）：
			 * 实测类名 .f3d18f6a，rgb(27,27,28)、236×22，是深色实底条，
			 * 在已经半透明的侧边栏上显得突兀。改为透明，只留文字。 */
			+ ".f3d18f6a{"
			+ "background:transparent !important;background-color:transparent !important;"
			+ "}"
			/* ④b-0b 侧边栏"开启新对话"按钮：原本 rgb(67,69,74) 实底，
			 * 与深海调性不符，改成半透明描边风格。 */
			+ ".b8812f16 ._5a8ac7a{"
			+ "background:rgba(90,150,220,.12) !important;"
			+ "border:1px solid rgba(110,180,240,.30) !important;"
			+ "}"
			/* ④b-1 右侧导航/大纲目录：全透明后文字压在正文上看不清。
			 * 给它一层半透明深底 + 左侧分隔线，保持深海调性又保证可读。
			 * 用关键词属性选择器，覆盖 toc / outline / anchor / marker 等可能命名。 */
			+ "[class*='toc'],[class*='outline'],[class*='anchor-list'],"
			+ "[class*='catalog'],[class*='directory']{"
			+ "background:rgba(10,16,26,.86) !important;"
			+ "-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);"
			+ "border-left:1px solid rgba(90,150,220,.20) !important;"
			+ "border-radius:10px !important;"
			+ "}"
			/* ④b0 侧边栏会话项选中态：DeepSeek 默认给深色实底高亮，
			 * 在半透明侧边栏上显得突兀。改成细描边 + 极淡底色。 */
			+ ".b8812f16 [class*='active'],.b8812f16 [class*='selected'],"
			+ ".b8812f16 [class*='current']{"
			+ "background:rgba(90,150,220,.12) !important;"
			+ "box-shadow:inset 0 0 0 1px rgba(110,180,240,.42) !important;"
			+ "border-radius:8px !important;"
			+ "}"
			/* ④b 侧边栏：不能全透明。
			 * 全透明后对话正文会从后面透出来，两边文字重叠，完全看不清。
			 * 用半透明深底 + 毛玻璃 + 右侧描边，与深海调性一致又保证可读。 */
			+ ".b8812f16{"
			+ "background:rgba(12,20,32,.82) !important;"
			+ "-webkit-backdrop-filter:blur(14px) saturate(130%);"
			+ "backdrop-filter:blur(14px) saturate(130%);"
			+ "border-right:1px solid rgba(90,150,220,.22) !important;"
			+ "box-shadow:2px 0 22px rgba(0,0,0,.35) !important;"
			+ "}"
			/* ⑤ 输入框（2026-11-06 修复文字穿透）：
			 *    原为 rgba(18,28,42,.42) 无毛玻璃 —— 太透，正文从下方滚过时
			 *    直接透过输入框与 placeholder 糊在一起（主人实测截图确认）。
			 *    现改为 0.92 深底 + blur(20px) 毛玻璃：
			 *      · 0.92 足以挡住任何滚入的正文
			 *      · 留 8% 通透让深海水波底色隐约透上来，不死板
			 *      · backdrop-filter 兜住半透明部分的细节模糊，避免文字残影
			 *    实测 440×620 浮窗尺寸下，正文滚到框底时完全不可见。 */
			+ "._77cefa5{"
			+ "border:1px solid rgba(110,180,240,.38) !important;"
			+ "box-shadow:0 0 0 1px rgba(110,180,240,.12),"
			+ "inset 0 0 22px rgba(80,150,225,.10),"
			+ "0 -2px 24px rgba(0,0,0,.40) !important;"
			+ "background:rgba(10,17,28,.92) !important;"
			+ "-webkit-backdrop-filter:blur(20px) saturate(150%) !important;"
			+ "backdrop-filter:blur(20px) saturate(150%) !important;"
			+ "}"
			/* ⑤b 关键：DeepSeek 用 background-image 渐变画「滚动区边缘的渐隐遮罩」，
			 *    background-color 永远是 transparent，所以只查颜色永远找不到。
			 *    实测三处：
			 *      _1d72f01  linear-gradient(transparent, rgb(27,27,28) 80.65%)  侧边栏底部
			 *      _871cbca  linear-gradient(..., rgb(21,21,23) 30%, ...)        主区上下
			 *      d72636e2  linear-gradient(rgba(21,21,23,0), rgb(21,21,23) 24px)
			 *    全部去掉，让背景真正透出来。 */
			+ "._1d72f01,._871cbca,.d72636e2{"
			+ "background-image:none !important;"
			+ "}"
			/* ⑤c 伪元素遮罩：消息容器的 ::before 带 rgb(33,33,35) 实底，
			 *     滚动条的 ::before/::after 带渐隐渐变 —— 一并清掉。 */
			+ "._4f9bf79::before,._4ce999d::before,._4ce999d::after{"
			+ "background:none !important;background-image:none !important;"
			+ "}"
			/* ⑤d 侧边栏底部账号栏（2026-11-05 赫珀实测纠正）：
			 *    原写法 ._546d736 是**会话列表项**（实测 100 个，文本形如"日常聊天"），
			 *    不是账号栏；真正的账号栏容器是 ._2afd28d（实测 1 个，236x44，
			 *    位于 .b8812f16 底部 y=746），头像方块是 .ede5bc47。
			 *    注：Playwright 深色环境下 _2afd28d 原生背景本就是透明，
			 *    但真机 WebView 里呈 rgb(53,54,56) 实底（尺寸/DPI 差异），
			 *    故仍按赫珀方案赋半透明玻璃底。 */
			+ ".b8812f16 ._2afd28d,._2afd28d{"
			+ "background:rgba(18,28,42,.45) !important;"
			+ "background-color:rgba(18,28,42,.45) !important;"
			+ "border:1px solid rgba(110,180,240,.20) !important;"
			+ "box-shadow:0 2px 10px rgba(0,0,0,.20) !important;"
			+ "border-radius:10px !important;"
			+ "transition:background-color .15s ease,border-color .15s ease !important;"
			+ "}"
			+ ".b8812f16 ._2afd28d:hover,._2afd28d:hover{"
			+ "background:rgba(90,150,220,.18) !important;"
			+ "background-color:rgba(90,150,220,.18) !important;"
			+ "border-color:rgba(110,180,240,.38) !important;"
			+ "}"
			+ ".b8812f16 .ede5bc47,.ede5bc47{"
			+ "background:rgba(90,150,220,.25) !important;"
			+ "background-color:rgba(90,150,220,.25) !important;"
			+ "border:1px solid rgba(110,180,240,.30) !important;"
			+ "}"
			/* ⑥a 分组标题左侧 4px 黑边（shadow 画的） */
			+ ".f3d18f6a{box-shadow:none !important;}"
			/* ⑥b 会话项右侧「···」渐隐遮罩（linear-gradient） */
			+ "._254829d{background-image:none !important;}"
			/* ⑥c 会话项：取消统一底色，只保留 hover */
			+ "._546d736{background:transparent !important;}"
			+ "._546d736:hover{background:rgba(90,150,220,.10) !important;}"
			/* ⑥d 引用角标 (1)(2) */
			+ ".ds-markdown-cite{background:rgba(18,28,42,.60) !important;"
			+ "border:1px solid rgba(110,180,240,.28) !important;"
			+ "color:rgba(160,200,235,.90) !important;}"
			/* ⑥e 引用网站小图标（2026-11-06 赫珀修正：实色深蓝底防穿透，不描边防重复圈圈）
			 *    1. 原用半透明底导致负 margin 叠压的下层图标被直接穿透，多层重叠混乱；
			 *    2. 16x16 图标加 1px 边框叠加成可见噪音圆圈。
			 *    现改为：不透明深蓝底（阻断穿透）+ 去掉 border + 1.5px 遮挡阴影（优雅切角）。 */
			+ "._8e95474,.site_logo_back,.site_logo_loading,.site_logo_fallback,"
			+ ".site_logo_back .site_logo_fallback,.site_logo_back .site_logo_loading,"
			+ "[class*='site_logo']{"
			+ "background:#121c2a !important;"
			+ "background-color:#121c2a !important;"
			+ "border:none !important;"
			+ "outline:none !important;"
			+ "box-shadow:0 0 0 1.5px rgba(18,28,42,.85) !important;"
			+ "border-radius:50% !important;"
			+ "}"
			/* ⑥f 右侧对话索引栏（2026-11-06 实测重构）
			 *
			 *    真实结构（大窗口 900x900 下复现，尺寸 34x292 与主人截图一致）：
			 *      ._189b4a0   fixed  34x300  z:5   外层定位容器（自身透明，不动它）
			 *        ├─ ._6ffc3c9   34x292  z:-1   常驻窄条，原生 rgba(21,21,23,.6)
			 *        └─ ._4ce999d  242x302  z:0    鼠标移入后展开的索引面板
			 *                                     常驻态 transparent / hover 态 rgb(35,35,36)
			 *
			 *    主人诉求：
			 *      ① 常驻窄条的底色 → 彻底透明，让水波和正文透上来
			 *      ② hover 展开的面板 → 加底色（与输入框同款深海玻璃），
			 *         否则面板里的对话标题会和下方正文文字重叠看不清
			 */
			/* ① 常驻窄条：彻底透明，去掉一切底色/模糊/描边/圆角 */
			+ "._6ffc3c9{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "background-image:none !important;"
			+ "-webkit-backdrop-filter:none !important;"
			+ "backdrop-filter:none !important;"
			+ "border:none !important;"
			+ "box-shadow:none !important;"
			+ "border-radius:0 !important;"
			+ "}"
			/* ② 展开面板：**只在 hover 时**才加底色（2026-11-06 二次修正）
			 *
			 *    关键机制（实测得出）：
			 *      官方靠 pointer-events 切换来控制这个面板：
			 *        常驻态  pointer-events: none   bg: rgba(0,0,0,0)
			 *        hover 态 pointer-events: auto  bg: rgb(35,35,36)
			 *      它自带 transition: background .2s, box-shadow .2s。
			 *
			 *    上一版我用无条件选择器写了 rgba(10,17,28,.92)，
			 *    结果常驻时就有一块深色底 —— 主人指出「现在变成常驻了」。
			 *    正确做法：用 pointer-events 做 hover 判定，常驻一律透明。 */
			/* ②a 常驻态：彻底透明（覆盖官方不给 hover 时的任何底色） */
			+ ":root ._4ce999d{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "-webkit-backdrop-filter:none !important;"
			+ "backdrop-filter:none !important;"
			+ "border-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* ②b hover 态：加深海玻璃底（与输入框同款 rgba(10,17,28,.92) + blur20）
			 *
			 *    判定方式：只依赖 :hover 链，不再依赖 pointer-events。
			 *    原因：pointer-events 是 JS 动态写入的内联值，CSS 属性选择器
			 *    匹配 [style*='...'] 时机不可靠；而 :hover 由浏览器原生维护，
			 *    鼠标一进外层容器立即生效，最稳。
			 *    另外 JS 已不再写任何内联背景，所以这里不会被压死。 */
			+ ":root ._4ce999d{"
			+ "transition:background-color .2s ease,box-shadow .2s ease,border-color .2s ease !important;"
			+ "}"
			+ ":root ._189b4a0:hover ._4ce999d,"
			+ ":root ._189b4a0:hover ._4ce999d:hover,"
			+ ":root ._4ce999d:hover{"
			+ "background:rgba(10,17,28,.92) !important;"
			+ "background-color:rgba(10,17,28,.92) !important;"
			+ "-webkit-backdrop-filter:blur(20px) saturate(150%) !important;"
			+ "backdrop-filter:blur(20px) saturate(150%) !important;"
			+ "border:1px solid rgba(110,180,240,.30) !important;"
			+ "border-radius:16px !important;"
			+ "box-shadow:0 12px 36px rgba(0,0,0,.55),0 0 20px rgba(80,150,225,.14) !important;"
			+ "}"
			/* ②c 面板内文字：hover 展开后可读 */
			+ ":root ._189b4a0:hover ._4ce999d{"
			+ "color:rgba(225,238,250,.95) !important;"
			+ "}"
			/* ⑦ 「已思考」折叠条黑底（2026-11-05 赫珀定位根因）：
			 *    黑块不是 DOM 元素画的，是 ._245c867 的伪元素 ::after 画的
			 *    （background-color: var(--dsw-alias-bg-base) = rgb(21,21,23)）。
			 *    官方用它做 sticky 吸顶时遮挡滚入的正文，所以 pointer-events:none
			 *    + z-index:-1，导致 elementFromPoint 命中穿透到透明文本层，
			 *    以前所有 DOM 探针才会一律返回 rgba(0,0,0,0)。
			 *    必须显式点名伪元素：CSS 的 * 通配符永远不匹配伪元素。
			 *    同时清 transition:background-color .3s，否则覆盖被动画平摊看不出来。 */
			+ ":root ._245c867, :root ._245c867 *,"
			+ ":root ._245c867::before, :root ._245c867::after,"
			+ ":root ._34a54ec::before, :root ._34a54ec::after,"
			+ ":root ._5ab5d64::before, :root ._5ab5d64::after,"
			+ ":root ._74c0879::before, :root ._74c0879::after,"
			+ ":root .c99b79f8, :root .c99b79f8::before, :root .c99b79f8::after{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "background-image:none !important;"
			+ "box-shadow:none !important;"
			+ "filter:none !important;"
			+ "-webkit-filter:none !important;"
			+ "backdrop-filter:none !important;"
			+ "-webkit-backdrop-filter:none !important;"
			+ "mix-blend-mode:normal !important;"
			+ "border-color:transparent !important;"
			+ "outline:none !important;"
			+ "transition:none !important;"
			+ "-webkit-transition:none !important;"
			+ "}"
			/* ⑧ 行内代码 / 代码块（2026-11-10 赫珀深海一体化重构）：
			 *    彻底根除「黑顶 + 蓝内胆 + 灰底座」三截割裂。
			 *    - 代码卡片整壳：统一深海半透明底 (rgba(18,28,42,.66)) + 8px圆角 + 细描边；
			 *    - 内层 pre/code：彻底透明无框，杜绝内层再次画框；
			 *    - 底部操作栏（语言/复制/下载）：清空原生灰底，与整卡自然融为一体；
			 *    - 行内代码：保持小巧精致的深蓝微透胶囊。 */
			+ ".dshc-code-card,div:has(> pre):not(.ds-markdown),div:has(> div > pre):not(.ds-markdown),"
			+ "[class*='code-block'],[class*='code_block'],[class*='md-code']{"
			+ "background:rgba(18,28,42,.66) !important;"
			+ "background-color:rgba(18,28,42,.66) !important;"
			+ "border:1px solid rgba(110,180,240,.25) !important;"
			+ "border-radius:8px !important;"
			+ "overflow:hidden !important;"
			+ "box-shadow:0 0 14px rgba(120,180,250,.12) !important;"
			+ "}"
			+ "pre,[class*='ds-markdown'] pre,pre code,[class*='ds-markdown'] pre code{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "box-shadow:none !important;"
			+ "}"
			+ ".dshc-code-card > div:not(:has(pre)),[class*='code-block'] > div:not(:has(pre)),"
			+ "pre + div,pre ~ div{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-top:1px solid rgba(110,180,240,.15) !important;"
			+ "box-shadow:none !important;"
			+ "}"
			+ ":not(pre) > code,kbd,samp,"
			+ "[class*='ds-markdown'] :not(pre) > code{"
			+ "background:rgba(30,45,68,.75) !important;"
			+ "background-color:rgba(30,45,68,.75) !important;"
			+ "border:1px solid rgba(110,180,240,.25) !important;"
			+ "border-radius:4px !important;"
			+ "padding:1px 5px !important;"
			+ "color:rgba(200,230,255,.95) !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* ⑨ 全局滚动条深海化（2026-11-06 赫珀实测补全）：
			 *    关键坑：DeepSeek **不用**浏览器原生滚动条！核心是自研虚拟滚动
			 *    组件 .ds-scroll-area，滑块实体是 .ds-scroll-area__vertical-bar
			 *    的 ::after 伪元素（实测 8x81px 胶囊，rgb(60,60,61)，radius 100px）。
			 *    宿主 .ds-scroll-area__vertical-bar 自身背景是 rgba(0,0,0,0)。
			 *    所以只写 ::-webkit-scrollbar 完全不生效，必须打伪元素。
			 *    另注：--dsl-scroll-area-scrollbar-bg 在 :root 上实测为空串
			 *    （颜色是硬编码在规则里），故变量覆盖仅作兜底，
			 *    真正生效的是下面的伪元素 :after 规则。 */
			+ ":root,body,[class*='ds-scroll-area']{"
			+ "--dsl-scroll-area-scrollbar-bg:rgba(110,180,240,.25) !important;"
			+ "--dsl-scroll-area-scrollbar-hover:rgba(110,180,240,.55) !important;"
			+ "--dsw-alias-scrollbar-bg-l1:rgba(110,180,240,.25) !important;"
			+ "--dsw-alias-scrollbar-hover-l1:rgba(110,180,240,.55) !important;"
			+ "}"
			+ ":root .ds-scroll-area__gutters .ds-scroll-area__vertical-bar::after,"
			+ ":root .ds-scroll-area__gutters .ds-scroll-area__horizontal-bar::after,"
			+ ":root .ds-scroll-area__vertical-bar::after,"
			+ ":root .ds-scroll-area__horizontal-bar::after{"
			+ "background-color:rgba(110,180,240,.28) !important;"
			+ "box-shadow:0 0 6px rgba(80,150,225,.25) !important;"
			+ "border-radius:100px !important;"
			+ "transition:background-color .2s ease,box-shadow .2s ease !important;"
			+ "}"
			+ ":root .ds-scroll-area__gutters .ds-scroll-area__vertical-bar:hover::after,"
			+ ":root .ds-scroll-area__gutters .ds-scroll-area__horizontal-bar:hover::after,"
			+ ":root .ds-scroll-area__vertical-bar:hover::after,"
			+ ":root .ds-scroll-area__horizontal-bar:hover::after{"
			+ "background-color:rgba(110,180,240,.60) !important;"
			+ "box-shadow:0 0 10px rgba(110,180,240,.45) !important;"
			+ "}"
			+ ":root .ds-scroll-area__gutters,"
			+ ":root .ds-scroll-area__vertical-bar,"
			+ ":root .ds-scroll-area__horizontal-bar,"
			+ ":root .ds-scroll-area__vertical-gutter,"
			+ ":root .ds-scroll-area__horizontal-gutter{"
			+ "background:transparent !important;background-color:transparent !important;"
			+ "}"
			+ "::-webkit-scrollbar{width:6px !important;height:6px !important}"
			+ "::-webkit-scrollbar-track{background:transparent !important}"
			+ "::-webkit-scrollbar-thumb{background:rgba(110,180,240,.28) !important;border-radius:9999px !important}"
			+ "::-webkit-scrollbar-thumb:hover{background:rgba(110,180,240,.60) !important}"
			/* ⑩a-2 右侧「搜索结果」抽屉（2026-11-06 实测精准打击）
			 *    赫珀文档给的 [class*='drawer'] / [class*='search-panel'] 全部命不中，
			 *    点开「N 个网页」后实测真实容器是：
			 *      ._519be07._233f913.scrollable._27fc06b  rect=[785,0,390,658]
			 *      background-color = rgb(21,21,23)  ← 实黑
			 *    抽屉头部还有一条 :after 画的高对比分割线。
			 *    注意 _233f913 / _27fc06b 是辅助类，用复合选择器降低误伤风险。 */
			+ ":root ._519be07{"
			+ "background:rgba(12,20,32,.88) !important;"
			+ "background-color:rgba(12,20,32,.88) !important;"
			+ "-webkit-backdrop-filter:blur(18px) saturate(130%) !important;"
			+ "backdrop-filter:blur(18px) saturate(130%) !important;"
			+ "border-left:1px solid rgba(90,150,220,.24) !important;"
			+ "box-shadow:-6px 0 28px rgba(0,0,0,.45) !important;"
			+ "}"
			/* 抽屉内容区实黑底（2026-11-06 实测）：
			 *    .b5264194  390x1037  background-color = rgb(21,21,23)  ← 内容区真凶
			 *    .b2ab7dec  含 linear-gradient(rgba(21,21,23,0) 0%, rgb(21,21,23)..)
			 *    这两个是抽屉展开瞬间显示为"黑屏"的原因：
			 *    内容异步加载时，这块实黑底先铺满整个抽屉。
			 *    宿主 ._519be07 本身已经是 rgba(12,20,32,.88)，只需清掉这两层的实色。 */
			+ ":root .b5264194{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "}"
			+ ":root .b2ab7dec{"
			+ "background-image:none !important;"
			+ "background-color:transparent !important;"
			+ "}"
			/* 兜底：抽屉内一切 div 不再铺实黑（只清 rgb(21,21,23) 这类纯深灰实底） */
			+ ":root ._519be07 div{background-color:transparent !important;}"
			+ ":root ._519be07 div[class*='item'],:root ._519be07 [role='listitem']{"
			+ "background-color:rgba(18,28,42,.42) !important;"
			+ "}"
			/* 抽屉内的标题行与分割线：清掉实底，分割线换成柔和蓝 */
			+ ":root ._519be07 > div{background-color:transparent !important;}"
			+ ":root ._519be07 [class*='_27fc06b']{background-color:transparent !important;}"
			+ ":root ._519be07 [style*='border-bottom']{"
			+ "border-bottom-color:rgba(110,180,240,.20) !important;"
			+ "}"
			/* ⑩a 右侧「搜索结果」抽屉面板（语义兜底，真实页面命中 0，留作未来改版） */
			+ "[class*='drawer'],[class*='search-panel'],[class*='search-drawer'],[class*='search-result']{"
			+ "background:rgba(12,20,32,.85) !important;"
			+ "background-color:rgba(12,20,32,.85) !important;"
			+ "-webkit-backdrop-filter:blur(16px) saturate(130%) !important;"
			+ "backdrop-filter:blur(16px) saturate(130%) !important;"
			+ "border-left:1px solid rgba(90,150,220,.22) !important;"
			+ "box-shadow:-4px 0 24px rgba(0,0,0,.40) !important;"
			+ "}"
			+ "[class*='drawer'] [class*='header'],[class*='search-panel'] [class*='header'],"
			+ "[class*='search-drawer'] [class*='header'],[class*='search-result'] [class*='header']{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border-bottom:1px solid rgba(110,180,240,.20) !important;"
			+ "}"
			+ "[class*='drawer'] [class*='item'],[class*='search-panel'] [class*='item'],"
			+ "[class*='search-drawer'] [class*='item']{"
			+ "background:rgba(18,28,42,.45) !important;"
			+ "border:1px solid rgba(110,180,240,.18) !important;"
			+ "border-radius:8px !important;"
			+ "transition:background-color .15s ease,border-color .15s ease !important;"
			+ "}"
			+ "[class*='drawer'] [class*='item']:hover,[class*='search-panel'] [class*='item']:hover{"
			+ "background:rgba(90,150,220,.18) !important;"
			+ "border-color:rgba(110,180,240,.38) !important;"
			+ "}"
			/* ⑩b 搜索来源胶囊（2026-11-06 赫珀重构：单层轮廓，杜绝套娃重复框）
			 *    实测真凶：::before（238x28本体）、::after（1x10装饰条）、内层 span
			 *    被多个规则同时赋了 border，导致一环套一环。
			 *    现精准约束：只有 ::before 承载唯一的外壳半透明底和圆角边框；
			 *    其余容器、::after、文字全部透明无边框。 */
			+ ":root ._60aa7fb{"
			+ "background:transparent !important;"
			+ "border:none !important;"
			+ "}"
			+ ":root ._60aa7fb::before{"
			+ "background:rgba(18,28,42,.65) !important;"
			+ "background-color:rgba(18,28,42,.65) !important;"
			+ "border:1px solid rgba(110,180,240,.35) !important;"
			+ "border-radius:100px !important;"
			+ "box-shadow:0 2px 10px rgba(0,0,0,.25),0 0 10px rgba(80,150,225,.15) !important;"
			+ "}"
			+ ":root ._60aa7fb:hover::before,"
			+ ":root [class*='search-chip']:hover::before,"
			+ ":root [class*='search-status']:hover::before,"
			+ ":root button[class*='search']:hover::before{"
			+ "background:rgba(36,68,102,.82) !important;"
			+ "background-color:rgba(36,68,102,.82) !important;"
			+ "border-color:rgba(130,200,255,.75) !important;"
			+ "box-shadow:0 0 14px rgba(100,180,240,.40) !important;"
			+ "cursor:pointer !important;"
			+ "}"
			+ ":root ._60aa7fb:hover *{"
			+ "color:rgba(255,255,255,1) !important;"
			+ "}"
			+ ":root ._60aa7fb::after,"
			+ ":root .e4c3fd02::after{"
			+ "background:transparent !important;"
			+ "border:none !important;"
			+ "box-shadow:none !important;"
			+ "}"
			+ ":root .e4c3fd02::before{"
			+ "background:rgba(18,28,42,.55) !important;"
			+ "border:1px solid rgba(110,180,240,.28) !important;"
			+ "border-radius:8px !important;"
			+ "}"
			/* ⑩b-2 正文引用角标 hover 反馈（略微加深蓝底与微光，对照原版白色交互） */
			+ ":root .e4c3fd02:hover::before,"
			+ ":root [class*='ds-citation']:hover,"
			+ ":root [class*='citation']:hover::before,"
			+ ":root [class*='reference']:hover::before{"
			+ "background:rgba(36,68,102,.78) !important;"
			+ "background-color:rgba(36,68,102,.78) !important;"
			+ "border-color:rgba(130,200,255,.68) !important;"
			+ "box-shadow:0 0 10px rgba(100,180,240,.35) !important;"
			+ "cursor:pointer !important;"
			+ "}"
			+ ":root .e4c3fd02:hover{"
			+ "color:rgba(255,255,255,1) !important;"
			+ "cursor:pointer !important;"
			+ "}"
			/* 胶囊内文字与子元素：彻底清掉内层套娃边框与背景 */
			+ ":root ._60aa7fb *,"
			+ ":root [class*='search-chip'] *,:root [class*='search-status'] *,"
			+ ":root [class*='search-source'] *,:root [class*='search-summary'] *{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-radius:0 !important;"
			+ "box-shadow:none !important;"
			+ "color:rgba(220,240,255,.95) !important;"
			+ "}"
			/* ⑩c 引用角标悬停浮层气泡（Popper 挂 body 底部） */
			+ "[role='tooltip'],[class*='ds-tooltip'],[class*='ds-popover'],"
			+ "[class*='tooltip__content'],[class*='popover__content'],.ds-popper{"
			+ "background:rgba(12,20,32,.90) !important;"
			+ "background-color:rgba(12,20,32,.90) !important;"
			+ "-webkit-backdrop-filter:blur(14px) !important;"
			+ "backdrop-filter:blur(14px) !important;"
			+ "border:1px solid rgba(110,180,240,.35) !important;"
			+ "border-radius:8px !important;"
			+ "box-shadow:0 4px 16px rgba(0,0,0,.45),0 0 12px rgba(80,150,225,.20) !important;"
			+ "color:rgba(220,240,255,.95) !important;"
			+ "}"
			/* ⑩d 「系统设置」模态弹窗与下拉控件（2026-11-06 赫珀修正：解耦误伤）
			 *    1. 弹窗顶层加玻璃与边框，但必须排除内部 __header，防止顶部出现孤立黑色长槽；
			 *    2. 下拉框只给外层容器 [class*='ds-select'] 赋样式，内层 __trigger 必须透明无边框，杜绝大框套小框；
			 *    3. 补全左侧导航「通用设置」等选中项的激活高亮与指示条。 */
			+ "[role='dialog'],"
			+ ".ds-dialog:not([class*='__']),"
			+ ".ds-modal:not([class*='__']),"
			+ "[class*='ds-modal__container']:not([class*='__header']){"
			/* 2026-11-06 黑蓝玻璃质感（第三次调整）
			 *    演进：.92（太深）→ .55（偏实）→ 现在 .36
			 *
			 *    做法不是单纯降透明度，而是三件事一起做：
			 *      ① 明度压更低：rgb(14,22,36) → rgb(6,11,20)，往"黑"走
			 *      ② 透明度降到 .36，让底层深海蓝大量透上来
			 *      ③ blur 26px→38px、saturate 140%→175%，
			 *         强模糊+高饱和让透上来的光变成玻璃质感而不是"糊"
			 *
			 *    实测四档（.55 / .42 / .36 / .30）后选 .36：
			 *    .42 偏保守，.30 影响文字可读性，.36 是清晰与通透的平衡点。
			 *    内部结构由赫珀维护，此处只动容器。 */
			+ "background:rgba(6,11,20,.36) !important;"
			+ "background-color:rgba(6,11,20,.36) !important;"
			+ "-webkit-backdrop-filter:blur(38px) saturate(175%) !important;"
			+ "backdrop-filter:blur(38px) saturate(175%) !important;"
			+ "border:1px solid rgba(110,180,240,.30) !important;"
			+ "border-radius:16px !important;"
			+ "box-shadow:0 16px 48px rgba(0,0,0,.60),0 0 24px rgba(80,150,225,.18) !important;"
			+ "}"
			+ "[class*='ds-dialog__mask'],[class*='ds-modal__mask']{"
			+ "background:rgba(0,0,0,.45) !important;"
			+ "-webkit-backdrop-filter:blur(6px) !important;"
			+ "backdrop-filter:blur(6px) !important;"
			+ "}"
			/* 弹窗头部 header：平滑融入弹窗顶部，补全优雅的水平底部分割线 */
			+ "[class*='ds-dialog__header'],[class*='ds-modal__header']{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-radius:0 !important;"
			+ "box-shadow:none !important;"
			+ "border-bottom:1px solid rgba(110,180,240,.18) !important;"
			+ "}"
			/* 弹窗左侧主导航列容器：安全内边距与右侧纤细分割线（显式置零左/上/下与圆角，彻底根除 C 型残框，严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='sidebar'],html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='sidebar'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='ds-dialog__body']>div:first-child,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='ds-modal__body']>div:first-child{"
			+ "border-right:1px solid rgba(110,180,240,.18) !important;"
			+ "border-left:none !important;"
			+ "border-top:none !important;"
			+ "border-bottom:none !important;"
			+ "border-radius:0 !important;"
			+ "box-shadow:none !important;"
			+ "padding-left:14px !important;"
			+ "padding-right:16px !important;"
			+ "box-sizing:border-box !important;"
			+ "}"
			/* 彻底消除 Tab 项、导航列表与内部菜单容器的任何外层残缺框（彻底根除 C 型残缺框，严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='sidebar'] *,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab'],html:not(.dsh-theme-light) [role='dialog'] [class*='item'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tab'],html:not(.dsh-theme-light) [role='dialog'] [class*='menu-item'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='menu'],html:not(.dsh-theme-light) [role='dialog'] [class*='tabs__nav'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tablist'],html:not(.dsh-theme-light) [role='dialog'] [role='tablist'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] nav,html:not(.dsh-theme-light) [role='dialog'] ul,html:not(.dsh-theme-light) [role='dialog'] nav *,html:not(.dsh-theme-light) [role='dialog'] ul *,"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='tab'],html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='menu-item']{"
			+ "border:none !important;"
			+ "border-left:none !important;"
			+ "border-right:none !important;"
			+ "border-top:none !important;"
			+ "border-bottom:none !important;"
			+ "border-radius:8px !important;"
			+ "outline:none !important;"
			+ "box-shadow:none !important;"
			+ "box-sizing:border-box !important;"
			+ "color:rgba(200,225,245,.82) !important;"
			+ "transition:all .15s ease !important;"
			+ "}"
			/* 导航单项 hover（2026-11-06 赫珀第三期定位 · 消除\"先方框后胶囊\"闪烁，严格限定深色模式）
			 *
			 *    病灶：外层按钮被设了 background + border-radius:8px，
			 *    而内层 .ds-button__background 是 4096px 正圆胶囊。
			 *    鼠标移入瞬间外层先画 8px 方框，随后内层胶囊覆盖上来 → 肉眼看到闪变。
			 *
			 *    修法：外层只保留文字色，背景/圆角全部交给内层统一绘制。
			 *    这里显式把外层背景置空，并强制内层用一致的胶囊微光。 */
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tab']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab-item']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='menu-item']:hover,"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [role='tab']:hover,"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='tab-item']:hover{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "color:rgba(240,248,255,.98) !important;"
			+ "border:none !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* 弹窗内 Tab 的内层高亮层：统一为深海胶囊微光（唯一绘制者，严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tab']:hover [class*='ds-button__background'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab-item']:hover [class*='ds-button__background'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='menu-item']:hover [class*='ds-button__background'],"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [role='tab']:hover [class*='ds-button__background'],"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='tab-item']:hover [class*='ds-button__background']{"
			+ "background:rgba(90,150,220,.20) !important;"
			+ "background-color:rgba(90,150,220,.20) !important;"
			+ "border-radius:9999px !important;"
			+ "transition:background .15s ease !important;"
			+ "}"
			/* 显式禁止外层导航列表、容器在 hover 时产生背景与大方框（严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tablist']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tablist']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tabs']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tabs__nav']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='sidebar']:hover,"
			+ "html:not(.dsh-theme-light) [role='dialog'] nav:hover,html:not(.dsh-theme-light) [role='dialog'] ul:hover{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* 弹窗左侧 Tab 选中项：采用完整圆角矩形半透明底色（与原生完全一致，整行一体受光，绝无生硬切边，严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tab'][aria-selected='true'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tab'][class*='active'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [role='tab'][class*='selected'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab'][class*='active'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab'][class*='selected'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab'][class*='is-active'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='tab'][data-state='active'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='item'][class*='active'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='item'][class*='selected'],"
			+ "html:not(.dsh-theme-light) [role='dialog'] [class*='item'][class*='is-active'],"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='tab'][class*='active'],"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='tab'][class*='is-active'],"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='menu-item'][class*='active'],"
			+ "html:not(.dsh-theme-light) [class*='ds-dialog'] [class*='menu-item'][class*='is-active']{"
			+ "background:rgba(90,150,220,.22) !important;"
			+ "background-color:rgba(90,150,220,.22) !important;"
			+ "border:none !important;"
			/* 2026-11-06 修正：选中态原为 border-radius:8px 方框，
			 * 而 hover 态走内层 ds-button__background 的 9999px 胶囊，形态不一致，
			 * 选中↔悬停切换时会出现\"方框↔胶囊\"跳动。现统一为胶囊。 */
			+ "border-radius:9999px !important;"
			+ "box-shadow:0 0 12px rgba(80,150,225,.18) !important;"
			+ "color:rgba(240,248,255,.98) !important;"
			+ "transition:background .15s ease,border-radius .15s ease !important;"
			+ "}"
			/* 表单行容器排除：严禁给包含语言/朗读音色的大长行加外框 */
			+ "[role='dialog'] [class*='form-item'],"
			+ "[role='dialog'] [class*='select-row'],"
			+ "[role='dialog'] [class*='form-row'],"
			+ "[role='dialog'] [class*='field'],"
			+ "[role='dialog'] [class*='form-field']{"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* 下拉选择框（2026-11-06 赫珀第三期定位 · 消除重叠双框）
			 *
			 *    病灶：原来选择器同时命中「外层容器 [class*='ds-select']」和
			 *    「内层 [class*='ds-select__trigger']」，两层各自画了一个 1px 边框，
			 *    而这两层之间有原生 padding 偏移，于是出现相对错位的双框。
			 *
			 *    修法（单层承载原则）：外层容器一律透明无框，只让内层 Trigger 画框。
			 */
			/* ①a 外层容器与各级包裹层：彻底透明、无框、无阴影 */
			+ "[role='dialog'] [class*='form-item'],"
			+ "[role='dialog'] [class*='select-row'],"
			+ "[role='dialog'] [class*='form-row'],"
			+ "[role='dialog'] [class*='field'],"
			+ ":root [class*='ds-select']{"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* ①b 仅 Trigger 自身作为唯一下拉框容器 */
			+ ":root [class*='ds-select__trigger'],"
			+ ":root [class*='ds-dropdown-trigger'],"
			+ ":root .ds-dropdown:not([class*='menu']):not([class*='row']),"
			+ ":root [class*='ds-dropdown'][class*='__panel']{"
			+ "background:rgba(18,28,42,.65) !important;"
			+ "background-color:rgba(18,28,42,.65) !important;"
			+ "border:1px solid rgba(110,180,240,.32) !important;"
			+ "border-radius:8px !important;"
			+ "color:rgba(220,240,255,.95) !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* ①c Trigger 内部子节点（文字/箭头/suffix）一律清空边框与背景 */
			+ ":root [class*='ds-select__trigger'] *,"
			+ ":root [class*='ds-dropdown-trigger'] *,"
			+ ":root .ds-dropdown:not([class*='menu']) *{"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "outline:none !important;"
			+ "}"
			/* 菜单容器本体（账号菜单 + 设置弹窗下拉选项面板）：整体给一层深海玻璃 */
			+ ":root .ds-dropdown-menu,"
			+ ":root .ds-select-menu{"
			+ "background:rgba(14,22,36,.82) !important;"
			+ "background-color:rgba(14,22,36,.82) !important;"
			+ "-webkit-backdrop-filter:blur(20px) saturate(130%) !important;"
			+ "backdrop-filter:blur(20px) saturate(130%) !important;"
			+ "border:1px solid rgba(110,180,240,.32) !important;"
			+ "border-radius:12px !important;"
			+ "box-shadow:0 12px 36px rgba(0,0,0,.75),0 0 16px rgba(80,150,230,.25) !important;"
			+ "padding:6px !important;"
			+ "outline:none !important;"
			+ "}"
			+ ":root .ds-select-menu__content{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "}"
			/* 菜单项整行：统一平滑圆角矩形 hover 反馈 */
			+ ":root [class*='ds-dropdown-menu-option'],"
			+ ":root .ds-select-option{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-radius:8px !important;"
			+ "cursor:pointer !important;"
			+ "transition:background .15s ease,color .15s ease !important;"
			+ "padding:8px 12px !important;"
			+ "color:rgba(220,240,255,.92) !important;"
			+ "}"
			+ ":root [class*='ds-dropdown-menu-option']:hover,"
			+ ":root .ds-select-option:hover,"
			+ ":root .ds-select-option--pending{"
			+ "background:rgba(90,150,220,.22) !important;"
			+ "background-color:rgba(90,150,220,.22) !important;"
			+ "color:#ffffff !important;"
			+ "}"
			+ ":root .ds-select-option--selected{"
			+ "color:rgba(140,215,255,1) !important;"
			+ "font-weight:500 !important;"
			+ "}"
			/* 彻底清空菜单项内部所有子节点（文字 label、图标 icon、span、p 及其伪元素）的任何内层背景与边框，
			 * 坚决杜绝只包在文字外部的“不适合的小圈”/套娃胶囊，保持与原版一致的整行一体化高亮 */
			+ ":root [class*='ds-dropdown-menu-option'] *,"
			+ ":root [class*='ds-dropdown-menu-option'] *::before,"
			+ ":root [class*='ds-dropdown-menu-option'] *::after,"
			+ ":root [class*='ds-dropdown-menu-option']:hover *,"
			+ ":root [class*='ds-dropdown-menu-option']:hover *::before,"
			+ ":root [class*='ds-dropdown-menu-option']:hover *::after{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-radius:0 !important;"
			+ "box-shadow:none !important;"
			+ "outline:none !important;"
			+ "}"
			/* 菜单项文字与图标颜色 */
			+ ":root [class*='ds-dropdown-menu-option__label'],:root [class*='ds-dropdown-menu-option'] span{"
			+ "color:rgba(225,238,250,.95) !important;"
			+ "}"
			+ ":root [class*='ds-dropdown-menu-option']:hover [class*='ds-dropdown-menu-option__label'],"
			+ ":root [class*='ds-dropdown-menu-option']:hover span,"
			+ ":root [class*='ds-dropdown-menu-option']:hover p{"
			+ "color:rgba(240,248,255,.98) !important;"
			+ "}"
			+ ":root [class*='ds-dropdown-menu-option__icon'],:root [class*='ds-dropdown-menu-option'] svg{"
			+ "color:rgba(160,200,235,.90) !important;"
			+ "}"
			+ ":root [class*='ds-dropdown-menu-option']:hover [class*='ds-dropdown-menu-option__icon'],"
			+ ":root [class*='ds-dropdown-menu-option']:hover svg{"
			+ "color:rgba(180,220,255,.95) !important;"
			+ "}"
			/* ⑩d-1 主题切换卡片（浅色 / 深色 / 跟随系统）：仅整卡保留外框与微光（严格限定深色模式） */
			+ "html:not(.dsh-theme-light) .dsh-theme-card,html:not(.dsh-theme-light) [class*='theme-card'],html:not(.dsh-theme-light) [class*='theme-item'],html:not(.dsh-theme-light) [class*='radio-card'],html:not(.dsh-theme-light) [class*='theme-option']{"
			+ "background:rgba(18,28,42,.55) !important;"
			+ "background-color:rgba(18,28,42,.55) !important;"
			+ "border:1px solid rgba(110,180,240,.28) !important;"
			+ "border-radius:12px !important;"
			+ "cursor:pointer !important;"
			+ "transition:all .15s ease !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* 悬停微光反馈：整张卡片整体提亮 + 冰蓝光晕，杜绝内层暗色椭圆套娃（严格限定深色模式） */
			+ "html:not(.dsh-theme-light) .dsh-theme-card:hover,html:not(.dsh-theme-light) [class*='theme-card']:hover,html:not(.dsh-theme-light) [class*='theme-item']:hover,html:not(.dsh-theme-light) [class*='radio-card']:hover,"
			+ "html:not(.dsh-theme-light) [class*='theme-option']:hover{"
			+ "background:rgba(32,60,95,.85) !important;"
			+ "background-color:rgba(32,60,95,.85) !important;"
			+ "border-color:rgba(140,215,255,.90) !important;"
			+ "box-shadow:0 0 18px rgba(110,185,250,.45) !important;"
			+ "}"
			/* 选中激活态（浅色/深色/跟随系统，严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [class*='theme-card'][class*='active'],html:not(.dsh-theme-light) [class*='theme-card'][class*='selected'],"
			+ "html:not(.dsh-theme-light) [class*='theme-card'][class*='checked'],html:not(.dsh-theme-light) [class*='theme-card'][aria-checked='true'],"
			+ "html:not(.dsh-theme-light) [class*='theme-item'][class*='active'],html:not(.dsh-theme-light) [class*='theme-item'][class*='selected'],"
			+ "html:not(.dsh-theme-light) [class*='radio-card'][class*='active'],html:not(.dsh-theme-light) [class*='radio-card'][class*='checked'],"
			+ "html:not(.dsh-theme-light) [class*='radio-card'][data-state='checked']{"
			+ "background:rgba(36,68,105,.82) !important;"
			+ "background-color:rgba(36,68,105,.82) !important;"
			+ "border-color:rgba(140,215,255,.85) !important;"
			+ "box-shadow:0 0 18px rgba(110,180,240,.40) !important;"
			+ "}"
			/* 核心：彻底清空主题卡片内所有子节点（文字、图标、所有 inner 容器与伪元素）的任何内层背景、边框与圆角，
			 * 坚决铲除卡片内部突兀的深色椭圆胶囊，让整张卡片受光均匀一体 */
			+ "[class*='theme-card'] *,[class*='theme-card'] *::before,[class*='theme-card'] *::after,"
			+ "[class*='theme-item'] *,[class*='theme-item'] *::before,[class*='theme-item'] *::after,"
			+ "[class*='radio-card'] *,[class*='radio-card'] *::before,[class*='radio-card'] *::after,"
			+ "[class*='theme-option'] *,[class*='theme-option'] *::before,[class*='theme-option'] *::after,"
			+ "[class*='ds-radio-button'] *,[class*='ds-segmented-item'] *,"
			+ "[class*='theme-card']:hover *,[class*='theme-card']:hover *::before,[class*='theme-card']:hover *::after,"
			+ "[class*='theme-item']:hover *,[class*='theme-item']:hover *::before,[class*='theme-item']:hover *::after,"
			+ "[class*='radio-card']:hover *,[class*='radio-card']:hover *::before,[class*='radio-card']:hover *::after,"
			+ "[class*='theme-option']:hover *,[class*='ds-radio-button']:hover *,[class*='ds-segmented-item']:hover *{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-radius:0 !important;"
			+ "box-shadow:none !important;"
			+ "outline:none !important;"
			+ "}"
			/* 卡片内文字与图标颜色保持高亮通透 */
			+ "[class*='theme-card'] svg,[class*='theme-item'] svg,[class*='radio-card'] svg,"
			+ "[class*='theme-card'] span,[class*='theme-item'] span,[class*='radio-card'] span{"
			+ "color:rgba(225,240,255,.95) !important;"
			+ "}"
			+ "[class*='theme-card']:hover svg,[class*='theme-item']:hover svg,[class*='radio-card']:hover svg,"
			+ "[class*='theme-card']:hover span,[class*='theme-item']:hover span,[class*='radio-card']:hover span{"
			+ "color:rgba(255,255,255,1) !important;"
			+ "}"
			/* ⑩d-3 系统设置弹窗下拉选择器（语言 / 朗读音色等胶囊按钮）：
			 *    真实容器 .ds-modal-content 内的 .ds-select（.e311289c）。
			 *    ①a 已先把所有 [class*='ds-select'] 清成透明无框，
			 *    此处仅对「弹窗内最外层 ds-select」重新赋胶囊底与边框，
			 *    内层 __select / __arrow 保持透明，杜绝套娃双框。
			 *    ⚠ transition 显式列出属性名，不用 all —— all 会把
			 *      border-width 也纳入过渡，hover 时产生 1px 抖动。 */
			/* ⑩d-2 弹窗下拉选择框（语言 / 朗读音色）：严格限定深色模式 */
			+ "html:not(.dsh-theme-light) .ds-modal-content .ds-select,html:not(.dsh-theme-light) .ds-modal-content .e311289c{"
			+ "background:rgba(18,28,42,.55) !important;"
			+ "background-color:rgba(18,28,42,.55) !important;"
			+ "border:1px solid rgba(110,180,240,.25) !important;"
			+ "border-radius:18px !important;"
			+ "box-shadow:0 2px 8px rgba(0,0,0,.20) !important;"
			+ "transition:background-color .22s ease,border-color .22s ease,box-shadow .22s ease,transform .22s ease !important;"
			+ "cursor:pointer !important;"
			+ "}"
			+ "html:not(.dsh-theme-light) .ds-modal-content .ds-select:hover,html:not(.dsh-theme-light) .ds-modal-content .e311289c:hover{"
			+ "background:rgba(32,60,95,.85) !important;"
			+ "background-color:rgba(32,60,95,.85) !important;"
			+ "border-color:rgba(140,215,255,.90) !important;"
			+ "box-shadow:0 0 16px rgba(110,185,250,.45),inset 0 0 10px rgba(110,180,240,.20) !important;"
			+ "transform:translateY(-1px) !important;"
			+ "}"
			+ "html:not(.dsh-theme-light) .ds-modal-content .ds-select:focus-within{"
			+ "border-color:rgba(165,225,255,.95) !important;"
			+ "box-shadow:0 0 18px rgba(110,185,250,.55) !important;"
			+ "}"
			/* 内层文字与箭头：不画框，只调色（严格限定深色模式） */
			+ "html:not(.dsh-theme-light) .ds-modal-content .ds-select .ds-select__select{"
			+ "color:rgba(235,245,255,.95) !important;"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "}"
			+ "html:not(.dsh-theme-light) .ds-modal-content .ds-select .ds-select__arrow{"
			+ "color:rgba(160,205,245,.85) !important;"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "transition:color .2s ease !important;"
			+ "}"
			+ ".ds-modal-content .ds-select:hover .ds-select__arrow{"
			+ "color:rgba(255,255,255,1) !important;"
			+ "}"
			/* 兜底：若真实 DOM 存在 ds-select__trigger 内层，一律清空，防双框 */
			+ ".ds-modal-content [class*='ds-select__trigger'],"
			+ ".ds-modal-content [class*='ds-select__trigger'] *{"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "}"
			/* ⑩d-2 用户消息气泡（2026-11-06 实测补）：
			 *    黑底来自 ._9663006 的 ::before 伪元素 rgb(33,33,35)，
			 *    宿主自身透明——又一个伪元素黑块，赫珀文档未覆盖。 */
			+ ":root ._9663006::before,:root ._9663006::after{"
			+ "background:rgba(30,58,86,.55) !important;"
			+ "background-color:rgba(30,58,86,.55) !important;"
			+ "border:1px solid rgba(110,180,240,.26) !important;"
			+ "box-shadow:0 2px 12px rgba(0,0,0,.22) !important;"
			+ "}"
			/* ⑩e Markdown 表格（2026-11-06 全面对齐原版网页）
			 *
			 *    病灶交代：此前用 border-collapse:separate + 外层圆角边框
			 *    + 卡片底色，导致表格变成突兀的「外挂浮动小盒子」，
			 *    割裂正文阅读流（主人原话：把表格切割了）。
			 *
			 *    现按原版规范重置：
			 *      · 无外框线、无卡片底色、无圆角、无外框阴影
			 *      · border-collapse:collapse，纯水平分割线
			 *      · 首列 padding-left:0、末列 padding-right:0，与正文左右齐平
			 *      · 表头下线 .16 / 数据行下线 .12 / 末行无线
			 *
			 *    ⚠ 只写 border-bottom，绝不加 left/right 竖线（切割感来源）。 */
			+ ".ds-markdown table{"
			+ "border-collapse:collapse !important;"
			+ "border-spacing:0 !important;"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border:none !important;"
			+ "border-radius:0 !important;"
			+ "box-shadow:none !important;"
			+ "width:100% !important;"
			+ "max-width:100% !important;"
			+ "margin:16px 0 !important;"
			+ "}"
			+ ".ds-markdown thead{"
			+ "background:transparent !important;"
			+ "}"
			+ ".ds-markdown tr{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "}"
			+ ".ds-markdown th{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border-top:none !important;"
			+ "border-left:none !important;"
			+ "border-right:none !important;"
			+ "border-bottom:1px solid rgba(255,255,255,.16) !important;"
			+ "color:rgba(240,248,255,.95) !important;"
			+ "font-weight:500 !important;"
			+ "padding:10px 16px !important;"
			+ "text-align:left !important;"
			+ "}"
			+ ".ds-markdown td{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "border-top:none !important;"
			+ "border-left:none !important;"
			+ "border-right:none !important;"
			+ "border-bottom:1px solid rgba(255,255,255,.12) !important;"
			+ "color:rgba(225,238,250,.90) !important;"
			+ "padding:10px 16px !important;"
			+ "}"
			/* 首末列与正文边缘对齐 */
			+ ".ds-markdown th:first-child,.ds-markdown td:first-child{"
			+ "padding-left:0 !important;"
			+ "}"
			+ ".ds-markdown th:last-child,.ds-markdown td:last-child{"
			+ "padding-right:0 !important;"
			+ "}"
			/* 最后一行无下划线，收口干净 */
			+ ".ds-markdown tbody tr:last-child td,"
			+ ".ds-markdown tr:last-child td{"
			+ "border-bottom:none !important;"
			+ "}"
			/* ④ 保留内容控件：按钮与开关是「品牌色底」，透明会看不见。
			 *
			 *    ⚠ 2026-11-06 修正：原写法 `[class*='ds-button']{background:revert}`
			 *    是宽匹配，会把【所有】ds-button 及其子层全部强制还原，
			 *    连 .ds-button__background（负责画 hover 反馈的那层）也一起压死，
			 *    导致侧边栏会话项右侧「···」按钮 hover 时没有任何反馈。
			 *
			 *    实测网页版机制：
			 *      .ds-button                 本体，背景透明
			 *        └─ .ds-button__background  真正画 hover 底色的层
			 *             未 hover  rgba(0,0,0,0)
			 *             hover 后  rgba(255,255,255,0.08)   ← 正圆 4096px 圆角
			 *             transition: background-color .2s
			 *
			 *    所以现在：只给按钮本体 revert，__background 子层放行让它自己响应 hover。 */
			+ "[class*='ds-button']:not([class*='__background']),"
			+ "[class*='ds-toggle']:not([class*='__background']){"
			+ "background:revert !important;"
			+ "}"
			/* ④b 让 __background 层自由响应官方 hover（不要覆盖它的背景色） */
			+ ":root [class*='ds-button__background']{"
			+ "background-color:revert !important;"
			+ "transition:background-color .2s cubic-bezier(.4,0,.2,1) !important;"
			+ "}"
			/* ④c 会话项「···」按钮 hover 反馈（2026-11-06 二次修正：消除常驻圆底）
			 *
			 *    上一版第一个选择器 `:root ._546d736 [class*='ds-button__background']`
			 *    **没有 :hover 限定**，等于给侧边栏每个会话项的「···」按钮
			 *    无条件画了一个圆形底 —— 常驻就显示，主人截图里那个多余圆圈。
			 *
			 *    官方机制（实测）：__background 的底色纯由 :hover 驱动，
			 *    常驻 rgba(0,0,0,0)，hover 才变 rgba(255,255,255,.08)。
			 *    所以这里【只保留带 :hover 的规则】，常驻态一律交给 ④b 的 revert。 */
			/* ⚠ 2026-11-06 收窄：原规则是全局生效，会把弹窗内 Tab 的胶囊
			 * 一并覆盖成 4096px + 120,180,240（与赫珀设的 9999px + 90,150,220 冲突）。
			 * 现排除弹窗容器，让弹窗内 Tab 走 [role='dialog'] 的专用规则；
			 * 弹窗外的按钮（侧边栏「···」、顶部工具栏等）仍用下面这套深海蓝。 */
			+ ":root [class*='ds-button']:hover [class*='ds-button__background']:not([role='dialog'] *){"
			+ "background-color:rgba(120,180,240,.20) !important;"
			+ "border-radius:4096px !important;"
			+ "}"
			+ ":root [class*='ds-button']:hover [class*='ds-button__background']:hover:not([role='dialog'] *){"
			+ "background-color:rgba(120,180,240,.32) !important;"
			+ "}"
			/* ⑩f 覆盖 revert：把搜索胶囊从 revert 手里抢回来。
			 *    必须放在 ④ 之后，同优先级下后出现的规则胜出。 */
			+ ":root ._60aa7fb,:root ._60aa7fb *{"
			+ "background-color:transparent !important;"
			+ "}"
			/* ================================================================
			 * ⑪ 浅蓝偏白弱发光（2026-11-06 主人确认方案 · 强度「中」档）
			 *
			 *    设计意图：
			 *      不换色系、不动底色，只把各处「蓝色描边」换成
			 *      「浅蓝偏白 rgba(220,240,255,~.5)」并叠一圈低透明度外发光，
			 *      让边界在深底上被"点亮"，提高辨识度与活力。
			 *
			 *    强度标定（实测四档对比后选定）：
			 *      · border-color   rgba(220~224, 240~242, 255, .34~.58)
			 *      · 外发光         0 0 10~28px rgba(190~195,225~228,255, .06~.24)
			 *      · 内高光         0 0 0 1px rgba(255,255,255,.18) 仅主交互区用
			 *
			 *    ⚠ 注意：为覆盖前面各条原有规则，这一段必须放在数组【最末】。
			 *    ⚠ 只手写视觉相关属性（border-color / box-shadow），
			 *      不改 background / color，避免与前面规则打架。
			 * ================================================================ */

			/* ⑪a 输入框 —— 主交互区，发光最明显 */
			+ "._77cefa5{"
			+ "border-color:rgba(160,205,255,.55) !important;"
			+ "box-shadow:"
			+ "0 0 0 1px rgba(255,255,255,.18),"
			+ "0 0 22px rgba(120,180,250,.24),"
			+ "inset 0 0 22px rgba(80,150,225,.10),"
			+ "0 -2px 24px rgba(0,0,0,.40) !important;"
			+ "}"

			/* ⑪b 侧边栏 —— 右边缘一道细白光 */
			+ ".b8812f16{"
			+ "border-right-color:rgba(160,205,255,.32) !important;"
			+ "box-shadow:"
			+ "2px 0 22px rgba(0,0,0,.35),"
			+ "inset -1px 0 0 rgba(255,255,255,.14),"
			+ "1px 0 14px rgba(120,180,250,.12) !important;"
			+ "}"

			/* ⑪c 顶部标题栏（纯净悬浮，无缝融入深海背景） */
			+ "[class*='the-header']{"
			+ "border-bottom:none !important;"
			+ "box-shadow:none !important;"
			+ "}"

			/* ⑪d 搜索来源胶囊 —— 圆角外发光（只改边框色与辉光，不动背景） */
			+ ":root ._60aa7fb::before{"
			+ "border-color:rgba(165,210,255,.60) !important;"
			+ "box-shadow:"
			+ "0 0 14px rgba(130,185,250,.24),"
			+ "inset 0 0 10px rgba(200,230,255,.06) !important;"
			+ "}"
			+ ":root .e4c3fd02::after{"
			+ "border-color:rgba(165,210,255,.50) !important;"
			+ "box-shadow:0 0 12px rgba(130,185,250,.20) !important;"
			+ "}"

			/* ⑪e 引用角标 —— 小元素，白光提辨识度 */
			+ ".ds-markdown-cite{"
			+ "border-color:rgba(165,210,255,.57) !important;"
			+ "box-shadow:0 0 10px rgba(130,185,250,.26) !important;"
			+ "}"

			/* ⑪f 账号栏卡片 */
			+ ".b8812f16 ._2afd28d,._2afd28d{"
			+ "border-color:rgba(165,210,255,.36) !important;"
			+ "box-shadow:"
			+ "0 2px 10px rgba(0,0,0,.20),"
			+ "0 0 14px rgba(120,180,250,.14) !important;"
			+ "}"

			/* ⑪g 右侧索引面板（仅 hover 态 —— 常驻态必须完全无底无光） */
			+ ":root ._189b4a0:hover ._4ce999d{"
			+ "border-color:rgba(165,210,255,.46) !important;"
			+ "box-shadow:"
			+ "0 12px 36px rgba(0,0,0,.55),"
			+ "0 0 24px rgba(130,185,250,.22) !important;"
			+ "}"

			/* ⑪h 代码块 —— 细白光描边 */
			+ ".dshc-code-card,div:has(> pre):not(.ds-markdown),div:has(> div > pre):not(.ds-markdown),"
			+ "[class*='code-block'],[class*='md-code'],:not(pre) > code{"
			+ "border-color:rgba(155,200,255,.32) !important;"
			+ "box-shadow:0 0 12px rgba(120,180,250,.12) !important;"
			+ "}"

			/* ⑪i 搜索抽屉 */
			+ ":root ._519be07{"
			+ "border-left-color:rgba(160,205,255,.36) !important;"
			+ "box-shadow:"
			+ "-6px 0 28px rgba(0,0,0,.45),"
			+ "-1px 0 18px rgba(120,180,250,.14) !important;"
			+ "}"

			/* ⑪j 系统设置弹窗 */
			+ "[role='dialog']{"
			+ "border-color:rgba(165,210,255,.42) !important;"
			+ "box-shadow:"
			+ "0 16px 48px rgba(0,0,0,.60),"
			+ "0 0 28px rgba(130,185,250,.20) !important;"
			+ "}"

			/* ⑪k 下拉菜单容器 */
			+ ":root .ds-dropdown-menu{"
			+ "border-color:rgba(165,210,255,.36) !important;"
			+ "box-shadow:"
			+ "0 12px 36px rgba(0,0,0,.55),"
			+ "0 0 18px rgba(130,185,250,.16) !important;"
			+ "}"

			/* ⑪l 按钮 hover 圆底加一点微光 */
			+ ":root [class*='ds-button']:hover [class*='ds-button__background']{"
			+ "box-shadow:0 0 12px rgba(120,180,250,.22) !important;"
			+ "}"

			/* ⑪m 滚动条滑块微光 */
			+ ":root .ds-scroll-area__vertical-bar::after,"
			+ ":root .ds-scroll-area__horizontal-bar::after{"
			+ "box-shadow:0 0 10px rgba(120,180,250,.26) !important;"
			+ "}"

			/* ⑪n 表格 —— 已并入 ⑩e 全面对齐原版，此处刻意留空。
			 *    ⚠ 不要再往这里加 border-color / box-shadow，
			 *      否则会在 ⑩e 之后重新给表格套上外框与光晕。 */

			/* ================================================================
			 * ⑫ 交互反馈增强（2026-11-06 主人要求）
			 *
			 *    ①「开启新对话」按钮 hover → 外框发光
			 *    ②「深度思考 / 智能搜索」toggle 按钮 hover → 内部略微反应
			 *    ③「引用网页」胶囊 hover → 内部略微反应（赫珀已有底色变化，
			 *       这里补一圈内部高光让反馈更明确）
			 *
			 *    ⚠ 全部用 :hover 限定，常驻态绝不加任何底色/发光。
			 * ================================================================ */

			/* ⑫a 开启新对话按钮：hover 时外框发光
			 *    真实类名 ._5a8ac7a.a084f19e（100px 圆角胶囊），
			 *    实测原生 bg rgb(67,69,74) 偏暗，这里只加"外框光"不动内部底色。 */
			+ ".b8812f16 ._5a8ac7a:hover,"
			+ "._5a8ac7a.a084f19e:hover{"
			+ "border-color:rgba(165,210,255,.72) !important;"
			+ "box-shadow:"
			+ "0 0 0 1px rgba(165,210,255,.30),"
			+ "0 0 18px rgba(120,180,250,.42),"
			+ "0 0 34px rgba(120,180,250,.20),"
			+ "inset 0 0 14px rgba(120,180,250,.14) !important;"
			+ "transition:border-color .25s ease,box-shadow .25s ease !important;"
			+ "}"

			/* ⑫b 深度思考 / 智能搜索 toggle 按钮：hover 时内部略有反应
			 *    真实类名 .ds-toggle-button（34px 高，18px 圆角），
			 *    原生 border rgba(255,255,255,.12) / bg 透明 或 rgb(40,49,66)（选中态）。 */
			+ ":root .ds-toggle-button{"
			+ "transition:background-color .22s ease,border-color .22s ease,box-shadow .22s ease !important;"
			+ "}"
			+ ":root .ds-toggle-button:hover{"
			+ "background-color:rgba(120,180,250,.16) !important;"
			+ "border-color:rgba(165,210,255,.55) !important;"
			+ "box-shadow:inset 0 0 12px rgba(120,180,250,.18),0 0 10px rgba(120,180,250,.18) !important;"
			+ "}"
			/* 已选中的 toggle hover 时再亮一点，避免与未选中态混淆 */
			+ ":root .ds-toggle-button--select:hover{"
			+ "background-color:rgba(120,180,250,.28) !important;"
			+ "border-color:rgba(180,220,255,.75) !important;"
			+ "box-shadow:inset 0 0 14px rgba(140,195,255,.24),0 0 12px rgba(120,180,250,.26) !important;"
			+ "}"

			/* ⑫c 引用网页胶囊：hover 时补内部高光
			 *    （赫珀已加底色变化，这里只叠一层内阴影，让"内部有反应"更明显）
			 *
			 *    ⚠ 2026-11-06 修正记录：
			 *      赫珀文档称「._60aa7fb / .e4c3fd02 在当前页面不存在，需整体替换」，
			 *      但其预览环境与生产 webview 不同——这两个类名在 ⑩b 段是真实生效的，
			 *      实测 chips 数量为 10。故此处**追加**而非替换，保留原规则。 */
			+ ":root ._60aa7fb:hover::before,"
			+ ":root .e4c3fd02:hover::before{"
			+ "box-shadow:"
			+ "0 2px 10px rgba(0,0,0,.25),"
			+ "0 0 16px rgba(120,180,250,.30),"
			+ "inset 0 0 14px rgba(140,195,255,.18) !important;"
			+ "}"

			/* ⑫d 正文末尾「引用网页」胶囊 .f93f59e4（N 个网页）：
			 *    已从 ③ 的全透明名单剔除，此处重新赋予深海胶囊质感。
			 *    常驻：半透明海蓝底 + 细边框 + 100px 圆角
			 *    悬停：边框高亮 + 提亮 + 内外双层光晕 + 微上浮
			 *
			 *    ⚠ transition 显式列属性名，避免 all 引起 1px 边框抖动。 */
			+ ":root .f93f59e4{"
			+ "background:rgba(18,28,42,.55) !important;"
			+ "background-color:rgba(18,28,42,.55) !important;"
			+ "border:1px solid rgba(110,180,240,.28) !important;"
			+ "border-radius:100px !important;"
			+ "box-shadow:0 2px 10px rgba(0,0,0,.22) !important;"
			+ "cursor:pointer !important;"
			+ "transition:background-color .25s ease,border-color .25s ease,box-shadow .25s ease,transform .25s ease !important;"
			+ "}"
			+ ":root .f93f59e4:hover{"
			+ "background:rgba(32,60,95,.85) !important;"
			+ "background-color:rgba(32,60,95,.85) !important;"
			+ "border-color:rgba(140,215,255,.90) !important;"
			+ "box-shadow:0 0 16px rgba(110,185,250,.45),inset 0 0 10px rgba(110,180,240,.20) !important;"
			+ "transform:translateY(-1px) !important;"
			+ "}"
			+ ":root .f93f59e4:active{"
			+ "transform:translateY(0) !important;"
			+ "box-shadow:0 0 8px rgba(110,185,250,.30) !important;"
			+ "}"
			+ ":root .f93f59e4 ._669a677{"
			+ "color:rgba(225,240,255,.95) !important;"
			+ "transition:color .2s ease !important;"
			+ "}"
			+ ":root .f93f59e4:hover ._669a677{"
			+ "color:rgba(255,255,255,1) !important;"
			+ "}"
			/* 内部图标组：只加一圈淡描边，不加底色（宽匹配禁加 border 的例外：
			 * 此处是精确点名的图标容器，不是通配） */
			+ ":root .f93f59e4 ._287b564 ._8e95474{"
			+ "box-shadow:0 0 0 1px rgba(110,180,240,.35) !important;"
			+ "}"

			/* ================================================================
			 * ⑫e 设置弹窗左侧导航项发光外框（2026-11-06 主人要求）
			 *
			 *    目标：让左侧「通用设置 / 账号管理 / 数据管理 / 服务协议」
			 *    与右侧主题卡片拥有同一套视觉语言 ——
			 *    常驻一道细蓝框，悬停时整框点亮并泛出冰蓝辉光。
			 *
			 *    实测 DOM（Playwright 真实弹窗内）：
			 *      .ds-modal-content > .ds-modal-content__main > ...
			 *        > div[role='button'].ds-button.ds-button--capsule   164x40 r:10px
			 *            > .ds-button__background                        163x40 r:10px
			 *
			 *    ⚠ 三个关键点：
			 *      1) 左侧导航项【没有】aria-selected，也没有 active 类名，
			 *         选中态只体现为 ds-button--outlinedNeutral 变体，
			 *         而这个变体在其他按钮上也会出现 —— 直接拿它当选择器会误伤。
			 *         故用 .ds-modal-content__main 作用域 + capsule 类收窄，
			 *         实测该组合在弹窗内只命中左侧这 4 项。
			 *      2) 框必须画在 .ds-button__background 上，不能画在外层
			 *         .ds-button 上 —— 外层是 164x40、内层 163x40，
			 *         两层都画会露出错位双框（本项目的经典坑）。
			 *      3) 常量态只给 border + border-color 过渡，
			 *         不叠外发光，否则 4 个常驻光晕会糊成一片。
			 * ================================================================ */

			/* ⑫e-1 常驻态：细蓝边框，与右侧主题卡片同规格（严格限定深色模式，绝不泄漏至浅色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] .ds-modal-content__main [role='button'].ds-button--capsule [class*='ds-button__background']{"
			+ "border:1px solid rgba(110,180,240,.28) !important;"
			+ "border-radius:10px !important;"
			+ "transition:border-color .2s ease,background-color .2s ease,box-shadow .2s ease !important;"
			+ "}"

			/* ⑫e-2 悬停态：边框点亮 + 深海底 + 内外双层冰蓝辉光（严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] .ds-modal-content__main [role='button'].ds-button--capsule:hover [class*='ds-button__background']{"
			+ "border-color:rgba(140,215,255,.90) !important;"
			+ "background-color:rgba(32,60,95,.60) !important;"
			+ "box-shadow:0 0 16px rgba(110,185,250,.45),inset 0 0 10px rgba(110,180,240,.20) !important;"
			+ "}"

			/* ⑫e-3 文字在悬停时提亮（保持与外框同步，严格限定深色模式） */
			+ "html:not(.dsh-theme-light) [role='dialog'] .ds-modal-content__main [role='button'].ds-button--capsule:hover{"
			+ "color:rgba(255,255,255,1) !important;"
			+ "}"
			/* ⑫e-4 还原设置弹窗行内纯文字操作按钮（变更/绑定）：彻底移除误伤的紧凑小圆圈边框，对齐网页原版纯净文字链接规范 */
			+ "[role='dialog'] .ds-modal-content__main [class*='text'] [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main [class*='link'] [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn:hover [class*='ds-button__background']{"
			+ "border:none !important;"
			+ "border-color:transparent !important;"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "box-shadow:none !important;"
			+ "border-radius:0 !important;"
			+ "}"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn{"
			+ "border:none !important;"
			+ "background:transparent !important;"
			+ "box-shadow:none !important;"
			+ "color:rgba(110,185,250,.95) !important;"
			+ "cursor:pointer !important;"
			+ "transition:color .18s ease,text-shadow .18s ease !important;"
			+ "}"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn:hover{"
			+ "color:rgba(165,225,255,1) !important;"
			+ "text-shadow:0 0 8px rgba(110,185,250,.45) !important;"
			+ "text-decoration:none !important;"
			+ "}"

			/* ================================================================
			 * ⑫f 分享选择态（2026-11-06 主人验收）
			 *
			 *    触发路径：消息工具条最右「分享」图标 → 进入勾选消息、创建分享链接的界面。
			 *
			 *    该界面有两处黑底，均已实测定位：
			 *
			 *    ① 消息区大片 rgb(21,21,23)
			 *       根因：分享态把每条消息包成 .ds-message._6e8caf5._7729a77，
			 *            黑底来自它的 ::before 伪元素 = rgb(33,33,35)。
			 *            宿主自身 bg 是透明的，elementFromPoint 与背景扫描都抓不到。
			 *       —— 这是本项目【第五次】栽在伪元素上
			 *          （前四次：._245c867::after / ._60aa7fb::after /
			 *            .ds-scroll-area__vertical-bar::after / ._9663006::before）
			 *
			 *    ② 底部操作栏 rgb(21,21,23)
			 *       真实元素：._43d222b（939x66，position:absolute，z-index:1001，
			 *       上边框已有 1px rgba(255,255,255,.12)）。
			 *
			 *    主人要求：底部栏做成半透明材质，并与上方消息区形成立体层次。
			 *    实测三档透明度（.45 / .35 / .25）后，主人选定 .35 档 T35。
			 * ================================================================ */

			/* ⑫f-1 消息区伪元素黑块 —— 必须显式点名 ::before/::after，
			 *       通配符 * 永远不匹配伪元素 */
			+ ":root .ds-message::before,"
			+ ":root .ds-message::after,"
			+ ":root ._6e8caf5::before,"
			+ ":root ._6e8caf5::after,"
			+ ":root ._6e8caf5 ._245c867, :root ._6e8caf5 ._245c867::before, :root ._6e8caf5 ._245c867::after,"
			+ ":root ._6e8caf5 [class*='think']::before, :root ._6e8caf5 [class*='think']::after,"
			+ ":root ._6e8caf5 [class*='thought']::before, :root ._6e8caf5 [class*='thought']::after{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "background-image:none !important;"
			+ "box-shadow:none !important;"
			+ "border:none !important;"
			+ "}"

			/* ⑫f-2 分享态下侧边栏 / 分组标题（正常态它们是透明的，分享态被原生反超） */
			+ ":root .b8812f16{"
			+ "background:rgba(12,20,32,.82) !important;"
			+ "background-color:rgba(12,20,32,.82) !important;"
			+ "-webkit-backdrop-filter:blur(14px) saturate(130%) !important;"
			+ "backdrop-filter:blur(14px) saturate(130%) !important;"
			+ "}"
			+ ":root .f3d18f6a,"
			+ ":root .f3d18f6a::before,"
			+ ":root .f3d18f6a::after{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "background-image:none !important;"
			+ "}"

			/* ⑫f-3 顶部栏 / 消息分隔 / 引用胶囊 / 行内代码 */
			+ ":root [class*='the-header'],"
			+ ":root .c99b79f8,"
			+ ":root .c99b79f8::before,"
			+ ":root .c99b79f8::after{"
			+ "background:transparent !important;"
			+ "background-color:transparent !important;"
			+ "background-image:none !important;"
			+ "}"
			+ ":root .f93f59e4{"
			+ "background:rgba(18,28,42,.55) !important;"
			+ "background-color:rgba(18,28,42,.55) !important;"
			+ "}"
			+ ":root .ds-markdown :not(pre) > code{"
			+ "background:rgba(30,45,68,.85) !important;"
			+ "background-color:rgba(30,45,68,.85) !important;"
			+ "color:rgba(200,230,255,.95) !important;"
			+ "}"

			/* ⑫f-4 底部操作栏 —— T35 半透明玻璃 + 立体分层
			 *
			 *    立体感由四层构造（缺一层就塌）：
			 *      ① 上浅下深的渐变底  → 模拟玻璃受光面与背光面
			 *      ② 0 -14px 38px 外部上方投影 → 把操作栏从消息区「托」起来
			 *      ③ 0 -1px 0 + inset 0 1px 0 → 顶部一道亮线，切出清晰边界
			 *      ④ inset 0 -8px 20px → 底部内侧压暗，形成厚度
			 *
			 *    ⚠ 透明度定 .35：与设置弹窗 .36 同档，视觉语言统一。
			 *      再低（.25）文字对比度开始不足，故不再降。 */
			+ ":root ._43d222b{"
			+ "background:linear-gradient(180deg,rgba(18,30,48,.35) 0%,rgba(9,15,26,.30) 100%) !important;"
			+ "background-color:rgba(10,17,28,.32) !important;"
			+ "-webkit-backdrop-filter:blur(30px) saturate(165%) !important;"
			+ "backdrop-filter:blur(30px) saturate(165%) !important;"
			+ "border-top:1px solid rgba(150,210,255,.46) !important;"
			+ "box-shadow:0 -14px 38px rgba(0,0,0,.45),0 -1px 0 rgba(190,230,255,.26),inset 0 1px 0 rgba(210,240,255,.22),inset 0 -8px 20px rgba(0,0,0,.12) !important;"
			+ "}"
		

			/* ========================================================
			 * 浅色主题专属适配模块 (Celadon Porcelain 天青白瓷 & Sun Gold 阳光跃金)
			 * 严格限定于 html.dsh-theme-light 作用域，深色模式下 100% 物理隔离静默
			 * ======================================================== */
			+ "html.dsh-theme-light,html.dsh-theme-light body{color:#132624 !important;}"
			+ "html.dsh-theme-light *{border-color:rgba(13,148,136,.18);}"
			+ "html.dsh-theme-light body,html.dsh-theme-light #root,html.dsh-theme-light [class*='app'],html.dsh-theme-light [class*='chat-container'],html.dsh-theme-light [class*='main-content'],html.dsh-theme-light [class*='content-wrapper'],html.dsh-theme-light main{background:transparent !important;background-color:transparent !important;}"
			/* ① 侧边栏 (.b8812f16)：告别深黑死板大方块，赋予天青白瓷微透质感 */
			+ "html.dsh-theme-light .b8812f16,html.dsh-theme-light [class*='sidebar'],html.dsh-theme-light [class*='side-panel']{background:rgba(255,255,255,.50) !important;background-color:rgba(255,255,255,.50) !important;-webkit-backdrop-filter:blur(22px) !important;backdrop-filter:blur(22px) !important;border-right:1px solid rgba(13,148,136,.18) !important;}"
			+ "html.dsh-theme-light .b8812f16 *,html.dsh-theme-light [class*='sidebar'] *,html.dsh-theme-light [class*='side-panel'] *{color:#132624 !important;}"
			+ "html.dsh-theme-light .b8812f16 [class*='active'],html.dsh-theme-light .b8812f16 [class*='selected'],html.dsh-theme-light .b8812f16 [class*='current']{background:rgba(13,148,136,.16) !important;box-shadow:inset 0 0 0 1px rgba(13,148,136,.35) !important;border-radius:8px !important;color:#0d9488 !important;}"
			+ "html.dsh-theme-light .b8812f16 [class*='item']:hover,html.dsh-theme-light .b8812f16 [role='button']:hover{background:rgba(13,148,136,.10) !important;border-radius:8px !important;}"
			/* 左下角账号栏（实测 ._2afd28d，236×44，原生完全透明无框）：
			 *   原浅色规则给了实底 rgba(238,250,248,.85) + 1px 边框，导致常驻就有框 —— 与官方不符。
			 *   现改为：常驻透明无框（与官方一致），悬停时给青绿细框 + 极淡底作为反馈。 */
			+ "html.dsh-theme-light ._2afd28d{background:transparent !important;background-color:transparent !important;border-color:transparent !important;color:#132624 !important;transition:background-color .18s ease,border-color .18s ease !important;}"
			+ "html.dsh-theme-light ._2afd28d:hover{background:rgba(13,148,136,.08) !important;background-color:rgba(13,148,136,.08) !important;border-color:rgba(13,148,136,.40) !important;}"
			/* 账号栏头像（实测 .ede5bc47，32×32，圆形）：
			 *   深色段 L214 有 .b8812f16 .ede5bc47,.ede5bc47{...淡蓝底+蓝边} —— 那条无作用域前缀，
			 *   浅色下也生效，导致头像呈现"淡蓝按钮"观感。
			 *   此处仅在浅色作用域内改为主题青绿（深色那条保持原样不动）。 */
			+ "html.dsh-theme-light ._2afd28d .ede5bc47{background:rgba(13,148,136,.12) !important;background-color:rgba(13,148,136,.12) !important;border:1px solid rgba(13,148,136,.30) !important;color:#0d9488 !important;border-radius:50% !important;}"
			/* ② 顶部栏与标题 */
			+ "html.dsh-theme-light [class*='the-header'],html.dsh-theme-light .f8d1e4c0,html.dsh-theme-light ._1aa2651{background:transparent !important;background-color:transparent !important;border-bottom:1px solid rgba(13,148,136,.15) !important;}"
			/* 顶部对话标题胶囊（2026-11-11 实测精确结构）：
			 *   .f8d1e4c0.the-header                     896 宽 标题栏
			 *     └─ ._9fcbeda._7ee190f                 480×48 外层（横跨整条 header，勿动）
			 *          └─ .afa34042.e0a1edb7.e37a04e4    131×40 ← 真正的标题胶囊
			 *              原生 border 1px 透明 / radius 22px / padding 8px 12px
			 *   只作用于内层胶囊；绝不能挂到 480 宽外层上（会整条泛绿）。 */
			+ "html.dsh-theme-light ._9fcbeda .afa34042{border-color:transparent !important;background:transparent !important;background-color:transparent !important;transition:border-color .18s ease,background-color .18s ease !important;}"
			+ "html.dsh-theme-light ._9fcbeda .afa34042:hover{border-color:rgba(13,148,136,.55) !important;background:rgba(13,148,136,.06) !important;background-color:rgba(13,148,136,.06) !important;}"
			+ "html.dsh-theme-light ._9fcbeda .afa34042:hover *{color:#0d9488 !important;}"
			+ "html.dsh-theme-light [class*='the-header'] *{color:#132624 !important;}"
			/* ③ 浮层定位容器置纯透，实体气泡白瓷微透，根除全屏白雾 */
			+ "html.dsh-theme-light .ds-popper,html.dsh-theme-light [class*='ds-popper'],html.dsh-theme-light [class*='floating-ui-container'],html.dsh-theme-light [data-floating-ui-portal]{background:transparent !important;background-color:transparent !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;box-shadow:none !important;border:none !important;}"
			+ "html.dsh-theme-light .ds-popper [role='tooltip'],html.dsh-theme-light .ds-popper > div[class*='content'],html.dsh-theme-light [role='tooltip']{background:rgba(246,253,252,.96) !important;-webkit-backdrop-filter:blur(16px) saturate(140%) !important;backdrop-filter:blur(16px) saturate(140%) !important;border:1px solid rgba(13,148,136,.24) !important;border-radius:8px !important;color:#132624 !important;font-size:12px !important;line-height:1.4 !important;padding:6px 10px !important;box-shadow:0 6px 20px rgba(13,148,136,.14) !important;max-width:380px !important;}"
			/* ④ 消息行 hover 绝不添加背景色，根除重叠矩形块 */
			+ "html.dsh-theme-light [class*='message']:hover,html.dsh-theme-light [class*='chat-item']:hover,html.dsh-theme-light [class*='session']:hover{background:transparent !important;background-color:transparent !important;}"
			+ "html.dsh-theme-light [class*='message'] button:hover,html.dsh-theme-light [class*='chat-item'] button:hover,html.dsh-theme-light [class*='action-bar'] button:hover{background:rgba(13,148,136,.12) !important;color:#0d9488 !important;border-radius:6px !important;}"
			/* ⑤ 搜索网页结果小胶囊 (.f93f59e4) & 正文中搜索条 (._60aa7fb)：彻底纠正浅白色文字，恢复深碳青与天青高亮 */
			+ "html.dsh-theme-light .f93f59e4,html.dsh-theme-light [class*='search-result-pill'],html.dsh-theme-light [class*='source-tag']{background:rgba(246,253,252,.94) !important;background-color:rgba(246,253,252,.94) !important;border:1px solid rgba(13,148,136,.35) !important;box-shadow:0 2px 8px rgba(13,148,136,.08) !important;border-radius:9999px !important;color:#0f2320 !important;}"
			+ "html.dsh-theme-light .f93f59e4 *,html.dsh-theme-light .f93f59e4 ._669a677,html.dsh-theme-light [class*='search-result-pill'] *{color:#0f2320 !important;font-weight:500 !important;}"
			+ "html.dsh-theme-light .f93f59e4:hover{background:rgba(235,248,246,.98) !important;border-color:rgba(13,148,136,.65) !important;box-shadow:0 0 12px rgba(13,148,136,.20) !important;}"
			+ "html.dsh-theme-light .f93f59e4:hover *,html.dsh-theme-light .f93f59e4:hover ._669a677{color:#0d9488 !important;}"
			+ "html.dsh-theme-light ._60aa7fb::before{background:rgba(246,253,252,.94) !important;background-color:rgba(246,253,252,.94) !important;border:1px solid rgba(13,148,136,.35) !important;box-shadow:0 2px 8px rgba(13,148,136,.08) !important;border-radius:100px !important;}"
			+ "html.dsh-theme-light ._60aa7fb,html.dsh-theme-light ._60aa7fb *,html.dsh-theme-light [class*='search-chip'] *,html.dsh-theme-light [class*='search-status'] *{color:#0f2320 !important;font-weight:500 !important;}"
			+ "html.dsh-theme-light ._60aa7fb:hover::before{background:rgba(235,248,246,.98) !important;border-color:rgba(13,148,136,.65) !important;}"
			+ "html.dsh-theme-light ._60aa7fb:hover *{color:#0d9488 !important;}"
			
			/* ⑤-2 网站小圆形图标（彻底消除 #121c2a 实黑底，改为白瓷微透） */
			+ "html.dsh-theme-light ._8e95474,html.dsh-theme-light .site_logo_back,html.dsh-theme-light .site_logo_loading,html.dsh-theme-light .site_logo_fallback,html.dsh-theme-light [class*='site_logo']{background:#ffffff !important;background-color:#ffffff !important;border:none !important;box-shadow:0 0 0 1px rgba(13,148,136,.28),0 1px 3px rgba(0,0,0,.08) !important;border-radius:50% !important;}"
			
			/* ⑤-3 搜索结果右侧抽屉 (._519be07)：告别深黑死板大抽屉，赋予天青白瓷毛玻璃 */
			+ "html.dsh-theme-light ._519be07{background:rgba(255,255,255,.94) !important;background-color:rgba(255,255,255,.94) !important;-webkit-backdrop-filter:blur(24px) saturate(140%) !important;backdrop-filter:blur(24px) saturate(140%) !important;border-left:1px solid rgba(13,148,136,.28) !important;box-shadow:-8px 0 32px rgba(12,85,80,.12) !important;color:#0f2320 !important;}"
			+ "html.dsh-theme-light ._519be07 *{color:#0f2320 !important;}"
			+ "html.dsh-theme-light ._519be07 div[class*='item'],html.dsh-theme-light ._519be07 [role='listitem']{background-color:rgba(246,253,252,.85) !important;border:1px solid rgba(13,148,136,.20) !important;border-radius:10px !important;transition:all .15s ease !important;}"
			+ "html.dsh-theme-light ._519be07 div[class*='item']:hover,html.dsh-theme-light ._519be07 [role='listitem']:hover{background-color:rgba(235,248,246,.98) !important;border-color:rgba(13,148,136,.50) !important;box-shadow:0 2px 10px rgba(13,148,136,.12) !important;}"
			+ "html.dsh-theme-light ._519be07 [class*='header'],html.dsh-theme-light ._519be07 [style*='border-bottom']{border-bottom:1px solid rgba(13,148,136,.18) !important;}"
			+ "html.dsh-theme-light ._519be07 button,html.dsh-theme-light ._519be07 [role='button']{color:#0f2320 !important;}"
			+ "html.dsh-theme-light ._519be07 button:hover,html.dsh-theme-light ._519be07 [role='button']:hover{color:#0d9488 !important;}"
			
			/* ⑤-4 正文内引用角标 ([1] [2])：天青白瓷小方块（覆盖所有后代与兄弟节点，彻底根除深黑方块） */
			+ "html.dsh-theme-light .ds-markdown-cite,html.dsh-theme-light .e4c3fd02::before,html.dsh-theme-light [class*='ds-citation'],html.dsh-theme-light [class*='citation'],html.dsh-theme-light [class*='citation']::before,html.dsh-theme-light [class*='reference'],html.dsh-theme-light [class*='reference']::before,html.dsh-theme-light .ds-markdown a + span,html.dsh-theme-light .ds-markdown a > span:last-child,html.dsh-theme-light .ds-markdown a > i,html.dsh-theme-light .ds-markdown a [class*='icon'],html.dsh-theme-light .ds-markdown sup,html.dsh-theme-light .ds-markdown [class*='cite'],html.dsh-theme-light .ds-markdown [class*='footnote']{background:rgba(235,248,246,.95) !important;background-color:rgba(235,248,246,.95) !important;border:1px solid rgba(13,148,136,.35) !important;color:#0d9488 !important;border-radius:4px !important;box-shadow:0 1px 3px rgba(13,148,136,.08) !important;font-weight:600 !important;padding:0 4px !important;display:inline-block !important;vertical-align:middle !important;transition:all .15s ease !important;}"
			+ "html.dsh-theme-light .ds-markdown-cite:hover,html.dsh-theme-light .e4c3fd02:hover::before,html.dsh-theme-light [class*='ds-citation']:hover,html.dsh-theme-light .ds-markdown a + span:hover,html.dsh-theme-light .ds-markdown a > span:last-child:hover{background:#0d9488 !important;background-color:#0d9488 !important;border-color:#0d9488 !important;color:#ffffff !important;box-shadow:0 0 8px rgba(13,148,136,.40) !important;}"
			+ "html.dsh-theme-light .e4c3fd02,html.dsh-theme-light .e4c3fd02 *,html.dsh-theme-light .ds-markdown a + span *,html.dsh-theme-light .ds-markdown a > span:last-child *,html.dsh-theme-light .ds-markdown sup *{color:#0d9488 !important;fill:currentColor !important;}"
			
			/* ⑥ 输入框常驻态、悬停态、聚焦态三态闭环锁定：悬停泛出淡雅天青色，发送按钮与深度思考/智能搜索青色高辨识度 */
			+ "html.dsh-theme-light ._77cefa5{background:rgba(203,240,234,.63) !important;background-color:rgba(203,240,234,.63) !important;-webkit-backdrop-filter:blur(24px) saturate(165%) !important;backdrop-filter:blur(24px) saturate(165%) !important;border:1px solid rgba(13,148,136,.30) !important;box-shadow:0 4px 18px rgba(12,85,80,.08),inset 0 1px 0 rgba(255,255,255,.60) !important;border-radius:14px !important;transition:all .2s ease !important;}"
			+ "html.dsh-theme-light ._77cefa5:hover,html.dsh-theme-light ._77cefa5:focus-within{background:rgba(203,240,234,.63) !important;background-color:rgba(203,240,234,.63) !important;border-color:rgba(13,148,136,.28) !important;box-shadow:0 6px 24px rgba(12,85,80,.12),0 0 0 1px rgba(13,148,136,.22),inset 0 1px 0 rgba(255,255,255,.95) !important;}"
			+ "html.dsh-theme-light ._77cefa5 textarea,html.dsh-theme-light ._77cefa5 input,html.dsh-theme-light ._77cefa5 [contenteditable]{color:#132624 !important;-webkit-text-fill-color:#132624 !important;caret-color:#0d9488 !important;background:transparent !important;background-color:transparent !important;}"
			+ "html.dsh-theme-light ._77cefa5 textarea::placeholder,html.dsh-theme-light ._77cefa5 input::placeholder{color:rgba(19,38,36,.50) !important;-webkit-text-fill-color:rgba(19,38,36,.50) !important;}"
			/* 深度思考与智能搜索按钮：纯正天青体系，常驻态微透浅青底，告别苍白弱对比 */
			/* 开关胶囊（深度思考 / 智能搜索）—— 2026-11-11 透明度调优：
			 *   主人反馈"方向对了，再更透明一些、适配整个主题"。
			 *   思路：两态底色都压低不透明度，让青瓷面板底透上来，只保留"有无一层绿"的差异。
			 *     关闭 = 近乎无底的白色薄雾 rgba(255,255,255,.28) + 墨青字
			 *     开启 = 极淡透明绿 rgba(13,148,136,.10) + 青绿字
			 *   边框同步减淡，避免出现"硬框"感。真实选中类名 ds-toggle-button--selected。 */
			/* —— 关闭态 —— */
			+ "html.dsh-theme-light .ds-toggle-button{border:1px solid rgba(13,148,136,.26) !important;background:rgba(255,255,255,.28) !important;background-color:rgba(255,255,255,.28) !important;color:#4d6b66 !important;border-radius:18px !important;box-shadow:none !important;transition:background-color .18s ease,color .18s ease,border-color .18s ease !important;}"
			+ "html.dsh-theme-light .ds-toggle-button *{color:#4d6b66 !important;fill:currentColor !important;font-weight:500 !important;}"
			/* —— 关闭态悬停：微微浮起 —— */
			+ "html.dsh-theme-light .ds-toggle-button:hover{background:rgba(255,255,255,.52) !important;background-color:rgba(255,255,255,.52) !important;border-color:rgba(13,148,136,.42) !important;color:#0f766e !important;}"
			+ "html.dsh-theme-light .ds-toggle-button:hover *{color:#0f766e !important;}"
			/* —— 开启态：极淡透明绿 + 青绿字 —— */
			+ "html.dsh-theme-light .ds-toggle-button--selected,html.dsh-theme-light .ds-toggle-button--select,html.dsh-theme-light .ds-toggle-button[class*='--selected']{background:rgba(13,148,136,.035) !important;background-color:rgba(13,148,136,.035) !important;border-color:rgba(13,148,136,.24) !important;color:#0d9488 !important;box-shadow:none !important;}"
			+ "html.dsh-theme-light .ds-toggle-button--selected *,html.dsh-theme-light .ds-toggle-button--select *,html.dsh-theme-light .ds-toggle-button[class*='--selected'] *{color:#279e93 !important;fill:#279e93 !important;font-weight:500 !important;}"
			/* —— 开启态悬停：略加深 —— */
			+ "html.dsh-theme-light .ds-toggle-button--selected:hover,html.dsh-theme-light .ds-toggle-button[class*='--selected']:hover{background:rgba(13,148,136,.09) !important;background-color:rgba(13,148,136,.18) !important;border-color:rgba(13,148,136,.58) !important;}"
			/* 输入框发送按钮与附件按钮：未输入态清晰浅青轮廓，输入态全青高亮 */
			+ "html.dsh-theme-light ._77cefa5 button,html.dsh-theme-light ._77cefa5 [role='button']{color:#0d9488 !important;}"
			+ "html.dsh-theme-light ._77cefa5 button:hover,html.dsh-theme-light ._77cefa5 [role='button']:hover{color:#0f766e !important;}"
			+ "html.dsh-theme-light ._77cefa5 button[class*='send'],html.dsh-theme-light ._77cefa5 [class*='send-button'],html.dsh-theme-light ._77cefa5 [role='button'][aria-label*='发送'],html.dsh-theme-light ._77cefa5 [role='button'][aria-label*='Send'],html.dsh-theme-light ._77cefa5 [role='button'][class*='submit']{background:#0d9488 !important;background-color:#0d9488 !important;border:1px solid #0d9488 !important;border-radius:50% !important;color:#ffffff !important;opacity:1 !important;box-shadow:0 2px 8px rgba(13,148,136,.35) !important;}"
			+ "html.dsh-theme-light ._77cefa5 button[class*='send'] *,html.dsh-theme-light ._77cefa5 [class*='send-button'] *{color:#ffffff !important;fill:#ffffff !important;}"
			/* 2026-11-11 发送按钮强调色（实测：ds-button--primary ds-button--filled 34x34 圆）
			 *     原生为蓝色底 rgb(57,100,254)，未输入时 opacity 0.4 → 在青瓷底上几乎不可见。
			 *     方案 A：保留"未输入/可发送"两态区分，但把未输入态也做成看得清的浅青。 */
			/* 可发送态（opacity 已由原生置 1）：青绿实心 + 白箭头 */
			+ "html.dsh-theme-light ._77cefa5 .ds-button--primary,html.dsh-theme-light ._77cefa5 [class*='ds-button--primary'],html.dsh-theme-light ._77cefa5 [class*='ds-button--filled']{background:#0d9488 !important;background-color:#0d9488 !important;color:#ffffff !important;border:1px solid #0d9488 !important;box-shadow:0 2px 8px rgba(13,148,136,.32) !important;}"
			+ "html.dsh-theme-light ._77cefa5 .ds-button--primary *,html.dsh-theme-light ._77cefa5 [class*='ds-button--primary'] *{color:#ffffff !important;fill:#ffffff !important;}"
			+ "html.dsh-theme-light ._77cefa5 button:disabled,html.dsh-theme-light ._77cefa5 [disabled]{opacity:.85 !important;background:rgba(13,148,136,.12) !important;border:1px solid rgba(13,148,136,.30) !important;color:#0d9488 !important;}"
			+ "html.dsh-theme-light ._77cefa5 button:disabled *,html.dsh-theme-light ._77cefa5 [disabled] *{color:#0d9488 !important;fill:currentColor !important;opacity:.65 !important;}"
			
			/* ⑦ 右侧会话大纲/浮动导航（同构映射深色模式行 258-312 架构） */
			/* ① 常驻窄条 (._6ffc3c9) 与定位容器 (._189b4a0)：彻底透明，绝不遮挡平常显示的短横条 */
			+ "html.dsh-theme-light [class*='ds-navigator'],html.dsh-theme-light [class*='chat-navigator'],html.dsh-theme-light [class*='toc-container']{background:transparent !important;background-color:transparent !important;border:none !important;box-shadow:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;border-radius:0 !important;}"
			+ "html.dsh-theme-light ._189b4a0,html.dsh-theme-light ._6ffc3c9,html.dsh-theme-light ._6ffc3c9:hover{background:transparent !important;background-color:transparent !important;background-image:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;border:none !important;box-shadow:none !important;border-radius:0 !important;}"
			
			/* ②a 常驻态展开面板 (._4ce999d)：彻底透明（不碰任何子元素，平常完美显示短条） */
			+ "html.dsh-theme-light ._4ce999d{background:transparent !important;background-color:transparent !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;border-color:transparent !important;box-shadow:none !important;}"
			
			/* ②b hover 态：鼠标移动上去展开纯色半透明白瓷面板（单一纯净透光，毛玻璃磨砂质感） */
			+ "html.dsh-theme-light ._4ce999d{transition:background-color .2s ease,box-shadow .2s ease,border-color .2s ease !important;}"
			+ "html.dsh-theme-light ._189b4a0:hover ._4ce999d,html.dsh-theme-light ._189b4a0:hover ._4ce999d:hover,html.dsh-theme-light ._4ce999d:hover{background:rgba(203,240,234,.62) !important;background-color:rgba(203,240,234,.62) !important;background-image:none !important;-webkit-backdrop-filter:blur(10px) saturate(170%) !important;backdrop-filter:blur(10px) saturate(170%) !important;border:1px solid rgba(13,148,136,.42) !important;border-radius:14px !important;box-shadow:0 14px 40px rgba(12,85,80,.20),0 1px 0 rgba(255,255,255,.92) inset !important;box-sizing:border-box !important;padding:6px 0 !important;overflow-x:hidden !important;}"
			/* ②b2 仅剥除「中间滚动列表大包装层」的白底 —— 绝不能用全量 *：
			 *     右侧小短条（普通灰条 / 当前项高亮条）是叶子元素，横条形态完全靠自身
			 *     background-color 绘制；一旦被 * 清成 transparent 就会整体蒸发消失。
			 *     故只点名包装容器，保住叶子指示条。 */
			+ "html.dsh-theme-light ._4ce999d > div,html.dsh-theme-light ._4ce999d > ul,html.dsh-theme-light ._4ce999d > section,html.dsh-theme-light ._4ce999d div[class*='list'],html.dsh-theme-light ._4ce999d div[class*='items'],html.dsh-theme-light ._4ce999d div[class*='virtual'],html.dsh-theme-light ._4ce999d div[class*='scroll'],html.dsh-theme-light ._4ce999d div[class*='gutters']{background:transparent !important;background-color:transparent !important;box-shadow:none !important;}"
			
			/* ②c 标题默认态 —— 2026-11-11 关键修正：不再给后代统一 !important 墨色。
			 *     原因：DeepSeek 原生 hover 靠「灰 rgb(129,133,140) → 近黑 rgb(15,17,21)」逐行变色，
			 *     上面这种「div,span,a,p,li 全量 color !important」会把每一行的颜色锁死，
			 *     原生变色被压掉，表现就是「悬停毫无反应」。
			 *     现只给面板容器一个基础色，由子元素自然继承/被原生覆盖，保留逐行交互。 */
			+ "html.dsh-theme-light ._189b4a0:hover ._4ce999d{color:#0f2320 !important;}"
			
			/* ②d 单项悬停 —— 2026-11-10 第三轮根治（采纳赫珀方案 B）：
			 *     1. 绝不给悬停项任何 background：色块堆叠的根源就是它；
			 *     2. 绝不用 :hover * 宽后代选择器：大容器一旦被命中，整表 8 行全绿；
			 *     3. 只对「直接子文本节点容器」变色，即 > span / > a，深度可控。 */
			+ "html.dsh-theme-light ._4ce999d a:hover,html.dsh-theme-light ._4ce999d [role='button']:hover > span,html.dsh-theme-light ._4ce999d [role='button']:hover > a,html.dsh-theme-light ._4ce999d li:hover > span,html.dsh-theme-light ._4ce999d li:hover > a{color:#0d9488 !important;font-weight:600 !important;}"
			
			/* ②d2 右侧小短条（实测类名 fae5876e）：
			 *     普通条原生 rgba(0,0,0,.16) 8x2，当前项高亮条 rgb(57,100,254) 12x3。
			 *     两者同类名、靠尺寸与色值区分，CSS 无法按计算尺寸筛选，故统一染青绿；
			 *     当前项仍可凭「更长（12px）更粗（3px）」与位置辨认。 */
			+ "html.dsh-theme-light ._4ce999d .fae5876e{background-color:rgba(13,148,136,.42) !important;background:rgba(13,148,136,.42) !important;}"
			
			/* ②d3 标题行单项悬停小胶囊（贯彻单层承载，严格排除短条，杜绝套娃色块） */
			+ "html.dsh-theme-light ._4ce999d ._81e7b5e{transition:background-color .15s ease,color .15s ease !important;border-radius:6px !important;}"
			+ "html.dsh-theme-light ._4ce999d ._81e7b5e:hover{background:rgba(13,148,136,.12) !important;background-color:rgba(13,148,136,.12) !important;border-radius:6px !important;}"
			+ "html.dsh-theme-light ._4ce999d ._81e7b5e:hover ._72b6158,html.dsh-theme-light ._4ce999d ._81e7b5e:hover span,html.dsh-theme-light ._4ce999d ._81e7b5e:hover a{color:#0d9488 !important;}"
			+ "html.dsh-theme-light ._4ce999d ._81e7b5e *:not(.fae5876e),html.dsh-theme-light ._4ce999d ._81e7b5e:hover *:not(.fae5876e){background:transparent !important;background-color:transparent !important;border:none !important;box-shadow:none !important;}"
			
			/* ②e 当前阅读位置激活项 —— 2026-11-11 实测结构：
			 *     外层行多一个标记类 _19d617c，蓝色同时落在两处：
			 *       内层文字 _72b6158  → color: rgb(57,100,254)
			 *       右侧短条 fae5876e  → background-color: rgb(57,100,254)
			 *     主人要求蓝色改青色，故只覆盖激活态，不影响普通灰条与原生悬停黑字。 */
			+ "html.dsh-theme-light ._4ce999d ._81e7b5e._19d617c,html.dsh-theme-light ._4ce999d ._81e7b5e._19d617c *{color:#0d9488 !important;}"
			+ "html.dsh-theme-light ._4ce999d ._81e7b5e._19d617c .fae5876e{background-color:#0d9488 !important;background:#0d9488 !important;}"
			
			/* ②f 展开面板滚动条极简轻量化（浅灰微透，绝无大块） */
			+ "html.dsh-theme-light ._4ce999d::-webkit-scrollbar{width:4px !important;background:transparent !important;}"
			+ "html.dsh-theme-light ._4ce999d::-webkit-scrollbar-track{background:transparent !important;}"
			+ "html.dsh-theme-light ._4ce999d::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18) !important;border-radius:9999px !important;}"
			+ "html.dsh-theme-light ._4ce999d::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.35) !important;}"
			
			/* ⑧ 设置弹窗、账号菜单与下拉控件白瓷化 */
			+ "html.dsh-theme-light [role='dialog']{background:rgba(255,255,255,.94) !important;-webkit-backdrop-filter:blur(24px) saturate(140%) !important;backdrop-filter:blur(24px) saturate(140%) !important;border:1px solid rgba(13,148,136,.28) !important;box-shadow:0 16px 48px rgba(13,148,136,.18) !important;border-radius:16px !important;color:#132624 !important;}"
			+ "html.dsh-theme-light [role='dialog'] *{color:#132624 !important;}"
			+ "html.dsh-theme-light [class*='modal-mask'],html.dsh-theme-light [class*='overlay']{background:rgba(15,35,32,.25) !important;-webkit-backdrop-filter:blur(4px) !important;backdrop-filter:blur(4px) !important;}"
			+ "html.dsh-theme-light .dshc-pure-text-btn{background:transparent !important;border:none !important;box-shadow:none !important;color:#0d9488 !important;padding:0 4px !important;height:auto !important;min-height:unset !important;border-radius:0 !important;}"
			+ "html.dsh-theme-light .dshc-pure-text-btn:hover{color:#0f766e !important;text-decoration:underline !important;}"
			
			/* ⑧-1 账号菜单容器 (Dropdown Menu & Floating Portal) 白瓷化 */
			+ "html.dsh-theme-light .ds-dropdown-menu,html.dsh-theme-light [role='menu'],html.dsh-theme-light [class*='dropdown-menu']:not([class*='option']),html.dsh-theme-light [class*='ds-dropdown'][class*='__panel'],html.dsh-theme-light .ds-popover:has([role='menuitem']),html.dsh-theme-light [data-floating-ui-portal] [role='menu'],html.dsh-theme-light [data-radix-popper-content-wrapper]:has([role='menuitem']) > div{background:rgba(255,255,255,.96) !important;background-color:rgba(255,255,255,.96) !important;-webkit-backdrop-filter:blur(24px) saturate(140%) !important;backdrop-filter:blur(24px) saturate(140%) !important;border:1px solid rgba(13,148,136,.28) !important;border-radius:12px !important;box-shadow:0 12px 36px rgba(12,85,80,.15),0 0 0 1px rgba(13,148,136,.12) !important;padding:6px !important;}"
			/* 菜单选项整行（唯一高亮胶囊，排除 __icon 与 __label 等子元素，杜绝叠色） */
			+ "html.dsh-theme-light .ds-dropdown-menu-option,html.dsh-theme-light [class*='ds-dropdown-menu-option']:not([class*='__']),html.dsh-theme-light [role='menuitem']{background:transparent !important;background-color:transparent !important;border:none !important;border-radius:8px !important;box-shadow:none !important;outline:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;transition:background-color .15s ease,color .15s ease !important;}"
			+ "html.dsh-theme-light .ds-dropdown-menu-option:hover,html.dsh-theme-light [class*='ds-dropdown-menu-option']:not([class*='__']):hover,html.dsh-theme-light [role='menuitem']:hover{background:rgba(13,148,136,.12) !important;background-color:rgba(13,148,136,.12) !important;border-radius:8px !important;}"
			/* 彻底清空子元素（图标、文字、svg、span、伪元素等），剥除一切背景、边框与模糊滤镜，杜绝套娃色块 */
			+ "html.dsh-theme-light [class*='ds-dropdown-menu-option'] *,html.dsh-theme-light [class*='ds-dropdown-menu-option'] *::before,html.dsh-theme-light [class*='ds-dropdown-menu-option'] *::after,html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover *,html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover *::before,html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover *::after,html.dsh-theme-light [role='menuitem'] *,html.dsh-theme-light [role='menuitem'] *::before,html.dsh-theme-light [role='menuitem'] *::after,html.dsh-theme-light [role='menuitem']:hover *,html.dsh-theme-light [role='menuitem']:hover *::before,html.dsh-theme-light [role='menuitem']:hover *::after{background:transparent !important;background-color:transparent !important;border:none !important;border-radius:0 !important;box-shadow:none !important;outline:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}"
			/* 默认态颜色：深墨绿 #0f2320 */
			+ "html.dsh-theme-light [class*='ds-dropdown-menu-option'] [class*='ds-dropdown-menu-option__label'],html.dsh-theme-light [class*='ds-dropdown-menu-option'] span,html.dsh-theme-light [role='menuitem'] span{color:#0f2320 !important;}"
			+ "html.dsh-theme-light [class*='ds-dropdown-menu-option'] [class*='ds-dropdown-menu-option__icon'],html.dsh-theme-light [class*='ds-dropdown-menu-option'] svg,html.dsh-theme-light [role='menuitem'] svg{color:#0f2320 !important;fill:currentColor !important;}"
			/* 悬停态高权重压制深色段白字：文字与图标统一呈现天青高亮色 #0d9488 */
			+ "html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover [class*='ds-dropdown-menu-option__label'],html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover span,html.dsh-theme-light [role='menuitem']:hover span{color:#0d9488 !important;}"
			+ "html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover [class*='ds-dropdown-menu-option__icon'],html.dsh-theme-light [class*='ds-dropdown-menu-option']:hover svg,html.dsh-theme-light [role='menuitem']:hover svg{color:#0d9488 !important;fill:currentColor !important;}"
			
			/* ⑧-2 设置弹窗左侧 Tab（通用设置/账号管理...）统一承载与右上角关闭按钮清空 */
			/* 外层 Tab 容器：保持透明无框，仅由 background 层统一承载胶囊高亮 */
			+ "html.dsh-theme-light [role='dialog'] [role='tab'],html.dsh-theme-light [role='dialog'] [class*='tab-item'],html.dsh-theme-light [role='dialog'] .ds-button--capsule,html.dsh-theme-light [role='dialog'] [class*='sidebar'] [role='tab'],html.dsh-theme-light [role='dialog'] [role='tablist'] [role='tab']{border:none !important;background:transparent !important;background-color:transparent !important;box-shadow:none !important;}"
			/* 常驻态底板：细青边框，与主题卡片一致 */
			+ "html.dsh-theme-light [role='dialog'] [role='tab'] [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-button--capsule [class*='ds-button__background']{border:1px solid rgba(13,148,136,.22) !important;border-radius:10px !important;background:transparent !important;transition:border-color .2s ease,background-color .2s ease,box-shadow .2s ease !important;}"
			/* 悬停态：外层容器彻底纯透无框，绝不冒出深灰方块；仅由内层 background 底板呈现天青胶囊高亮 */
			+ "html.dsh-theme-light [role='dialog'] [role='tab']:hover,html.dsh-theme-light [role='dialog'] [class*='tab-item']:hover,html.dsh-theme-light [role='dialog'] .ds-button--capsule:hover,html.dsh-theme-light [role='dialog'] [class*='sidebar'] *:hover,html.dsh-theme-light [role='dialog'] [role='tablist'] *:hover,html.dsh-theme-light [role='dialog'] .ds-modal-content__main [role='button']:hover,html.dsh-theme-light [role='dialog'] .ds-modal-content>div:first-child [role='button']:hover{background:transparent !important;background-color:transparent !important;border:none !important;border-color:transparent !important;box-shadow:none !important;}"
			+ "html.dsh-theme-light [role='dialog'] [role='tab']:hover [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-button--capsule:hover [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-modal-content__main [role='button']:hover [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-modal-content>div:first-child [role='button']:hover [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] [class*='sidebar'] [role='button']:hover [class*='ds-button__background']{border:1px solid rgba(13,148,136,.65) !important;background:rgba(13,148,136,.16) !important;background-color:rgba(13,148,136,.16) !important;box-shadow:0 0 12px rgba(13,148,136,.20) !important;border-radius:10px !important;}"
			+ "html.dsh-theme-light [role='dialog'] [role='tab']:hover *,html.dsh-theme-light [role='dialog'] .ds-button--capsule:hover *,html.dsh-theme-light [role='dialog'] .ds-modal-content__main [role='button']:hover *,html.dsh-theme-light [role='dialog'] .ds-modal-content>div:first-child [role='button']:hover *{color:#0d9488 !important;fill:currentColor !important;}"
			/* 彻底清空 Tab 子层（文字 content、图标 icon、以及原生 ::before/::after 伪元素），剥除任何内层背景、边框与内圈圆角，消灭文字胶囊与半月牙弧线残影/小圈圈 */
			+ "html.dsh-theme-light [role='dialog'] [role='tab'] *,html.dsh-theme-light [role='dialog'] [role='tab'] *::before,html.dsh-theme-light [role='dialog'] [role='tab'] *::after,html.dsh-theme-light [role='dialog'] .ds-button--capsule *,html.dsh-theme-light [role='dialog'] .ds-button--capsule *::before,html.dsh-theme-light [role='dialog'] .ds-button--capsule *::after,html.dsh-theme-light [role='dialog'] [class*='sidebar'] *::before,html.dsh-theme-light [role='dialog'] [class*='sidebar'] *::after,html.dsh-theme-light [role='dialog'] [role='tablist'] *::before,html.dsh-theme-light [role='dialog'] [role='tablist'] *::after,html.dsh-theme-light [role='dialog'] .ds-modal-content>div:first-child *::before,html.dsh-theme-light [role='dialog'] .ds-modal-content>div:first-child *::after{background:transparent !important;background-color:transparent !important;border:none !important;border-width:0 !important;border-radius:0 !important;box-shadow:none !important;outline:none !important;}"
			/* 选中项（涵盖 _699d482 及各类 active 标记）：整行一体受光，高权重压制 */
			+ "html.dsh-theme-light [role='dialog'] [role='tab']._699d482 [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] [role='tab'][aria-selected='true'] [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] [role='tab'][class*='selected'] [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] [role='tab'][class*='active'] [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-button--capsule._699d482 [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-button--capsule[aria-selected='true'] [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-button--capsule[class*='selected'] [class*='ds-button__background'],html.dsh-theme-light [role='dialog'] .ds-button--capsule[class*='active'] [class*='ds-button__background']{border-color:rgba(13,148,136,.75) !important;background-color:rgba(13,148,136,.20) !important;box-shadow:0 0 10px rgba(13,148,136,.20) !important;}"
			+ "html.dsh-theme-light [role='dialog'] [role='tab']._699d482,html.dsh-theme-light [role='dialog'] [role='tab'][aria-selected='true'],html.dsh-theme-light [role='dialog'] [role='tab'][class*='selected'],html.dsh-theme-light [role='dialog'] [role='tab'][class*='active'],html.dsh-theme-light [role='dialog'] .ds-button--capsule._699d482,html.dsh-theme-light [role='dialog'] .ds-button--capsule[aria-selected='true'],html.dsh-theme-light [role='dialog'] .ds-button--capsule[class*='selected'],html.dsh-theme-light [role='dialog'] .ds-button--capsule[class*='active']{color:#0d9488 !important;font-weight:600 !important;}"
			+ "html.dsh-theme-light [role='dialog'] [role='tab']._699d482 *,html.dsh-theme-light [role='dialog'] [role='tab'][aria-selected='true'] *,html.dsh-theme-light [role='dialog'] [role='tab'][class*='selected'] *,html.dsh-theme-light [role='dialog'] [role='tab'][class*='active'] *,html.dsh-theme-light [role='dialog'] .ds-button--capsule._699d482 *,html.dsh-theme-light [role='dialog'] .ds-button--capsule[aria-selected='true'] *,html.dsh-theme-light [role='dialog'] .ds-button--capsule[class*='selected'] *,html.dsh-theme-light [role='dialog'] .ds-button--capsule[class*='active'] *{color:#0d9488 !important;font-weight:600 !important;}"
			/* 弹窗右上角关闭按钮：彻底剥除常驻方框与背景，hover 呈现平滑天青圆形微光，绝无突兀小方框/小圈圈 */
			+ "html.dsh-theme-light .ds-modal-content__close,html.dsh-theme-light [class*='modal-content__close'],html.dsh-theme-light [class*='modal__close'],html.dsh-theme-light [class*='dialog__close'],html.dsh-theme-light [class*='close-btn'],html.dsh-theme-light .ds-modal-content__close *,html.dsh-theme-light [class*='modal-content__close'] *{border:none !important;border-width:0 !important;border-color:transparent !important;background:transparent !important;background-color:transparent !important;box-shadow:none !important;outline:none !important;}"
			+ "html.dsh-theme-light .ds-modal-content__close [class*='ds-button__background'],html.dsh-theme-light [class*='modal-content__close'] [class*='ds-button__background']{border:none !important;border-width:0 !important;background:transparent !important;background-color:transparent !important;box-shadow:none !important;border-radius:4096px !important;}"
			+ "html.dsh-theme-light .ds-modal-content__close [class*='ds-button__background']::before,html.dsh-theme-light .ds-modal-content__close [class*='ds-button__background']::after,html.dsh-theme-light [class*='modal-content__close'] [class*='ds-button__background']::before,html.dsh-theme-light [class*='modal-content__close'] [class*='ds-button__background']::after{border:none !important;border-width:0 !important;background:transparent !important;box-shadow:none !important;}"
			+ "html.dsh-theme-light .ds-modal-content__close:hover,html.dsh-theme-light [class*='modal-content__close']:hover,html.dsh-theme-light .ds-modal-content__close:hover [class*='ds-button__background'],html.dsh-theme-light [class*='modal-content__close']:hover [class*='ds-button__background']{background-color:rgba(13,148,136,.12) !important;border-radius:4096px !important;}"
			+ "html.dsh-theme-light .ds-modal-content__close svg,html.dsh-theme-light [class*='modal-content__close'] svg{color:#132624 !important;transition:color .15s ease !important;}"
			+ "html.dsh-theme-light .ds-modal-content__close:hover svg,html.dsh-theme-light [class*='modal-content__close']:hover svg{color:#0d9488 !important;}"
			/* 主题卡片（浅色/深色/跟随系统）：白瓷底色与选中天青高亮，彻底根除深色模式灰蓝底穿透 */
			+ "html.dsh-theme-light .dsh-theme-card,html.dsh-theme-light [class*='theme-card'],html.dsh-theme-light [class*='theme-item'],html.dsh-theme-light [class*='radio-card'],html.dsh-theme-light [class*='theme-option']{background:rgba(255,255,255,.90) !important;background-color:rgba(255,255,255,.90) !important;border:1px solid rgba(13,148,136,.25) !important;border-radius:12px !important;transition:all .2s ease !important;}"
			+ "html.dsh-theme-light .dsh-theme-card:hover,html.dsh-theme-light [class*='theme-card']:hover,html.dsh-theme-light [class*='theme-item']:hover,html.dsh-theme-light [class*='radio-card']:hover{border-color:rgba(13,148,136,.55) !important;background:rgba(235,248,246,.95) !important;box-shadow:0 0 12px rgba(13,148,136,.18) !important;}"
			+ "html.dsh-theme-light .dsh-theme-card[class*='checked'],html.dsh-theme-light .dsh-theme-card[data-state='checked'],html.dsh-theme-light [class*='theme-card'][class*='checked'],html.dsh-theme-light [class*='theme-card'][data-state='checked'],html.dsh-theme-light [class*='radio-card'][class*='checked'],html.dsh-theme-light [class*='radio-card'][data-state='checked'],html.dsh-theme-light [class*='theme-item'][class*='checked'],html.dsh-theme-light [class*='theme-item'][data-state='checked']{background:rgba(13,148,136,.18) !important;background-color:rgba(13,148,136,.18) !important;border-color:rgba(13,148,136,.75) !important;box-shadow:0 0 14px rgba(13,148,136,.25) !important;}"
			+ "html.dsh-theme-light [class*='radio-card'][class*='checked'] *,html.dsh-theme-light [class*='radio-card'][data-state='checked'] *,html.dsh-theme-light .dsh-theme-card[class*='checked'] *,html.dsh-theme-light .dsh-theme-card[data-state='checked'] *{color:#0d9488 !important;font-weight:600 !important;}"
			+ "html.dsh-theme-light .dsh-theme-card *,html.dsh-theme-light [class*='theme-card'] *,html.dsh-theme-light [class*='theme-item'] *,html.dsh-theme-light [class*='radio-card'] *{background:transparent !important;background-color:transparent !important;box-shadow:none !important;}"
			
			/* ⑧-3 设置弹窗右侧按钮（管理、登出、注销）—— 严格排除关闭按钮、子元素及左侧 Tab，杜绝误伤与叠框 */
			+ "html.dsh-theme-light [role='dialog'] [class*='ds-button']:not([class*='__']):not(.ds-button--capsule):not(.dshc-pure-text-btn):not([class*='close']):not([class*='modal-content__close']):not([role='tab']):not([class*='tab']){border:1px solid rgba(13,148,136,.25) !important;color:#0f2320 !important;border-radius:8px !important;}"
			+ "html.dsh-theme-light [role='dialog'] [class*='ds-button']:not([class*='__']):not(.ds-button--capsule):not(.dshc-pure-text-btn):not([class*='close']):not([class*='modal-content__close']):not([role='tab']):not([class*='tab']):hover{background:rgba(13,148,136,.10) !important;border-color:rgba(13,148,136,.50) !important;color:#0d9488 !important;}"
			
			/* ⑧-4 语言与朗读音色下拉框 (Select Trigger) 与下拉菜单 (Select Menu / Listbox) 白瓷化 */
			/* 下拉触发器外层画框，内层一律透明，防双框 */
			+ "html.dsh-theme-light .ds-modal-content .ds-select,html.dsh-theme-light .ds-modal-content .e311289c{background:rgba(246,253,252,.92) !important;background-color:rgba(246,253,252,.92) !important;border:1px solid rgba(13,148,136,.32) !important;border-radius:18px !important;box-shadow:0 2px 8px rgba(13,148,136,.08) !important;color:#0f2320 !important;}"
			+ "html.dsh-theme-light .ds-modal-content .ds-select:hover,html.dsh-theme-light .ds-modal-content .e311289c:hover{background:rgba(235,248,246,.98) !important;border-color:rgba(13,148,136,.55) !important;box-shadow:0 0 12px rgba(13,148,136,.20) !important;}"
			+ "html.dsh-theme-light .ds-modal-content .ds-select .ds-select__select,html.dsh-theme-light .ds-modal-content [class*='ds-select__trigger']{border:none !important;background:transparent !important;background-color:transparent !important;box-shadow:none !important;color:#0f2320 !important;}"
			+ "html.dsh-theme-light .ds-modal-content .ds-select .ds-select__arrow,html.dsh-theme-light .ds-modal-content [class*='ds-select__trigger'] svg{color:#0d9488 !important;}"
			/* 浮动下拉面板：贯彻单层承载原则，外层包裹层一律清空透明，只由本体 .ds-select-menu 渲染白瓷毛玻璃，彻底消灭双层面板重叠 */
			+ "html.dsh-theme-light [data-radix-popper-content-wrapper],html.dsh-theme-light [data-floating-ui-portal],html.dsh-theme-light .ds-popper:has(.ds-select-menu),html.dsh-theme-light .ds-popper:has([role='listbox']){background:transparent !important;background-color:transparent !important;border:none !important;box-shadow:none !important;padding:0 !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}"
			+ "html.dsh-theme-light .ds-select-menu,html.dsh-theme-light [role='listbox'].ds-select-menu{background:rgba(255,255,255,.96) !important;background-color:rgba(255,255,255,.96) !important;-webkit-backdrop-filter:blur(24px) saturate(140%) !important;backdrop-filter:blur(24px) saturate(140%) !important;border:1px solid rgba(13,148,136,.28) !important;border-radius:12px !important;box-shadow:0 12px 36px rgba(12,85,80,.15),0 0 0 1px rgba(13,148,136,.12) !important;padding:6px !important;outline:none !important;}"
			+ "html.dsh-theme-light .ds-select-menu__content{background:transparent !important;background-color:transparent !important;border:none !important;box-shadow:none !important;}"
			/* 下拉选项行：唯一胶囊受光面，子节点彻底透明 */
			+ "html.dsh-theme-light .ds-select-option,html.dsh-theme-light [role='option']{background:transparent !important;background-color:transparent !important;color:#0f2320 !important;border:none !important;border-radius:8px !important;transition:all .15s ease !important;}"
			+ "html.dsh-theme-light .ds-select-option *,html.dsh-theme-light [role='option'] *{color:#0f2320 !important;background:transparent !important;border:none !important;}"
			+ "html.dsh-theme-light .ds-select-option:hover,html.dsh-theme-light .ds-select-option--pending,html.dsh-theme-light [role='option']:hover{background:rgba(13,148,136,.12) !important;background-color:rgba(13,148,136,.12) !important;color:#0d9488 !important;}"
			+ "html.dsh-theme-light .ds-select-option:hover *,html.dsh-theme-light [role='option']:hover *{color:#0d9488 !important;}"
			+ "html.dsh-theme-light .ds-select-option--selected,html.dsh-theme-light [role='option'][aria-selected='true']{color:#0d9488 !important;font-weight:600 !important;background:rgba(13,148,136,.08) !important;background-color:rgba(13,148,136,.08) !important;}"
			+ "html.dsh-theme-light .ds-select-option--selected *,html.dsh-theme-light [role='option'][aria-selected='true'] *{color:#0d9488 !important;font-weight:600 !important;}"
			
			/* ⑧-5 分享选择态白瓷化适配（消息区与底部操作栏） */
			/* 消息区伪元素彻底透明，杜绝黑块残留 */
			+ "html.dsh-theme-light .ds-message::before,html.dsh-theme-light .ds-message::after,html.dsh-theme-light ._6e8caf5::before,html.dsh-theme-light ._6e8caf5::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;border:none !important;}"
			/* 分享态底部操作栏 (._43d222b)：告别深色模式大黑条与顶部黑色大阴影，赋予天青白瓷温润通透质感 */
			+ "html.dsh-theme-light ._43d222b{background:linear-gradient(180deg,rgba(255,255,255,.94) 0%,rgba(246,253,252,.92) 100%) !important;background-color:rgba(255,255,255,.94) !important;-webkit-backdrop-filter:blur(24px) saturate(140%) !important;backdrop-filter:blur(24px) saturate(140%) !important;border-top:1px solid rgba(13,148,136,.28) !important;box-shadow:0 -8px 24px rgba(12,85,80,.08),0 -1px 0 rgba(13,148,136,.15),inset 0 1px 0 rgba(255,255,255,.80) !important;color:#132624 !important;}"
			+ "html.dsh-theme-light ._43d222b *{color:#132624 !important;}"
			/* 底部栏复选框与全消息勾选框：统一青绿色实心 + 白勾，杜绝亮蓝 */
			+ "html.dsh-theme-light [role='checkbox'][aria-checked='true'],html.dsh-theme-light [class*='checkbox'][class*='checked'],html.dsh-theme-light [class*='checkbox'][aria-checked='true'],html.dsh-theme-light [class*='checkbox-checked'],html.dsh-theme-light [class*='checked'] > [class*='checkbox'],html.dsh-theme-light ._6e8caf5 [aria-checked='true'],html.dsh-theme-light ._6e8caf5 [class*='checkbox'][class*='checked'],html.dsh-theme-light ._43d222b [aria-checked='true'],html.dsh-theme-light ._43d222b [class*='checkbox'][class*='checked']{background-color:#0d9488 !important;background:#0d9488 !important;border-color:#0d9488 !important;box-shadow:0 0 8px rgba(13,148,136,.35) !important;}"
			+ "html.dsh-theme-light [role='checkbox'][aria-checked='true'] svg,html.dsh-theme-light [class*='checkbox'][class*='checked'] svg,html.dsh-theme-light [class*='checkbox'][aria-checked='true'] svg,html.dsh-theme-light ._6e8caf5 [aria-checked='true'] svg,html.dsh-theme-light ._43d222b [aria-checked='true'] svg{color:#ffffff !important;fill:#ffffff !important;stroke:#ffffff !important;}"
			/* 底部栏按钮：单层承载原则，彻底清空按钮所有内部子节点（__background / __content / __icon / svg / span 及伪元素）的任何背景、边框、圆角与阴影，杜绝套娃双框与白色小方块 */
			+ "html.dsh-theme-light ._43d222b [class*='ds-button'] *,html.dsh-theme-light ._43d222b [class*='ds-button'] *::before,html.dsh-theme-light ._43d222b [class*='ds-button'] *::after,html.dsh-theme-light ._43d222b [role='button'] *,html.dsh-theme-light ._43d222b [role='button'] *::before,html.dsh-theme-light ._43d222b [role='button'] *::after{background:transparent !important;background-color:transparent !important;border:none !important;box-shadow:none !important;border-radius:0 !important;outline:none !important;}"
			/* 底部栏次要操作按钮：“取消”按钮白瓷化微光（仅命中外层按钮本体，排除内部 __ 子层与 primary/confirm 按钮） */
			+ "html.dsh-theme-light ._43d222b [class*='ds-button']:not([class*='__']):not([class*='primary']):not([class*='confirm']),html.dsh-theme-light ._43d222b [role='button']:not([class*='__']):not([class*='primary']):not([class*='confirm']),html.dsh-theme-light ._43d222b button:first-of-type{background:rgba(255,255,255,.90) !important;background-color:rgba(255,255,255,.90) !important;border:1px solid rgba(13,148,136,.35) !important;border-radius:8px !important;color:#0f2320 !important;box-shadow:0 1px 4px rgba(13,148,136,.06) !important;transition:all .15s ease !important;}"
			+ "html.dsh-theme-light ._43d222b [class*='ds-button']:not([class*='__']):not([class*='primary']):not([class*='confirm']) *,html.dsh-theme-light ._43d222b [role='button']:not([class*='__']):not([class*='primary']):not([class*='confirm']) *,html.dsh-theme-light ._43d222b button:first-of-type *{color:#0f2320 !important;}"
			+ "html.dsh-theme-light ._43d222b [class*='ds-button']:not([class*='__']):not([class*='primary']):not([class*='confirm']):hover,html.dsh-theme-light ._43d222b [role='button']:not([class*='__']):not([class*='primary']):not([class*='confirm']):hover,html.dsh-theme-light ._43d222b button:first-of-type:hover{background:rgba(235,248,246,.95) !important;background-color:rgba(235,248,246,.95) !important;border-color:rgba(13,148,136,.65) !important;color:#0d9488 !important;box-shadow:0 0 10px rgba(13,148,136,.18) !important;}"
			+ "html.dsh-theme-light ._43d222b [class*='ds-button']:not([class*='__']):not([class*='primary']):not([class*='confirm']):hover *,html.dsh-theme-light ._43d222b [role='button']:not([class*='__']):not([class*='primary']):not([class*='confirm']):hover *,html.dsh-theme-light ._43d222b button:first-of-type:hover *{color:#0d9488 !important;}"
			/* 底部栏主要操作按钮：“创建分享链接”实心天青高亮与纯白文字图标 */
			+ "html.dsh-theme-light ._43d222b [class*='ds-button--primary'],html.dsh-theme-light ._43d222b [class*='ds-button'][class*='primary'],html.dsh-theme-light ._43d222b [class*='ds-button'][class*='confirm'],html.dsh-theme-light ._43d222b [role='button'][class*='primary'],html.dsh-theme-light ._43d222b [role='button'][class*='confirm'],html.dsh-theme-light ._43d222b button:last-of-type,html.dsh-theme-light ._43d222b button:last-child{background:#0d9488 !important;background-color:#0d9488 !important;border:1px solid #0d9488 !important;border-radius:8px !important;box-shadow:0 2px 10px rgba(13,148,136,.35) !important;color:#ffffff !important;transition:all .15s ease !important;}"
			+ "html.dsh-theme-light ._43d222b [class*='ds-button--primary'] *,html.dsh-theme-light ._43d222b [class*='ds-button'][class*='primary'] *,html.dsh-theme-light ._43d222b [class*='ds-button'][class*='confirm'] *,html.dsh-theme-light ._43d222b [role='button'][class*='primary'] *,html.dsh-theme-light ._43d222b [role='button'][class*='confirm'] *,html.dsh-theme-light ._43d222b button:last-of-type *,html.dsh-theme-light ._43d222b button:last-child *{color:#ffffff !important;fill:#ffffff !important;stroke:#ffffff !important;-webkit-text-fill-color:#ffffff !important;opacity:1 !important;}"
			+ "html.dsh-theme-light ._43d222b [class*='ds-button--primary']:hover,html.dsh-theme-light ._43d222b [class*='ds-button'][class*='primary']:hover,html.dsh-theme-light ._43d222b [class*='ds-button'][class*='confirm']:hover,html.dsh-theme-light ._43d222b [role='button'][class*='primary']:hover,html.dsh-theme-light ._43d222b [role='button'][class*='confirm']:hover,html.dsh-theme-light ._43d222b button:last-of-type:hover,html.dsh-theme-light ._43d222b button:last-child:hover{background:#0f766e !important;background-color:#0f766e !important;border-color:#0f766e !important;box-shadow:0 4px 14px rgba(13,148,136,.45) !important;}"
			
			/* ⑨ Markdown 正文与代码块排版 */
			+ "html.dsh-theme-light .ds-markdown{color:#132624 !important;}"
			+ "html.dsh-theme-light .ds-markdown h1,html.dsh-theme-light .ds-markdown h2,html.dsh-theme-light .ds-markdown h3,html.dsh-theme-light .ds-markdown h4,html.dsh-theme-light .ds-markdown h5,html.dsh-theme-light .ds-markdown h6,html.dsh-theme-light .ds-markdown strong{color:#0a1716 !important;}"
			+ "html.dsh-theme-light .ds-markdown p,html.dsh-theme-light .ds-markdown li{color:#1b3330 !important;}"
			+ "html.dsh-theme-light .ds-markdown ul > li::marker,html.dsh-theme-light .ds-markdown ol > li::marker{color:#0d9488 !important;}"
			+ "html.dsh-theme-light .ds-markdown :not(pre) > code{background:rgba(13,148,136,.08) !important;color:#0f766e !important;border:1px solid rgba(13,148,136,.2) !important;border-radius:4px !important;padding:1px 5px !important;}"
			+ "html.dsh-theme-light .dshc-code-card,html.dsh-theme-light div:has(> pre):not(.ds-markdown),html.dsh-theme-light div:has(> div > pre):not(.ds-markdown),html.dsh-theme-light [class*='code-block'],html.dsh-theme-light [class*='md-code']{background:rgba(246,253,252,.92) !important;background-color:rgba(246,253,252,.92) !important;border:1px solid rgba(13,148,136,.22) !important;border-radius:8px !important;overflow:hidden !important;box-shadow:0 1px 6px rgba(13,148,136,.06) !important;}"
			+ "html.dsh-theme-light pre,html.dsh-theme-light .ds-markdown pre,html.dsh-theme-light pre code,html.dsh-theme-light .ds-markdown pre code{background:transparent !important;background-color:transparent !important;border:none !important;box-shadow:none !important;}"
			+ "html.dsh-theme-light .dshc-code-card > div:not(:has(pre)),html.dsh-theme-light [class*='code-block'] > div:not(:has(pre)),html.dsh-theme-light pre + div,html.dsh-theme-light pre ~ div{background:transparent !important;background-color:transparent !important;border:none !important;border-top:1px solid rgba(13,148,136,.15) !important;box-shadow:none !important;}"
			+ "html.dsh-theme-light [class*='think'],html.dsh-theme-light [class*='thought']{color:#2a4a46 !important;}"
			/* ⑩ 彻底清除弹窗内所有“变更/绑定”等文字按钮的小圆圈（深浅通用强化） */
			+ "[role='dialog'] .ds-modal-content__main [class*='form'] [role='button'] [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main [class*='form-item'] [role='button'] [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main [class*='field'] [role='button'] [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn,"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn [class*='ds-button__background'],"
			+ "[role='dialog'] .ds-modal-content__main .dshc-pure-text-btn:hover [class*='ds-button__background']{"
			+ "border:none !important;border-color:transparent !important;background:transparent !important;background-color:transparent !important;box-shadow:none !important;border-radius:0 !important;"
			+ "}"

		].join("");

		function makeTransparentJs() {
			return "(function(){try{"
				+ "var id=" + JSON.stringify(TRANSPARENT_STYLE_ID) + ";"
				+ "var old=document.getElementById(id);if(old){old.remove();}"
				+ "var st=document.createElement('style');"
				+ "st.id=id;st.textContent=" + JSON.stringify(TRANSPARENT_CSS) + ";"
				+ "(document.head||document.documentElement).appendChild(st);"
				// 「已思考」折叠条：按文字定位，自身+祖先强制透明（内联 !important，保持正文纯净透明）
				+ "var fixed=0;"
				+ "var nodes=document.querySelectorAll('div,summary,button,span');"
				+ "for(var i=0;i<nodes.length;i++){"
				+ "  var t=(nodes[i].textContent||'').trim();"
				+ "  if(t.indexOf('\\u5df2\\u601d\\u8003')!==0||t.length>20)continue;"
				+ "  var n=nodes[i];"
				+ "  for(var d=0;d<3&&n&&n!==document.body;d++){"
				+ "    n.style.setProperty('background-color','transparent','important');"
				+ "    n.style.setProperty('background-image','none','important');"
				+ "    n.style.setProperty('box-shadow','none','important');"
				+ "    n=n.parentElement;"
				+ "  }"
				+ "  fixed++;"
				+ "}"
				
				// 设置弹窗行内文字按钮（变更/绑定）：去除误伤的紧凑小圆圈边框，恢复为原版优雅文字链接
				+ "var modalDlg=document.querySelector('[role=dialog]');"
				+ "if(modalDlg){"
				+ "  var mBtns=modalDlg.querySelectorAll('[role=button], button');"
				+ "  for(var mi=0;mi<mBtns.length;mi++){"
				+ "    var mb=mBtns[mi];"
				+ "    var mt=(mb.textContent||'').trim();"
				+ "    if(mt==='变更'||mt==='绑定'){"
				+ "      if(!mb.classList.contains('dshc-pure-text-btn'))mb.classList.add('dshc-pure-text-btn');"
				+ "      mb.style.setProperty('border','none','important');"
				+ "      mb.style.setProperty('background','transparent','important');"
				+ "      mb.style.setProperty('box-shadow','none','important');"
				+ "      var bg=mb.querySelector('[class*=ds-button__background]');"
				+ "      if(bg){"
				+ "        bg.style.setProperty('border','none','important');"
				+ "        bg.style.setProperty('background','transparent','important');"
				+ "        bg.style.setProperty('box-shadow','none','important');"
				+ "      }"
				+ "    }"
				+ "  }"
				+ "}"
				// 代码块卡片一体化清洗（彻底根除黑顶、灰底座与三截割裂）
				+ "var isThmLgt=document.documentElement.classList.contains('dsh-theme-light');"
				+ "var pres=document.querySelectorAll('pre');"
				+ "for(var pi=0;pi<pres.length;pi++){"
				+ "  var pe=pres[pi];var par=pe.parentElement;"
				+ "  if(par&&par!==document.body&&!par.classList.contains('ds-markdown')){"
				+ "    if(!par.classList.contains('dshc-code-card'))par.classList.add('dshc-code-card');"
				+ "    if(isThmLgt){"
				+ "      par.style.setProperty('background','rgba(246,253,252,.92)','important');"
				+ "      par.style.setProperty('background-color','rgba(246,253,252,.92)','important');"
				+ "      par.style.setProperty('border','1px solid rgba(13,148,136,.22)','important');"
				+ "    }else{"
				+ "      par.style.setProperty('background','rgba(18,28,42,.66)','important');"
				+ "      par.style.setProperty('background-color','rgba(18,28,42,.66)','important');"
				+ "      par.style.setProperty('border','1px solid rgba(110,180,240,.25)','important');"
				+ "    }"
				+ "    par.style.setProperty('border-radius','8px','important');"
				+ "    par.style.setProperty('overflow','hidden','important');"
				+ "    for(var ci=0;ci<par.children.length;ci++){"
				+ "      var kid=par.children[ci];"
				+ "      if(kid!==pe){"
				+ "        kid.style.setProperty('background','transparent','important');"
				+ "        kid.style.setProperty('background-color','transparent','important');"
				+ "        kid.style.setProperty('border-top',isThmLgt?'1px solid rgba(13,148,136,.15)':'1px solid rgba(110,180,240,.15)','important');"
				+ "      }"
				+ "    }"
				+ "  }"
				+ "  pe.style.setProperty('background','transparent','important');"
				+ "  pe.style.setProperty('background-color','transparent','important');"
				+ "  pe.style.setProperty('border','none','important');"
				+ "  var pcode=pe.querySelector('code');"
				+ "  if(pcode){"
				+ "    pcode.style.setProperty('background','transparent','important');"
				+ "    pcode.style.setProperty('background-color','transparent','important');"
				+ "    pcode.style.setProperty('border','none','important');"
				+ "  }"
				+ "}"
				// 浅色模式正文内引用角标动态自愈（若遇到黑底则自愈为天青白瓷）
				+ "if(isThmLgt){"
				+ "  var cites=document.querySelectorAll('.ds-markdown a *, .ds-markdown [class*=\"cite\"], .ds-markdown sup');"
				+ "  for(var ci2=0;ci2<cites.length;ci2++){"
				+ "    var cel=cites[ci2];var ctxt=(cel.textContent||'').trim();"
				+ "    if(/^\\d+$/.test(ctxt)&&cel.children.length===0){"
				+ "      cel.style.setProperty('background','rgba(235,248,246,.95)','important');"
				+ "      cel.style.setProperty('background-color','rgba(235,248,246,.95)','important');"
				+ "      cel.style.setProperty('border','1px solid rgba(13,148,136,.35)','important');"
				+ "      cel.style.setProperty('color','#0d9488','important');"
				+ "      cel.style.setProperty('border-radius','4px','important');"
				+ "      cel.style.setProperty('box-shadow','0 1px 3px rgba(13,148,136,.08)','important');"
				+ "    }"
				+ "  }"
				+ "}"
				// 右侧对话索引栏（2026-11-06 重构）
				// 实测结构：._189b4a0(fixed 34x300)
				//   ├─ ._6ffc3c9  34x292 常驻窄条  → 透明（主人要求去掉底色）
				//   └─ ._4ce999d 242x302 展开面板  → 加深海玻璃底（防文字重叠）
				// 旧逻辑「按位置特征给所有窄条加底」会把常驻窄条也涂黑，已废弃。
				+ "var nav=0;var vw=innerWidth;"
				+ "var divs=document.querySelectorAll('div');"
				+ "for(var j=0;j<divs.length;j++){"
				+ "  var e=divs[j];var r=e.getBoundingClientRect();"
				+ "  if(r.width<20||r.width>70)continue;"
				+ "  if(r.height<120)continue;"
				+ "  if(r.right<vw-60)continue;"
				+ "  var isBar=e.classList&&e.classList.contains('_6ffc3c9');"
				+ "  if(isBar){"
				// 常驻窄条：彻底透明
				+ "    e.style.setProperty('background','transparent','important');"
				+ "    e.style.setProperty('background-color','transparent','important');"
				+ "    e.style.setProperty('background-image','none','important');"
				+ "    e.style.setProperty('border','none','important');"
				+ "    e.style.setProperty('box-shadow','none','important');"
				+ "  }"
				+ "  nav++;"
				+ "}"
				// 展开面板：**JS 完全不碰它的背景**（2026-11-06 三次修正）
				//
				//    踩过的坑：之前 JS 在常驻态把 background:transparent !important
				//    写进【内联样式】，而内联样式优先级最高且永久生效 —— 用户 hover
				//    展开时 CSS 的 :hover 规则被内联样式压死，面板永远是透明的。
				//    实测复现：hover 后 computed bg 仍为 rgba(0,0,0,0)，
				//    且 getAttribute('style') 里还挂着 background: transparent !important。
				//
				//    结论：面板的常驻透明 / hover 显底 全部交给 CSS 的状态选择器处理，
				//    JS 只做计数，不做任何 style 写入。
				+ "var navPanel=0;"
				+ "var panels=document.querySelectorAll('._4ce999d');"
				+ "for(var np=0;np<panels.length;np++){"
				+ "  var pnl=panels[np];var pr=pnl.getBoundingClientRect();"
				+ "  if(pr.width<120||pr.height<80)continue;"
				+ "  navPanel++;"
				+ "}"
				+ "var navDesc=[];"
				+ "var navRows=[];"
				+ "for(var nd=0;nd<panels.length;nd++){"
				+ "  var pn=panels[nd];var prr=pn.getBoundingClientRect();"
				+ "  if(prr.width<120||prr.height<80)continue;"
				+ "  var pcs=getComputedStyle(pn);"
				+ "  navDesc.push({self:{cls:(pn.className||'').toString().slice(0,60),bg:pcs.backgroundColor,bf:(pcs.backdropFilter||pcs.webkitBackdropFilter||''),w:Math.round(prr.width),h:Math.round(prr.height)},"
				+ "    kids:Array.prototype.slice.call(pn.children,0,4).map(function(k){var ks=getComputedStyle(k);var kr=k.getBoundingClientRect();return {tag:k.tagName,cls:(k.className||'').toString().slice(0,50),bg:ks.backgroundColor,op:ks.opacity,w:Math.round(kr.width),h:Math.round(kr.height)};})});"
				+ "  var rows=pn.querySelectorAll('[role=button],li,[class*=item],[class*=row]');"
				+ "  for(var rw=0;rw<rows.length&&navRows.length<8;rw++){"
				+ "    var re2=rows[rw];var rr=re2.getBoundingClientRect();"
				+ "    if(rr.height<12||rr.width<40)continue;"
				+ "    var rcs=getComputedStyle(re2);"
				+ "    navRows.push({tag:re2.tagName,cls:(re2.className||'').toString().slice(0,55),txt:(re2.textContent||'').trim().slice(0,14),bg:rcs.backgroundColor,color:rcs.color,hh:Math.round(rr.height),depth:(function(n){var d=0;while(n&&n!==pn){d++;n=n.parentElement;}return d;})(re2)});"
				// 账号栏诊断（2026-11-11）：记录 ._2afd28d 及 3 层子元素的真实背景/边框/圆角
				+ "var acct=document.querySelector('._2afd28d');var acctDump=null;"
				+ "if(acct){var ar=acct.getBoundingClientRect();var acs=getComputedStyle(acct);"
				+ "  acctDump={self:{w:Math.round(ar.width),h:Math.round(ar.height),bg:acs.backgroundColor,bd:acs.borderTopWidth+' '+acs.borderTopColor,sh:acs.boxShadow.slice(0,50),rd:acs.borderRadius},"
				+ "  kids:Array.prototype.slice.call(acct.querySelectorAll('*'),0,10).map(function(k){var ks=getComputedStyle(k);var kr=k.getBoundingClientRect();return {tag:k.tagName,cls:(k.className||'').toString().slice(0,40),w:Math.round(kr.width),h:Math.round(kr.height),bg:ks.backgroundColor,bd:ks.borderTopWidth,rd:ks.borderRadius,sh:ks.boxShadow.slice(0,30)};})};}"
				+ "  }"
				+ "}"
				// ⑩g 系统设置弹窗与主题卡片动态自愈闭环（防重防通配：根除左侧大方框、多重框框与下拉框误伤）
				+ "var dlgTexts=document.querySelectorAll('div,span,button,[role=tab],[role=radio],a,li');"
				+ "for(var dt=0;dt<dlgTexts.length;dt++){"
				+ "  var dtxt=(dlgTexts[dt].textContent||'').trim();"
				// 左侧 4 项全量清洗残框，并强制父级容器保持透明，防止大方框
				+ "  if(dtxt==='\\u901a\\u7528\\u8bbe\\u7f6e'||dtxt==='\\u8d26\\u53f7\\u7ba1\\u7406'||dtxt==='\\u6570\\u636e\\u7ba1\\u7406'||dtxt==='\\u670d\\u52a1\\u534f\\u8bae'){"
				+ "    var dp=dlgTexts[dt];"
				+ "    for(var dpl=0;dpl<3&&dp&&dp!==document.body;dpl++){"
				+ "      dp.style.setProperty('border-left','none','important');"
				+ "      dp.style.setProperty('border-top','none','important');"
				+ "      dp.style.setProperty('border-bottom','none','important');"
				+ "      dp.style.setProperty('outline','none','important');"
				+ "      dp.style.setProperty('box-shadow','none','important');"
				+ "      if(dpl>0){"
				+ "        dp.style.setProperty('background','transparent','important');"
				+ "        dp.style.setProperty('background-color','transparent','important');"
				+ "      }"
				+ "      dp=dp.parentElement;"
				+ "    }"
				+ "  }"
				// 主题卡片（严格单例，只在最外层卡片加类名，彻底清除所有子节点的背景与边框，杜绝多重套框）
				+ "  if(dtxt==='\\u6d45\\u8272'||dtxt==='\\u6df1\\u8272'||dtxt==='\\u8ddf\\u968f\\u7cfb\\u7edf'){"
				+ "    var dc=dlgTexts[dt];"
				+ "    for(var dcd=0;dcd<4&&dc&&dc!==document.body;dcd++){"
				+ "      var dcr=dc.getBoundingClientRect();"
				+ "      if(dcr.width>70&&dcr.width<240&&dcr.height>40&&dcr.height<140){"
				+ "        dc.classList.add('dsh-theme-card');"
				+ "        var dkids=dc.querySelectorAll('*');"
				+ "        for(var dk=0;dk<dkids.length;dk++){"
				+ "          dkids[dk].classList.remove('dsh-theme-card');"
				+ "          dkids[dk].style.setProperty('background','transparent','important');"
				+ "          dkids[dk].style.setProperty('background-color','transparent','important');"
				+ "          dkids[dk].style.setProperty('border','none','important');"
				+ "          dkids[dk].style.setProperty('box-shadow','none','important');"
				+ "          dkids[dk].style.setProperty('pointer-events','none','important');"
				+ "        }"
				+ "        break;"
				+ "      }"
				+ "      dc=dc.parentElement;"
				+ "    }"
				+ "  }"
				// 下拉框整行保护：语言与朗读音色所在的宽条容器坚决清空边框与背景
				+ "  if(dtxt==='\\u8bed\\u8a00'||dtxt==='\\u6717\\u8bfb\\u97f3\\u8272'){"
				+ "    var rowEl=dlgTexts[dt].parentElement;"
				+ "    for(var rl=0;rl<3&&rowEl&&rowEl!==document.body;rl++){"
				+ "      var rr=rowEl.getBoundingClientRect();"
				+ "      if(rr.width>220){"
				+ "        rowEl.style.setProperty('border','none','important');"
				+ "        rowEl.style.setProperty('background','transparent','important');"
				+ "        rowEl.style.setProperty('box-shadow','none','important');"
				+ "      }"
				+ "      rowEl=rowEl.parentElement;"
				+ "    }"
				+ "  }"
				+ "}"
				// ⑩b-3 清理历史内联残余：杜绝 JS 动态赋给胶囊文字内联 border 造成套娃
				+ "var chips=0;"
				+ "var cands=document.querySelectorAll('div,span');"
				+ "for(var c=0;c<cands.length;c++){"
				+ "  var ct=(cands[c].textContent||'').trim();"
				+ "  if(ct.length>=30)continue;"
				+ "  if(ct.indexOf('\\u4e2a\\u7f51\\u9875')===-1&&ct.indexOf('\\u7bc7\\u8d44\\u6599')===-1"
				+ "     &&ct.indexOf('web page')===-1)continue;"
				+ "  if(cands[c].children.length>3)continue;"
				+ "  cands[c].style.removeProperty('border');"
				+ "  cands[c].style.removeProperty('border-radius');"
				+ "  cands[c].style.removeProperty('background-color');"
				+ "  if(isThmLgt)cands[c].style.setProperty('color','#0f2320','important');"
				+ "  chips++;"
				+ "}"
				// 搜索结果抽屉标题栏：按文本「搜索结果」定位
				+ "var drawerHdr=0;"
				+ "var hs=document.querySelectorAll('div,header,span');"
				+ "for(var h2=0;h2<hs.length;h2++){"
				+ "  var ht=(hs[h2].textContent||'').trim();"
				+ "  if(ht!=='\u641c\u7d22\u7ed3\u679c'&&ht!=='Search results')continue;"
				+ "  if(hs[h2].children.length!==0)continue;"
				+ "  var ph=hs[h2].parentElement;"
				+ "  if(!ph)continue;"
				+ "  ph.style.setProperty('border-bottom','1px solid rgba(110,180,240,.20)','important');"
				+ "  ph.style.setProperty('background-color','transparent','important');"
				+ "  drawerHdr++;"
				+ "}"
				+ "var codeDumps=[];"
				+ "var allPres=document.querySelectorAll('pre');"
				+ "for(var api=0;api<allPres.length;api++){"
				+ "  var cpre=allPres[api];var cpar=cpre.parentElement;var cgp=cpar?cpar.parentElement:null;"
				+ "  var ccs=getComputedStyle(cpre);var parCs=cpar?getComputedStyle(cpar):null;"
				+ "  codeDumps.push({"
				+ "    preTag:cpre.tagName,preCls:(cpre.className||'').toString().slice(0,50),"
				+ "    preBg:ccs.backgroundColor,preBd:ccs.borderWidth+' '+ccs.borderColor,"
				+ "    parTag:cpar?cpar.tagName:'',parCls:cpar?(cpar.className||'').toString().slice(0,50):'',"
				+ "    parBg:parCs?parCs.backgroundColor:'',parBd:parCs?parCs.borderWidth+' '+parCs.borderColor:'',"
				+ "    gpTag:cgp?cgp.tagName:'',gpCls:cgp?(cgp.className||'').toString().slice(0,50):'',"
				+ "    kids:Array.from(cpre.children).map(function(k){return {tag:k.tagName,cls:(k.className||'').toString().slice(0,40),bg:getComputedStyle(k).backgroundColor};}),"
				+ "    parKids:cpar?Array.from(cpar.children).map(function(k){return {tag:k.tagName,cls:(k.className||'').toString().slice(0,40),bg:getComputedStyle(k).backgroundColor,txt:(k.textContent||'').slice(0,20)};}):[]"
				+ "  });"
				+ "}"
				+ "var citeDumps=[];"
				+ "var spans=document.querySelectorAll('.ds-markdown a *, .ds-markdown span, .ds-markdown sup');"
				+ "for(var si=0;si<spans.length;si++){"
				+ "  var stxt=(spans[si].textContent||'').trim();"
				+ "  if(/^\\d+$/.test(stxt)){"
				+ "    var scs=getComputedStyle(spans[si]);"
				+ "    if(scs.backgroundColor!=='rgba(0, 0, 0, 0)'){"
				+ "      citeDumps.push({tag:spans[si].tagName,cls:(spans[si].className||'').toString().slice(0,50),bg:scs.backgroundColor,color:scs.color});"
				+ "    }"
				+ "  }"
				+ "}"
				+ "return {ok:true,len:st.textContent.length,think:fixed,nav:nav,navPanel:navPanel,chips:chips,drawerHdr:drawerHdr,codeDumps:codeDumps,citeDumps:citeDumps,navDesc:navDesc,navRows:navRows,"
				+ "  acct:acctDump,bodyCls:document.body?document.body.className:'none'};"
				+ "}catch(e){return {ok:false,error:String(e)};}})()";
		}
		/**
		 * 正文容器候选选择器，按优先级从具体到宽泛。
		 *
		 * 为什么要列一串而不是一个：
		 *   DeepSeek 的类名是构建期生成的，随时可能变。列出常见形态后，
		 *   注入脚本会逐个探测，命中第一个就用，并把命中的选择器写进探针。
		 *   这样即使本轮没命中，也能从日志里看到真实的 DOM 类名再修正。
		 */
		const CONTENT_SELECTORS = [
			// Markdown 渲染区（DeepSeek 正文最常见形态）
			".ds-markdown",
			"[class*='ds-markdown']",
			"[class*='markdown']",
			// 消息列表容器
			"[class*='message-list']",
			"[class*='chat-list']",
			// 通用兜底：正文段落所在的列表项
			"[class*='message'] [class*='content']",
			"[class*='content'][class*='message']"
		];

		/** 生成 CSS 选择器列表的 JS 数组字面量。 */
		const CONTENT_SELECTORS_JS = JSON.stringify(CONTENT_SELECTORS);

		/** 把缩放值夹进合法区间并规整到两位小数。 */
		function clampFontScale(value) {
			if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
			const bounded = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
			return Math.round(bounded * 100) / 100;
		}

		/**
		 * 生成注入到 guest 页面的「只缩正文」脚本。
		 *
		 * 设计要点：
		 *   1. 只作用于正文容器，输入框/按钮/侧边栏/导航一律保持原样；
		 *   2. 用 zoom 而不是 font-size —— 正文里混着 px 绝对单位，
		 *      改 font-size 对它们无效（这是首版踩过的坑）；
		 *   3. 选择器逐个探测，命中第一个就用，并把命中的写进返回值，
		 *      未命中时回传采集到的候选 DOM 线索，便于下次修正；
		 *   4. 幂等：每次先删同 id 的旧 style 再插新的。
		 */
		/**
		 * 带重试的注入：正文容器是 SPA 异步渲染的，
		 * 页面 did-finish-load 时 .ds-markdown 往往还不存在。
		 * 实测日志里出现过 no-selector-match 就是撞上了这个窗口期。
		 *
		 * 策略：最多试 6 次，间隔递增（150ms 起），命中即停。
		 * 仍然失败就如实回报，不再空转。
		 */
		const FONT_RETRY_DELAYS = [150, 250, 400, 650, 1000, 1500];

		function makeFontAdaptJs(scale) {
			return "(function(){"
				+ "try{"
				+ "var id=" + JSON.stringify(FONT_STYLE_ID) + ";"
				+ "var old=document.getElementById(id);"
				+ "if(old){old.remove();}"
				+ "var sels=" + CONTENT_SELECTORS_JS + ";"
				+ "var hit=null,hitCount=0;"
				+ "for(var i=0;i<sels.length;i++){"
				+ "  var nodes=document.querySelectorAll(sels[i]);"
				+ "  if(nodes.length>0){hit=sels[i];hitCount=nodes.length;break;}"
				+ "}"
				// 未命中：回报采集线索，方便下一轮修正选择器
				+ "if(hit===null){"
				+ "  var probe=[];"
				+ "  var all=document.querySelectorAll('[class]');"
				+ "  for(var k=0;k<all.length&&probe.length<12;k++){"
				+ "    var cn=all[k].className;"
				+ "    if(typeof cn==='string'&&cn.length>0&&cn.length<80){"
				+ "      if(probe.indexOf(cn)<0)probe.push(cn);"
				+ "    }"
				+ "  }"
				+ "  return {ok:false,reason:'no-selector-match',scale:" + scale + ",probe:probe,"
				+ "    bodyChildren:document.body?document.body.children.length:0};"
				+ "}"
				// 只让命中的那个选择器生效，其余不产生任何规则
				+ "var css=hit+'{zoom:" + scale + " !important;}';"
				+ "var s=document.createElement('style');"
				+ "s.id=id;s.textContent=css;"
				+ "(document.head||document.documentElement).appendChild(s);"
				+ "return {ok:true,scale:" + scale + ",selector:hit,count:hitCount};"
				+ "}catch(e){return {ok:false,error:String(e)};}"
				+ "})()";
		}

		// ============ 基础设施 ============

		async function apiRequest(action, init) {
			const res = await fetch("/dsh-familiar-dsweb/api?action=" + action, {
				...init,
				signal: AbortSignal.timeout(API_TIMEOUT)
			});
			return await res.json();
		}

		const apiGet = (action) => apiRequest(action, { method: "GET" });

		const apiPost = (action, body) => apiRequest(action, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body ?? {})
		});

		/** 探针：只写日志，失败绝不影响主流程。 */
		async function probe(label, data) {
			try {
				await apiPost("probe", { label, data, at: new Date().toISOString() });
			} catch {}
		}

		/**
		 * Electron 默认 UA 带 Electron/x.y.z 标识，DeepSeek 网页据此
		 * 判定为「异常使用环境」。伪装成同内核的普通 Chrome。
		 */
		const BROWSER_UA = (() => {
			let major = "131";
			try {
				const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
				if (m !== null) major = m[1];
			} catch {}
			return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
				+ " (KHTML, like Gecko) Chrome/" + major + ".0.0.0 Safari/537.36";
		})();

		// ============ 页面内脚本 ============

		/**
		 * 在 guest 内读取登录态。
		 * DeepSeek 把 token 存在 localStorage.userToken（非 Cookie）。
		 */
		const READ_SESSION_JS = "(function(){"
			+ "try{"
			+ "var token=localStorage.getItem('userToken');"
			+ "var info=localStorage.getItem('__appKit_userInfo');"
			+ "return {ok:true,hasToken:!!token,token:token||null,"
			+ "tokenLen:token?String(token).length:0,userInfo:info||null,"
			+ "origin:location.origin,href:location.href};"
			+ "}catch(e){return {ok:false,error:String(e)};}"
			+ "})()";

		/** 生成把 token 写回 localStorage 的脚本。 */
		function makeWriteJs(token, userInfo) {
			const writeToken = "localStorage.setItem('userToken'," + JSON.stringify(token) + ");";
			const writeInfo = typeof userInfo === "string" && userInfo.length > 0
				? "localStorage.setItem('__appKit_userInfo'," + JSON.stringify(userInfo) + ");"
				: "";
			return "(function(){try{" + writeToken + writeInfo
				+ "return {ok:true,hasToken:!!localStorage.getItem('userToken')};"
				+ "}catch(e){return {ok:false,error:String(e)};}})()";
		}

		/** 已登录 = 读到 token 且当前不在登录页。 */
		function isSignedIn(state) {
			if (!state || state.ok !== true || state.hasToken !== true) return false;
			return !String(state.href || "").includes("/sign_in");
		}

		/** 只接受 chat.deepseek.com 下的 URL。 */
		function isChatUrl(href) {
			return typeof href === "string" && href.startsWith(DS_ORIGIN);
		}
		// ============ 样式 ============

		const STYLE_ID = "dsh-familiar-dsweb-style";
		const STYLE = [
			/* 容器撑满侧栏底部宽度，用 flex-end 把按钮推到右侧。
			   margin-left 在 flex 容器里对固定宽度子元素几乎无效。 */
			".dshc-entrybar{display:flex;justify-content:flex-end;align-items:center;"
				+ "width:100%;padding-right:12px;box-sizing:border-box}",
			".dshc-entry{position:relative;width:30px;height:30px;padding:0;border:0;"
				+ "border-radius:50%;background:transparent;cursor:pointer;"
				+ "display:inline-flex;align-items:center;justify-content:center;"
				+ "-webkit-app-region:no-drag;"
				+ "transition:transform .18s cubic-bezier(.34,1.56,.64,1);"
				+ "transform-origin:50% 85%}",
			".dshc-entry-img{width:30px;height:30px;border-radius:50%;display:block;"
				+ "pointer-events:none;box-shadow:0 0 0 1px rgba(77,107,254,.28);"
				+ "transition:box-shadow .18s ease}",
			".dshc-entry:hover{z-index:5;animation:dshc-wiggle .9s cubic-bezier(.45,.05,.55,.95) infinite}",
			".dshc-entry:hover .dshc-entry-img{box-shadow:0 0 0 1.5px #4D6BFE,0 0 16px rgba(77,107,254,.7)}",
			"@keyframes dshc-wiggle{"
				+ "0%{transform:scale(1.12) rotate(0deg)}"
				+ "18%{transform:scale(1.14) rotate(-9deg)}"
				+ "36%{transform:scale(1.12) rotate(8deg)}"
				+ "54%{transform:scale(1.13) rotate(-6deg)}"
				+ "72%{transform:scale(1.12) rotate(5deg)}"
				+ "88%{transform:scale(1.12) rotate(-3deg)}"
				+ "100%{transform:scale(1.12) rotate(0deg)}}",
			".dshc-entry:active{transform:scale(.92);animation:none}",
			".dshc-entry[data-open=\"1\"] .dshc-entry-img{"
				+ "box-shadow:0 0 0 1.5px #4D6BFE,0 0 10px rgba(77,107,254,.4)}",
			"@media (prefers-reduced-motion: reduce){"
				+ ".dshc-entry:hover{animation:none;transform:scale(1.12)}}",
			/* 面板：取消边框，四周交给水波外框（design/wave_frame_preview.html 定版）。
			   玻璃底刻意拆到 .dshc-glass 单独一层 —— 若把 backdrop-filter
			   直接写在 .dshc-panel 上，内嵌 webview 会被一并拉进滤镜栈，
			   部分 Electron 版本下表现为 webview 整块不显示。 */
			/* wrap：定位与承载水波画布。水波画在面板外，需要一层不被 overflow 裁剪的父级；
			   若不包这层，canvas 放在 .dshc-panel 里会被圆角裁掉。
			   注意：wrap 本身不设固定尺寸，尺寸由 JS 内联 style 给出。 */
			".dshc-wrap{position:fixed;z-index:2147482000;pointer-events:none}",
			".dshc-panel{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;"
				+ "-webkit-app-region:no-drag;"
				+ "background:transparent;border:0;border-radius:20px;"
				+ "box-shadow:0 24px 70px rgba(0,0,0,.62),"
				+ "0 0 3px rgba(120,215,255,.55),"
				+ "0 0 18px rgba(70,175,250,.42),"
				+ "0 0 44px rgba(45,140,230,.26),"
				+ "0 0 90px rgba(30,110,200,.16);"
				/* overflow:hidden 是水波外观成立的前提：水波跨在边界两侧，
				   靠裁剪只露出内侧那一条。去掉它水带会粗一倍。 */
				+ "overflow:hidden;pointer-events:auto;"
				+ "animation:dshc-pop .2s cubic-bezier(.34,1.4,.64,1)}",
			/* 玻璃层：透明黑玻璃，独立一层，不碰 webview 的滤镜栈。
			   必须自己带 border-radius，不能只靠父级 overflow:hidden 裁 ——
			   backdrop-filter 元素的圆角裁剪由合成器单独处理，与父级圆角
			   存在亚像素错位，会在圆角与直边的切线处露出一条硬直边（实测 x≈63）。 */
			".dshc-glass{position:absolute;inset:0;z-index:0;pointer-events:none;"
				+ "border-radius:20px;background:rgba(9,13,20,.88);"
				+ "-webkit-backdrop-filter:blur(18px) saturate(140%);"
				+ "backdrop-filter:blur(18px) saturate(140%);"
				+ "box-shadow:inset 0 0 40px rgba(60,150,240,.10)}",
			/* 气泡层：在水波之下，纯装饰 */
			".dshc-bubbles{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}",
			".dshc-bubble{position:absolute;border-radius:50%;"
				+ "background:radial-gradient(circle at 32% 30%,rgba(190,235,255,.55),"
				+ "rgba(90,170,235,.16) 60%,transparent 72%);"
				+ "border:1px solid rgba(170,225,255,.22);"
				+ "animation:dshc-rise linear infinite}",
			"@keyframes dshc-rise{"
				+ "0%{transform:translateY(0) scale(.7);opacity:0}"
				+ "12%{opacity:.85}80%{opacity:.5}"
				+ "100%{transform:translateY(-560px) scale(1.15);opacity:0}}",
			/* 紧致纯边框水波：严格贴合 20px 圆角边框，无外部波纹溢出。
			 * Canvas 物理裁切在 20px 内，CSS 显式赋予 border-radius: 20px 双重防护。
			 *
			 * 层级 2147482500：高于 webview 原生层，低于缩放把手 2147483000。 */
			".dshc-water{position:absolute;inset:0;width:100%;height:100%;"
				+ "border-radius:20px;z-index:2147482500;pointer-events:none}",
			"@keyframes dshc-pop{"
				+ "from{opacity:0;transform:scale(.92) translateY(8px)}"
				+ "to{opacity:1;transform:scale(1) translateY(0)}}",
			/* 顶部栏：缩到 30px、去掉分隔线，彻底融进水波外框 */
			".dshc-head{position:relative;z-index:10;-webkit-app-region:no-drag;"
				+ "display:flex;align-items:center;gap:7px;"
				+ "height:30px;padding:0 10px;flex:none;"
				+ "font:11px/1.4 var(--dsw-font-family,system-ui);"
				+ "color:rgba(200,220,240,.82);background:transparent;border-bottom:0;"
				+ "cursor:grab;user-select:none}",
			".dshc-head:active{cursor:grabbing}",
			".dshc-dot{width:7px;height:7px;border-radius:50%;flex:none}",
			".dshc-dot[data-state=\"ready\"]{background:#3fb950;box-shadow:0 0 6px #3fb950}",
			".dshc-dot[data-state=\"loading\"]{background:#d29922;box-shadow:0 0 6px #d29922}",
			".dshc-dot[data-state=\"error\"]{background:#f85149;box-shadow:0 0 6px #f85149}",
			".dshc-title{flex:1;font-weight:600;letter-spacing:.3px;color:rgba(215,232,248,.9)}",
			".dshc-btn{-webkit-app-region:no-drag;border:0;background:transparent;"
				+ "color:rgba(190,215,240,.7);cursor:pointer;width:18px;height:18px;"
				+ "border-radius:5px;line-height:1;font-size:12px;"
				+ "display:inline-flex;align-items:center;justify-content:center}",
			".dshc-btn:hover{background:rgba(120,190,255,.16);color:#cfe9ff}",
			/* body 必须透明：它是 webview 的父级，有底色就会挡住玻璃层。 */
			".dshc-body{position:relative;flex:1;min-height:0;display:flex;z-index:2;background:transparent}",
			".dshc-body>.dshc-webview{position:relative;z-index:0}",
			/* webview 自身必须透明：guest 页面注入的 transparent CSS 只改页面内部，
			   webview 这个原生容器本身若有底色，仍会盖住后面的玻璃与气泡。 */
			".dshc-webview{flex:1;width:100%;height:100%;border:0;background:transparent !important}",
			".dshc-overlay{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;"
				+ "align-items:center;justify-content:center;gap:10px;padding:20px;"
				+ "text-align:center;font:12px/1.7 var(--dsw-font-family,system-ui);"
				+ "color:rgba(160,190,215,.72);"
				+ "background:rgba(9,13,20,.88)}",
			/* webview 是独立原生层，普通 DOM 会被它盖住；
			   缩放把手必须 z-index 更高才点得到。 */
			".dshc-grip{position:absolute;width:20px;height:20px;z-index:2147483000;"
				+ "pointer-events:auto;-webkit-app-region:no-drag}",
			".dshc-grip[data-corner=\"se\"]{right:0;bottom:0;cursor:nwse-resize}",
			".dshc-grip[data-corner=\"sw\"]{left:0;bottom:0;cursor:nesw-resize}",
			".dshc-grip[data-corner=\"ne\"]{right:0;top:0;cursor:nesw-resize}",
			".dshc-grip[data-corner=\"nw\"]{left:0;top:0;cursor:nwse-resize}",
			".dshc-grip::after{content:'';position:absolute;width:9px;height:9px;"
				+ "border-color:var(--dsw-alias-label-dimmed,#6a6a7a);border-style:solid;opacity:.85}",
			".dshc-grip[data-corner=\"se\"]::after{right:4px;bottom:4px;"
				+ "border-width:0 2px 2px 0;border-radius:0 0 3px 0}",
			".dshc-grip[data-corner=\"sw\"]::after{left:4px;bottom:4px;"
				+ "border-width:0 0 2px 2px;border-radius:0 0 0 3px}",
			".dshc-grip[data-corner=\"ne\"]::after{right:4px;top:4px;"
				+ "border-width:2px 2px 0 0;border-radius:0 3px 0 0}",
			".dshc-grip[data-corner=\"nw\"]::after{left:4px;top:4px;"
				+ "border-width:2px 0 0 2px;border-radius:3px 0 0 0}",

			/* 字号调节按钮：比普通按钮窄，避免标题栏拥挤 */
			".dshc-fontbtn{-webkit-app-region:no-drag;border:0;background:transparent;"
				+ "color:rgba(190,215,240,.7);cursor:pointer;height:18px;min-width:16px;padding:0 2px;"
				+ "border-radius:5px;line-height:1;font-size:10px;font-weight:600;"
				+ "display:inline-flex;align-items:center;justify-content:center;opacity:.75}",
			".dshc-fontbtn:hover{background:rgba(120,190,255,.16);color:#cfe9ff;opacity:1}",
			".dshc-fontbtn:disabled{opacity:.28;cursor:default;background:transparent}",
			".dshc-fontlabel{font:10px/1 var(--dsw-font-family,system-ui);"
				+ "color:rgba(160,190,215,.6);min-width:26px;text-align:center;"
				+ "user-select:none;flex:none}",
			/* 浅色主题外壳玻璃与跃金光芒 */
			".dshc-panel[data-theme='light']{box-shadow:0 24px 68px rgba(15,85,80,.14),0 0 3px rgba(32,178,170,.40),0 -8px 28px rgba(255,235,160,.22) !important}",
			".dshc-panel[data-theme='light'] .dshc-glass{background:linear-gradient(135deg,rgba(255,253,245,.92) 0%,rgba(242,253,251,.88) 45%,rgba(232,250,248,.86) 100%) !important;box-shadow:inset 0 1px 3px rgba(255,255,255,.95),inset 0 0 50px rgba(32,178,170,.08),inset 0 30px 40px rgba(255,238,180,.12) !important}",
			".dshc-panel[data-theme='light'] .dshc-title{color:rgba(18,48,45,.92) !important}",
			".dshc-panel[data-theme='light'] .dshc-fontlabel{color:rgba(25,65,60,.82) !important}",
			".dshc-panel[data-theme='light'] .dshc-fontbtn{color:rgba(30,75,70,.75) !important}",
			".dshc-panel[data-theme='light'] .dshc-fontbtn:hover{background:rgba(18,168,152,.12) !important;color:#0d9488 !important;text-shadow:0 0 8px rgba(255,230,150,.40) !important}",
			".dshc-panel[data-theme='light'] .dshc-btn{color:rgba(30,75,70,.75) !important}",
			".dshc-panel[data-theme='light'] .dshc-btn:hover{background:rgba(18,168,152,.12) !important;color:#0d9488 !important;text-shadow:0 0 8px rgba(255,230,150,.40) !important}",
  ":root,html,body{color-scheme:light !important}",
		].join("\n");

		/**
		 * 注入样式表。
		 *
		 * 必须是「存在就替换内容」，不能「存在就跳过」：
		 * 热重载（dev_reload_package）时旧的 <style> 仍留在 document.head，
		 * 若直接 return，新样式永远注入不进去 —— 改了 CSS 却看不到变化，
		 * 表现就是「怎么改都和之前一样」。
		 */
		function ensureStyle() {
			if (typeof document === "undefined") return;
			const existing = document.getElementById(STYLE_ID);
			if (existing !== null) {
				if (existing.textContent !== STYLE) existing.textContent = STYLE;
				return;
			}
			const tag = document.createElement("style");
			tag.id = STYLE_ID;
			tag.textContent = STYLE;
			document.head.appendChild(tag);
		}
/* ========================================================
		 * DSH Companion: 舟摇海涌流体引擎 (100% 预览稿高精度实装版)
		 * 特征：内嵌于 .dshc-panel · 享用 20px 圆角抗锯齿裁剪 · 零切面闭合谐波
		 * 动力学：全周大长涌浪 (Ocean Swell) · 划桨呼吸节律 · 摆线浪尖聚光
		 * 参数依据：主人 2026-11-06 验收定调版 (振幅 14px, 摇摆 0.6x, 深度 21px, 透明度 0.35, 高光 0.5)
		 * ======================================================== */
		function createWaveFrame(canvas, userOptions = {}) {
			const ctx = canvas.getContext("2d", { alpha: true });
			if (ctx === null) return null;

			const config = {
				amp: 14.0,            // 主波浪起伏振幅 (14px)
				rock: 0.6,            // 手划摇摆节奏感 (0.6x)
				frameWidth: 21.0,     // 水体向内渗透深度 (21px)
				opacity: 0.35,        // 水体透明度实度 (0.35)
				specular: 0.50,       // 浪尖高光聚光度 (0.50)
				speedFactor: 0.55,    // 划桨航行速度系数 (降速放缓：由 0.95 调至 0.55，呈现沉静舒缓大洋长涌浪)
				radius: 20,           // 圆角 (20px)
				step: 2.4,            // 采样步长
				...userOptions
			};

			const RADIUS = config.radius;
			const STEP = config.step;
			let W = 0, H = 0, dpr = 1, raf = 0, t = 0;
			let pts = [];
			let gradTuningSoft = null, gradMid = null;

			function buildPerimeter(w, h, r, step) {
				const out = [];
				const corner = (cx, cy, a0, a1) => {
					const arc = Math.abs(a1 - a0) * r;
					const n = Math.max(2, Math.round(arc / step));
					for (let i = 0; i < n; i++) {
						const a = a0 + (a1 - a0) * (i / n);
						out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
					}
				};
				const edge = (x0, y0, x1, y1, nx, ny) => {
					const len = Math.hypot(x1 - x0, y1 - y0);
					const n = Math.max(1, Math.round(len / step));
					for (let i = 0; i < n; i++) {
						const k = i / n;
						out.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, nx, ny });
					}
				};
				edge(r, 0, w - r, 0, 0, -1);
				corner(w - r, r, -Math.PI / 2, 0);
				edge(w, r, w, h - r, 1, 0);
				corner(w - r, h - r, 0, Math.PI / 2);
				edge(w - r, h, r, h, 0, 1);
				corner(r, h - r, Math.PI / 2, Math.PI);
				edge(0, h - r, 0, r, -1, 0);
				corner(r, r, Math.PI, Math.PI * 1.5);
				return out;
			}

			let currentTheme = config.theme || 'dark';

			function buildGradients() {
				if (currentTheme === 'light') {
					// 浅色主题：碧水晴空 · 阳光跃金（天青色 + 晨曦日光金暖渐变）
					gradTuningSoft = ctx.createLinearGradient(0, 0, W, H);
					gradTuningSoft.addColorStop(0.0, "rgba(64,205,185,.40)"); // 左上迎光面：清澈湖青金
					gradTuningSoft.addColorStop(0.30, "rgba(32,188,172,.30)");
					gradTuningSoft.addColorStop(0.70, "rgba(20,165,155,.34)");
					gradTuningSoft.addColorStop(1.0, "rgba(45,190,175,.28)"); // 右下背光面：澄澈碧水

					gradMid = ctx.createLinearGradient(0, 0, W, H);
					gradMid.addColorStop(0.0, "rgba(255,235,170,.52)"); // 阳光直射浮光跃金！
					gradMid.addColorStop(0.35, "rgba(72,218,195,.36)");
					gradMid.addColorStop(0.70, "rgba(24,180,168,.40)");
					gradMid.addColorStop(1.0, "rgba(60,205,190,.32)");
				} else {
					// 深色主题：深海大洋长涌浪（保持完全一致）
					gradTuningSoft = ctx.createLinearGradient(0, 0, W, H);
					gradTuningSoft.addColorStop(0.0, "rgba(28,95,180,.52)");
					gradTuningSoft.addColorStop(0.35, "rgba(48,135,230,.38)");
					gradTuningSoft.addColorStop(0.65, "rgba(22,80,160,.46)");
					gradTuningSoft.addColorStop(1.0, "rgba(38,115,205,.48)");

					gradMid = ctx.createLinearGradient(0, 0, W, H);
					gradMid.addColorStop(0.0, "rgba(110,200,255,.62)");
					gradMid.addColorStop(0.35, "rgba(80,180,250,.42)");
					gradMid.addColorStop(0.7, "rgba(140,215,255,.58)");
					gradMid.addColorStop(1.0, "rgba(90,185,252,.46)");
				}
			}

			function resize() {
				const rect = canvas.getBoundingClientRect();
				dpr = window.devicePixelRatio || 1;
				W = Math.max(1, rect.width || canvas.offsetWidth);
				H = Math.max(1, rect.height || canvas.offsetHeight);
				canvas.width = Math.round(W * dpr);
				canvas.height = Math.round(H * dpr);
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				pts = buildPerimeter(W, H, RADIUS, STEP);
				buildGradients();
			}

			let observer = null;
			if (typeof ResizeObserver === "function") {
				observer = new ResizeObserver(() => {
					if (raf === 0) return;
					resize();
				});
				observer.observe(canvas);
			}

			// 舟摇海涌点位计算核心 (全周大长涌浪 + 划桨滑行脉冲 + 摆线波浪尖整形)
			function wavePoint(p, idx, base, amp, freq, phase, speed) {
				const N = pts.length;
				const u = idx / N;
				const tau = Math.PI * 2;

				const kSwell = Math.max(1, Math.round(N * freq / tau));
				const kRock = Math.max(1, Math.round(kSwell * 0.5));

				const strokePulse = Math.sin(speed * 0.65) * 0.24 * config.rock;
				const modSpeed = speed + strokePulse;

				const th1 = u * kSwell * tau + phase + modSpeed;
				const swell = (Math.sin(th1) + 0.36 * Math.sin(th1 * 2 - 0.25)) * 1.06;

				const rocking = Math.sin(u * kRock * tau + phase * 1.5 + modSpeed * 0.6) * 0.42 * config.rock;

				const combined = (swell + rocking) / 1.35;
				const d = base + (amp * combined);
				return { x: p.x + p.nx * d, y: p.y + p.ny * d };
			}

			// 画水带（模 N 循环贝塞尔平滑样条）
			function drawBand(outerBase, innerBase, amp, freq, phase, speed, grad, alpha) {
				const N = pts.length;
				if (N < 4) return;
				const outPts = new Array(N);
				const inPts = new Array(N);
				for (let i = 0; i < N; i++) {
					outPts[i] = wavePoint(pts[i], i, outerBase, amp, freq, phase, speed);
					inPts[i] = wavePoint(pts[i], i, innerBase, amp * 0.72, freq, phase + 0.75, speed * 0.94);
				}

				const path = new Path2D();
				const outMidStartX = (outPts[N - 1].x + outPts[0].x) * 0.5;
				const outMidStartY = (outPts[N - 1].y + outPts[0].y) * 0.5;
				path.moveTo(outMidStartX, outMidStartY);
				for (let i = 0; i < N; i++) {
					const p = outPts[i];
					const next = outPts[(i + 1) % N];
					path.quadraticCurveTo(p.x, p.y, (p.x + next.x) * 0.5, (p.y + next.y) * 0.5);
				}

				const inMidStartX = (inPts[0].x + inPts[N - 1].x) * 0.5;
				const inMidStartY = (inPts[0].y + inPts[N - 1].y) * 0.5;
				path.lineTo(inMidStartX, inMidStartY);

				for (let i = N - 1; i >= 0; i--) {
					const p = inPts[i];
					const prev = inPts[(i - 1 + N) % N];
					path.quadraticCurveTo(p.x, p.y, (p.x + prev.x) * 0.5, (p.y + prev.y) * 0.5);
				}
				path.closePath();

				ctx.globalAlpha = alpha;
				ctx.fillStyle = grad;
				ctx.fill(path);
				ctx.globalAlpha = 1;
			}

			// 画浪尖晶莹高光线 (带动态消融聚光)
			function drawCrest(base, amp, freq, phase, speed, stroke, width, alpha) {
				const N = pts.length;
				if (N < 4) return;
				const cPts = new Array(N);
				for (let i = 0; i < N; i++) {
					cPts[i] = wavePoint(pts[i], i, base, amp, freq, phase, speed);
				}

				ctx.beginPath();
				const startMidX = (cPts[N - 1].x + cPts[0].x) * 0.5;
				const startMidY = (cPts[N - 1].y + cPts[0].y) * 0.5;
				ctx.moveTo(startMidX, startMidY);

				for (let i = 0; i < N; i++) {
					const p = cPts[i];
					const next = cPts[(i + 1) % N];
					ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) * 0.5, (p.y + next.y) * 0.5);
				}
				ctx.closePath();

				ctx.strokeStyle = stroke;
				ctx.lineWidth = width;
				ctx.globalAlpha = alpha;
				ctx.lineJoin = "round";
				ctx.lineCap = "round";
				ctx.stroke();
				ctx.globalAlpha = 1;
			}

			function frame() {
				ctx.clearRect(0, 0, W, H);
				ctx.save();

				const isLight = currentTheme === 'light';
				ctx.globalCompositeOperation = isLight ? "source-over" : "screen";

				const d = config.frameWidth; // 21px
				const a = config.amp;        // 14px
				const alpha = isLight ? (config.opacity * 1.15) : config.opacity;
				const spd = t * 0.75 * config.speedFactor;
				const freqBase = 0.011;

				if (isLight) {
					// ① 青碧主体水带：长浪推涌，消融内侧硬轮廓线
					ctx.shadowBlur = 28;
					ctx.shadowColor = "rgba(20,165,155,.38)";
					drawBand(2.0, d, a, freqBase, 0.0, spd, gradTuningSoft, alpha);

					// ② 浮光跃金水韵层：深入度 62%，带阳光金微澜
					ctx.shadowBlur = 22;
					ctx.shadowColor = "rgba(255,215,120,.45)";
					drawBand(1.2, d * 0.62, a * 0.72, freqBase * 1.35, 1.2, spd * 1.3, gradMid, alpha * 0.82);

					// ③ 阳光浪尖晶莹金白线：浪尖凝聚晨曦日光反光金辉
					ctx.shadowBlur = 16;
					ctx.shadowColor = "rgba(255,230,140,.85)";
					drawCrest(d * 0.50, a * 0.65, freqBase * 1.7, 2.8, spd * 1.6, "rgba(255,248,220,.98)", 1.8, Math.min(1.0, config.specular * 1.2));
				} else {
					// ① 深海清透主体水带：长浪推涌，消融内侧硬轮廓线
					ctx.shadowBlur = 34;
					ctx.shadowColor = "rgba(30,120,230,.56)";
				drawBand(2.0, d, a, freqBase, 0.0, spd, gradTuningSoft, alpha);

					// ② 次级透光水韵层：深入度 62%
					ctx.shadowBlur = 20;
					ctx.shadowColor = "rgba(70,180,255,.68)";
				drawBand(1.2, d * 0.62, a * 0.72, freqBase * 1.35, 1.2, spd * 1.3, gradMid, alpha * 0.72);

					// ③ 浪脊晶莹高光线：居于水体中前侧，浪尖凝聚细致冰白光
					ctx.shadowBlur = 14;
					ctx.shadowColor = "rgba(215,248,255,.88)";
				drawCrest(d * 0.50, a * 0.65, freqBase * 1.7, 2.8, spd * 1.6, "rgba(240,253,255,.96)", 1.7, config.specular);
				}

				ctx.restore();
				t += 0.022;
				raf = requestAnimationFrame(frame);
			}

			return {
				resize,
				start() {
					if (raf !== 0) return;
					resize();
					raf = requestAnimationFrame(frame);
				},
				stop() {
					if (observer !== null) { observer.disconnect(); observer = null; }
					if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
					ctx.clearRect(0, 0, W, H);
				},
				setTheme(themeName) {
					const next = themeName === 'light' ? 'light' : 'dark';
					if (currentTheme !== next) {
						currentTheme = next;
						buildGradients();
					}
				},
				updateConfig(newOpts) {
					Object.assign(config, newOpts);
					resize();
				},
				getConfig() {
					return { ...config };
				}
			};
		}
		// ============ 几何 ============

		/**
		 * 用 requestAnimationFrame 给高频更新做节流。
		 *
		 * 为什么需要：拖拽/缩放时 pointermove 每秒能触发上百次，
		 * 每次都 setState 会让 React 重渲染上百次、整个 Panel 重算布局。
		 * 合到每帧一次后，渲染次数直接降到 60Hz 以内，且与屏幕刷新对齐。
		 *
		 * 返回的对象带 cancel()，在 pointerup / 卸载时必须调用，
		 * 否则松手那一帧的回调会在组件已卸载后仍然执行。
		 */
		function createFrameThrottle() {
			let frame = 0;
			let pending = null;
			let scheduled = false;

			const flush = () => {
				scheduled = false;
				frame = 0;
				if (pending === null) return;
				const fn = pending;
				pending = null;
				fn();
			};

			return {
				run(fn) {
					pending = fn;
					if (scheduled) return;
					scheduled = true;
					frame = requestAnimationFrame(flush);
				},
				/** 立刻执行尚未跑的最后一次更新（松手时保证落点准确）。 */
				flush() {
					if (frame !== 0) cancelAnimationFrame(frame);
					flush();
				},
				cancel() {
					if (frame !== 0) cancelAnimationFrame(frame);
					frame = 0;
					scheduled = false;
					pending = null;
				}
			};
		}

		function readViewport() {
			return {
				width: document.documentElement.clientWidth || window.innerWidth,
				height: document.documentElement.clientHeight || window.innerHeight
			};
		}

		/**
		 * 把面板夹进 DSH 窗口可视区。
		 *
		 * 顶部必须留出 TOP_SAFE：Electron 的 titleBarOverlay 是主进程原生层，
		 * 面板一旦与之重叠就会透明化 + 点击穿透，z-index 和 no-drag 都无效。
		 * 这不是多余的束缚，是必要的安全边界。
		 */
		function clampBox(box, viewport) {
			const width = Math.max(MIN_W, Math.min(box.width, viewport.width - EDGE_MARGIN * 2));
			const height = Math.max(MIN_H, Math.min(box.height, viewport.height - TOP_SAFE - EDGE_MARGIN));
			const maxLeft = Math.max(EDGE_MARGIN, viewport.width - width - EDGE_MARGIN);
			const maxTop = Math.max(TOP_SAFE, viewport.height - height - EDGE_MARGIN);
			return {
				width,
				height,
				left: Math.min(Math.max(EDGE_MARGIN, box.left), maxLeft),
				top: Math.min(Math.max(TOP_SAFE, box.top), maxTop)
			};
		}

		/** 拖动松手后吸附到最近的左/右边，避免停在半空。 */
		function snapToEdge(box, viewport) {
			const distRight = viewport.width - (box.left + box.width);
			const distLeft = box.left;
			if (Math.min(distRight, distLeft) > SNAP_THRESHOLD) return box;
			return {
				...box,
				left: distRight < distLeft ? viewport.width - box.width - EDGE_MARGIN : EDGE_MARGIN
			};
		}

		// ============ 窗口状态缓存 ============

		/**
		 * 窗口状态在插件加载时就预取。
		 * 若等面板 mount 再取，用户会看到它先在默认位置闪一下再跳过去。
		 *
		 * 关键修复：原实现要求 width/height 同时有效才返回缓存，
		 * 只要这两个字段有任何缺失（或首次启动时 host 路由尚未就绪），
		 * 整份缓存连 fontScale 一起被丢弃，于是字号永远回默认值。
		 * 现在改为「只要有任意有效字段就返回」，位置/尺寸/字号各自独立判断。
		 */
		const uiStateReady = (async () => {
			try {
				const res = await apiGet("ui-state");
				const ui = res?.ui ?? null;
				if (ui === null) {
					void probe("ui.prefetch", { ok: false, reason: "null" });
					return null;
				}
				void probe("ui.prefetch", {
					ok: true,
					hasBox: Number.isFinite(ui.width) && Number.isFinite(ui.height),
					fontScale: Number.isFinite(ui.fontScale) ? ui.fontScale : null
				});
				return ui;
			} catch (error) {
				void probe("ui.prefetch", { ok: false, reason: String(error) });
				return null;
			}
		})();

		let uiStateCache = null;
		/**
		 * lastUrl 独立存放。
		 *
		 * 原实现把 lastUrl 塞进 uiStateCache，而 uiStateCache 在首次
		 * ui-state 请求完成前是 null —— 这期间发生的导航会被直接丢弃，
		 * "记住上次聊天页"因此时灵时不灵。独立变量后不依赖缓存是否就绪。
		 */
		let lastUrl = null;

		const uiStateLoaded = uiStateReady.then((ui) => {
			uiStateCache = ui;
			if (lastUrl === null && typeof ui?.lastUrl === "string" && isChatUrl(ui.lastUrl)) {
				lastUrl = ui.lastUrl;
			}
			return ui;
		});

		/** 记住当前聊天页（登录页不记）。写缓存 + 落盘。 */
		function rememberUrl(href) {
			if (!isChatUrl(href) || href.includes("/sign_in")) return;
			if (lastUrl === href) return;
			lastUrl = href;
			void apiPost("ui-state", { lastUrl: href }).catch(() => {});
		}

		/** 计算面板初始位置：优先用存盘值，其次右下角默认值。 */
		function computeInitialBox(cached) {
			const viewport = readViewport();
			if (cached !== null && Number.isFinite(cached.width) && Number.isFinite(cached.height)) {
				return clampBox({
					left: Number.isFinite(cached.left) ? cached.left : viewport.width - cached.width - 20,
					top: Number.isFinite(cached.top) ? cached.top : viewport.height - cached.height - 90,
					width: cached.width,
					height: cached.height
				}, viewport);
			}
			const width = Math.round(viewport.width * DEFAULT_SIZE_RATIO.width);
			const height = Math.round(viewport.height * DEFAULT_SIZE_RATIO.height);
			return clampBox({
				left: viewport.width - width - 20,
				top: viewport.height - height - 90,
				width,
				height
			}, viewport);
		}

		// ============ 面板 ============

		
		// ============ 宿主 DSH 主题同步 ============
		function getDshHostTheme() {
			if (typeof document !== "undefined") {
				if (document.body && document.body.hasAttribute("data-ds-dark-theme")) return "dark";
				if (document.documentElement && document.documentElement.dataset.dsThemeSource === "dark") return "dark";
				if (document.documentElement && document.documentElement.dataset.dsThemeSource === "light") return "light";
				if (document.documentElement && document.documentElement.classList.contains("dark")) return "dark";
				if (document.body && document.body.classList.contains("dark")) return "dark";
				if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
				if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
			}
			return "dark";
		}


		// ============ 宿主 DSH 主题同步 ============
		function getDshHostTheme() {
			if (typeof document !== "undefined") {
				if (document.body && document.body.hasAttribute("data-ds-dark-theme")) return "dark";
				if (document.documentElement && document.documentElement.dataset.dsThemeSource === "dark") return "dark";
				if (document.documentElement && document.documentElement.dataset.dsThemeSource === "light") return "light";
				if (document.documentElement && document.documentElement.classList.contains("dark")) return "dark";
				if (document.body && document.body.classList.contains("dark")) return "dark";
				if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
				if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
			}
			return "dark";
		}

function CompanionPanel({ onClose }) {
			const bodyRef = React.useRef(null);
			const webviewRef = React.useRef(null);
			/** 装饰层引用（玻璃/气泡/水波），纯外观，不参与业务逻辑。 */
			const waterRef = React.useRef(null);
			const bubblesRef = React.useRef(null);
			const waveRef = React.useRef(null);
			const bridgeRef = React.useRef(null);
			const leaseRef = React.useRef(null);

			const [state, setState] = React.useState("loading");
			const [theme, setTheme] = React.useState(() => getDshHostTheme());
			const themeRef = React.useRef(theme);
			themeRef.current = theme;
			const [message, setMessage] = React.useState("正在准备窗口…");

			/**
			 * 初始 box 必须同步算出。
			 * 若用 useState(null) 等异步加载，首帧 bodyRef 为空，webview
			 * 建了却挂不上，dom-ready 永不触发 → 卡在"正在准备窗口"。
			 */
			const [box, setBox] = React.useState(() => computeInitialBox(uiStateCache));
			const [boxSettled, setBoxSettled] = React.useState(() => uiStateCache !== null);
			/** 字体缩放：初始值取已加载的缓存，没有则用默认。 */
			const [fontScale, setFontScale] = React.useState(() =>
				clampFontScale(uiStateCache !== null ? uiStateCache.fontScale : FONT_SCALE_DEFAULT)
			);

			/**
			 * webview 生命周期的 useEffect 依赖数组是空的（只跑一次），
			 * 闭包里捕获不到后续变化的 fontScale / applyFontScale。
			 * 用 ref 桥接，保证注入时永远拿到最新值。
			 */
			const fontScaleRef = React.useRef(fontScale);
			const applyFontScaleRef = React.useRef(null);
			/** 用户是否已主动改过字号。一旦为 true，缓存回填不得覆盖。 */
			const committedFontScaleRef = React.useRef(false);

			/**
			 * box 的镜像 ref。
			 *
			 * 为什么需要：拖动/缩放的 pointerup 里要读「最终位置」并存盘，
			 * 但在 updater 之外读不到最新 state。用 ref 镜像后，
			 * 就能在 updater 外拿到最新值，从而把 saveBox 这个副作用
			 * 移出 updater（避免重复执行/丢失）。
			 */
			const boxRef = React.useRef(box);

			// 兜底：打开时缓存还没到，等它到了再校正一次
			React.useEffect(() => {
				if (boxSettled) return;
				let cancelled = false;
				void uiStateLoaded.then((ui) => {
					if (cancelled || ui === null) return;
					if (!Number.isFinite(ui.width) || !Number.isFinite(ui.height)) return;
					setBox(computeInitialBox(ui));
					setBoxSettled(true);
				});
				return () => { cancelled = true; };
			}, [boxSettled]);

			/**
			 * 面板每次挂载时，向 host **重新拉一次**当前字号。
			 *
			 * 这是本次真正的根因修复：
			 *
			 * 1. 原实现依赖模块级的 uiStateLoaded —— 那是个只在插件加载时
			 *    resolve 一次的 Promise。面板关掉再打开时，它给出的永远是
			 *    「模块加载那一刻」的旧快照。用户在旧面板里改过字号后，
			 *    新面板一开就被这份旧快照写回去。
			 *
			 * 2. committedFontScaleRef 是组件级 ref，面板重新挂载就重置为
			 *    false，那道「用户已改过」的保护也一起失效。
			 *
			 * 所以正确做法不是「用旧快照回填」，而是**每次挂载都问 host 要最新的**。
			 * 只有 host 才是事实源，内存里的任何快照都可能过期。
			 *
			 * 顺序：初始 state 已同步用过 uiStateCache（同一次挂载内是新鲜的），
			 * 这里再拉一次是为了覆盖「面板关闭期间磁盘被改动」的情况。
			 */
			React.useEffect(() => {
				let cancelled = false;
				void (async () => {
					let ui = null;
					try {
						const res = await apiGet("ui-state");
						ui = res?.ui ?? null;
					} catch (error) {
						void probe("ui.fontscale-restore", { applied: false, reason: String(error) });
						return;
					}
					if (cancelled) return;
					if (ui === null || !Number.isFinite(ui.fontScale)) {
						void probe("ui.fontscale-restore", { applied: false, reason: "no-fontscale" });
						return;
					}
					const saved = clampFontScale(ui.fontScale);
					// 本次挂载内用户已改过 → 尊重用户，不被磁盘旧值覆盖
					if (committedFontScaleRef.current) {
						void probe("ui.fontscale-restore", { applied: false, reason: "user-committed" });
						return;
					}
					// 同步刷新模块级缓存，避免下次挂载又用陈旧快照
					if (uiStateCache !== null) uiStateCache = { ...uiStateCache, fontScale: saved };
					fontScaleRef.current = saved;
					setFontScale(saved);
					void probe("ui.fontscale-restore", { applied: true, value: saved });
				})();
				return () => { cancelled = true; };
			}, []);

			// box 变化时同步进 ref，供 pointerup 在 updater 外读取
			React.useEffect(() => {
				boxRef.current = box;
			}, [box]);

			/**
			 * 水波外框生命周期。依赖 box 尺寸：拖动只改 left/top 不重建位图，
			 * 只有缩放才重算采样与渐变。
			 */
			React.useEffect(() => {
				const canvas = waterRef.current;
				if (canvas === null) return;
				const wave = createWaveFrame(canvas, { theme: themeRef.current });
				if (wave === null) return;
				waveRef.current = wave;
				wave.start();
				return () => {
					wave.stop();
					waveRef.current = null;
				};
			}, [box.width, box.height]);

			/**
			 * 延迟诊断：页面上「原本的样子」有多长的存在窗口？
			 * 在注入前 8 秒抓一次原始样式，用于对比「未注入 vs 已注入」的差异。
			 */
			React.useEffect(() => {
				const timer = window.setTimeout(() => {
					const element = webviewRef.current;
					if (element === null) return;
					void element.executeJavaScript(makeTransparentJs())
						.then((r) => probe("diag.raw8s", r))
						.catch((e) => probe("diag.raw8s", { error: String(e) }));
				}, 8000);
								// 权威同步 DSH 宿主主题状态至 webview 内部
				const syncThemeToWebview = (currentTheme) => {
					const element = webviewRef.current;
					if (element === null) return;
					const isDark = currentTheme === "dark";
					const js = "(function(){try{"
						+ "var h=document.documentElement;"
						+ "if(!h)return;"
						+ "if(" + isDark + "){h.classList.add('dsh-theme-dark');h.classList.remove('dsh-theme-light');}"
						+ "else{h.classList.add('dsh-theme-light');h.classList.remove('dsh-theme-dark');}"
						+ "var dlg=document.querySelector('[role=dialog]');"
						+ "if(dlg){"
						+ "  var bs=dlg.querySelectorAll('[role=button],button');"
						+ "  for(var bi=0;bi<bs.length;bi++){"
						+ "    var btn=bs[bi];"
						+ "    var txt=(btn.textContent||'').trim();"
						+ "    if(txt==='变更'||txt==='绑定'){"
						+ "      if(!btn.classList.contains('dshc-pure-text-btn'))btn.classList.add('dshc-pure-text-btn');"
						+ "      btn.style.setProperty('border','none','important');"
						+ "      btn.style.setProperty('background','transparent','important');"
						+ "      btn.style.setProperty('box-shadow','none','important');"
						+ "      var bgs=btn.querySelectorAll('[class*=ds-button__background]');"
						+ "      for(var k=0;k<bgs.length;k++){"
						+ "        bgs[k].style.setProperty('border','none','important');"
						+ "        bgs[k].style.setProperty('background','transparent','important');"
						+ "        bgs[k].style.setProperty('box-shadow','none','important');"
						+ "      }"
						+ "    }"
						+ "  }"
						+ "}"
						+ "}catch(e){}})()";
					void element.executeJavaScript(js).catch(() => {});
				};

				// 高频巡检 DSH 宿主主题（500ms），实现 100% 同步响应
				const themePoll = window.setInterval(() => {
					const latest = getDshHostTheme();
					if (latest !== themeRef.current) {
						themeRef.current = latest;
						setTheme(latest);
						if (waveRef.current && waveRef.current.setTheme) {
							waveRef.current.setTheme(latest);
						}
					}
					syncThemeToWebview(latest);
				}, 500);

				// 系统级主题监听
				const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
				const onMqChange = () => {
					const latest = getDshHostTheme();
					themeRef.current = latest;
					setTheme(latest);
					if (waveRef.current && waveRef.current.setTheme) {
						waveRef.current.setTheme(latest);
					}
					syncThemeToWebview(latest);
				};
				if (mq) mq.addEventListener("change", onMqChange);

				return () => {
					window.clearTimeout(timer);
					window.clearInterval(themePoll);
					if (mq) mq.removeEventListener("change", onMqChange);
				};
			}, []);
			/**
			 * 透明样式持续重注入。
			 *
			 * 为什么需要：DeepSeek 是 SPA，did-navigate 触发时页面 DOM 还没渲染完，
			 * 而且它会在路由切换/列表虚拟滚动时重建节点。只注入一次的话，
			 * 后来的渲染会把透明样式覆盖掉 —— 表现就是「改了 CSS 但页面没变化」。
			 *
			 * 策略：页面就绪后每 1.5s 补一次，共 8 次（覆盖首屏渲染窗口），
			 * 之后靠 did-navigate 兜底。注入本身是幂等的（先删同 id 再插）。
			 */
			React.useEffect(() => {
				let cancelled = false;
				let timer = 0;
				let n = 0;
				const tick = () => {
					if (cancelled) return;
					const element = webviewRef.current;
					if (element === null) return;
					try {
						void element.executeJavaScript(makeTransparentJs())
							.then((r) => probe("diag.transparent", { n, result: r }))
							.catch((e) => probe("diag.transparent", { n, error: String(e) }));
					} catch (e) {
						void probe("diag.transparent", { n, throw: String(e) });
					}
					n += 1;
					if (n < 8) timer = window.setTimeout(tick, 1500);
				};
				timer = window.setTimeout(tick, 1200);
				return () => {
					cancelled = true;
					if (timer !== 0) window.clearTimeout(timer);
				};
			}, []);

			/** 气泡层：一次性铺 14 个，纯 CSS 动画驱动。 */			/** 气泡层：一次性铺 14 个，纯 CSS 动画驱动。 */
			React.useEffect(() => {
				const box = bubblesRef.current;
				if (box === null) return;
				for (let i = 0; i < 14; i++) {
					const b = document.createElement("div");
					b.className = "dshc-bubble";
					const size = 3 + Math.random() * 7;
					b.style.width = size + "px";
					b.style.height = size + "px";
					b.style.left = (6 + Math.random() * 88) + "%";
					b.style.bottom = (-10 + Math.random() * 20) + "px";
					b.style.animationDuration = (7 + Math.random() * 9) + "s";
					b.style.animationDelay = (-Math.random() * 14) + "s";
					box.appendChild(b);
				}
				return () => { box.replaceChildren(); };
			}, []);

			// 窗口尺寸变化时重新夹取
			React.useEffect(() => {
				const onResize = () => setBox((prev) => clampBox(prev, readViewport()));
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, []);

			/**
			 * 显式存盘：只在拖动/缩放结束（pointerup）时调用。
			 *
			 * 不用 useEffect 监听 box：面板是条件渲染，关闭即卸载、
			 * 打开即重建，依赖「守卫变量」的做法反复失效。
			 */
			const saveBox = React.useCallback((next) => {
				uiStateCache = uiStateCache !== null
					? { ...uiStateCache, ...next }
					: { ...next, lastUrl };
				void apiPost("ui-state", next).catch(() => {});
			}, []);

			/**
			 * 套用正文字号缩放。
			 *
			 * 只走 CSS 注入这一条路，**刻意不再让原生缩放生效**：
			 * 原生 setZoomFactor 是整页等比缩放（连按钮、侧边栏、滚动条一起动），
			 * 而主人要的是「其他部分原样不变，只缩正文」。
			 * 唯一保留的原生调用是把 zoomFactor 复位成 1，清掉历史残留。
			 *
			 * 每次调用都把结果记进探针：
			 *   - selector 有值 → 命中，正文已缩放
			 *   - ok:false + probe 数组 → 未命中，数组里是页面真实类名，
			 *     下一轮据此修正 CONTENT_SELECTORS
			 */
			const applyFontScale = React.useCallback(async (scale) => {
				const element = webviewRef.current;
				if (element === null) return;

				// 若上一轮启用过原生整页缩放，这里复位，
				// 保证「只有正文变」的语义不被残留状态破坏
				try {
					if (typeof element.setZoomFactor === "function") element.setZoomFactor(1);
				} catch {}

				const js = makeFontAdaptJs(scale);
				let result = null;
				let attempt = 0;

				/* 诊断：先在「未注入任何透明 CSS」的干净状态下抓原始数据 */
				try {
					const diagRaw = await element.executeJavaScript(makeTransparentJs());
					await probe("diag.raw", diagRaw);
				} catch (e) { await probe("diag.raw", { throw: String(e) }); }

				// 正文容器可能还没渲染出来，重试直到命中或放弃
				for (let i = 0; i <= FONT_RETRY_DELAYS.length; i++) {
					try {
						result = await element.executeJavaScript(js);
					} catch (error) {
						result = { ok: false, error: String(error) };
					}
					attempt = i + 1;
					if (result !== null && result.ok === true) break;
					// 结构性错误（脚本异常）没必要重试
					if (result !== null && result.error !== undefined) break;
					if (i === FONT_RETRY_DELAYS.length) break;
					await new Promise((resolve) => setTimeout(resolve, FONT_RETRY_DELAYS[i]));
				}

				await probe("panel.font-scale", { scale, attempt, result });
			}, []);

			// 回填 ref：applyFontScale 定义完才有引用
			applyFontScaleRef.current = applyFontScale;

			// fontScale 变化时同步进 ref，供只跑一次的 useEffect 读取
			React.useEffect(() => {
				fontScaleRef.current = fontScale;
			}, [fontScale]);

			/**
			 * 把「改变字号」的副作用统一收敛到一个地方。
			 *
			 * 关键教训：useState 的 updater 函数必须是**纯函数**。
			 * 早期版本把 applyFontScale / apiPost 写在 setFontScale(prev => ...) 里，
			 * React 在 StrictMode 或并发渲染下会重复调用 updater，
			 * 导致：① 同一个值被连发多次（日志里三条同时间戳的 scale=0.85）；
			 *      ② 部分调用被丢弃，最终存盘的不是用户最后选的值。
			 * 这正是「调到 80% 重启后回到 90%」的根因。
			 *
			 * 现在改为：先用 ref 算出目标值 → setFontScale 只负责写状态 →
			 * 注入与存盘都在 updater 之外执行。
			 */
			const commitFontScale = React.useCallback((nextRaw) => {
				const next = clampFontScale(nextRaw);
				if (next === fontScaleRef.current) return;
				// 标记用户已主动修改，之后缓存回填不得覆盖这个选择
				committedFontScaleRef.current = true;
				fontScaleRef.current = next;
				if (uiStateCache !== null) uiStateCache = { ...uiStateCache, fontScale: next };
				setFontScale(next);
				void applyFontScale(next);
				void apiPost("ui-state", { fontScale: next }).catch(() => {});
			}, [applyFontScale]);

			/** 调整字号：按步进增减后提交。 */
			const changeFontScale = React.useCallback((delta) => {
				commitFontScale(fontScaleRef.current + delta);
			}, [commitFontScale]);

			/** 复位到默认字号。 */
			const resetFontScale = React.useCallback(() => {
				commitFontScale(FONT_SCALE_DEFAULT);
			}, [commitFontScale]);

			/**
			 * 快捷键：Ctrl/Cmd + 加号/减号/0。
			 *
			 * 关键：必须只在「焦点在面板自己的 UI 上」时才响应。
			 *
			 * 原实现直接 window.addEventListener("keydown")，而面板内嵌的是
			 * <webview>，DeepSeek 输入框的按键会冒泡到宿主窗口 —— 用户在对话框里
			 * 打 Ctrl+- / Ctrl+= 时，字号会被"偷偷"改掉并写入 ui.json。
			 * 日志里成对出现的 0.95→0.9 就是这么来的，最终导致盘上值被改小。
			 *
			 * 现在用 panelRef 判定：只有事件目标位于面板内部
			 * 且不在 webview 里时才处理。
			 */
			React.useEffect(() => {
				const onKey = (event) => {
					if (!(event.ctrlKey || event.metaKey)) return;
					// 焦点在 webview（DeepSeek 页面）内 → 一律放行，不拦截
					const target = event.target;
					if (target === null || target === undefined) return;
					if (target.closest !== undefined && target.closest("webview") !== null) return;
					if (event.key === "=" || event.key === "+") {
						event.preventDefault();
						changeFontScale(FONT_SCALE_STEP);
					} else if (event.key === "-" || event.key === "_") {
						event.preventDefault();
						changeFontScale(-FONT_SCALE_STEP);
					} else if (event.key === "0") {
						event.preventDefault();
						resetFontScale();
					}
				};
				window.addEventListener("keydown", onKey, true);
				return () => window.removeEventListener("keydown", onKey, true);
			}, [changeFontScale, resetFontScale]);

			// ---- webview 生命周期 ----
			React.useEffect(() => {
				let disposed = false;

				/**
				 * 执行一次导航并等它加载完成。
				 *
				 * 关键：监听器必须**先于**触发动作挂上。若写成
				 * "await loadURL(…); await waitLoaded(…)"，对于加载很快的页面，
				 * did-finish-load 可能早于监听器注册就已经触发，
				 * 于是白等到超时才继续 —— 表现为「明明加载好了却卡在遮罩里」。
				 *
				 * 原实现用固定 setTimeout(3000) 硬等：网络慢时误判未登录，
				 * 网络快时白等。两者都不可靠。
				 */
				const navigateAndWait = async (element, action, timeoutMs) => {
					let settle;
					const loaded = new Promise((resolve) => { settle = resolve; });
					let done = false;
					const finish = () => {
						if (done) return;
						done = true;
						element.removeEventListener("did-finish-load", finish);
						element.removeEventListener("did-fail-load", finish);
						clearTimeout(timer);
						settle();
					};
					let timer = setTimeout(finish, timeoutMs);
					element.addEventListener("did-finish-load", finish);
					element.addEventListener("did-fail-load", finish);
					try {
						await action();
					} catch {
						// 导航失败直接放行，由后续读页面状态判断真实情况
						finish();
					}
					await loaded;
				};

				/** 读一次 guest 内登录态；失败返回 null。 */
				const readGuestSession = async (element) => {
					try {
						return await element.executeJavaScript(READ_SESSION_JS);
					} catch {
						return null;
					}
				};

				/** 已登录则刷新存盘。 */
				const persistIfSignedIn = async (guest, note) => {
					await apiPost("save-session", {
						token: guest.token,
						userInfo: guest.userInfo,
						origin: guest.origin,
						note
					}).catch(() => {});
				};

				const open = async (element) => {
					setState("loading");
					setMessage("正在打开 DeepSeek…");

					const targetUrl = isChatUrl(lastUrl) ? lastUrl : DS_HOME;
					await probe("panel.nav-target", { targetUrl });

					await navigateAndWait(element, async () => {
						try {
							await element.loadURL(targetUrl);
						} catch (error) {
							await probe("panel.load-fail", { error: String(error) });
						}
					}, LOAD_TIMEOUT);
					if (disposed) return;

					// 页面一加载完就缩放，避免用户先看到一帧大字号再跳变。
					// 失败不阻断后续流程。
					await applyFontScaleRef.current(fontScaleRef.current);
					if (disposed) return;

					const first = await readGuestSession(element);
					if (first === null) {
						setState("error");
						setMessage("无法读取页面状态，请点击右上角刷新重试");
						await probe("panel.exec-fail", {});
						return;
					}

					rememberUrl(first.href);
					await probe("panel.initial-state", {
						signedIn: isSignedIn(first), href: first.href, tokenLen: first.tokenLen
					});

					// 已登录：直接用，顺手刷新存盘
					if (isSignedIn(first)) {
						setState("ready");
						setMessage("");
						await persistIfSignedIn(first, "auto-refresh-on-open");
						return;
					}

					// 未登录：尝试用存盘 token 恢复
					const saved = (await apiGet("session").catch(() => null))?.session ?? null;
					await probe("panel.saved-session", {
						hasSession: saved !== null,
						tokenLen: saved?.token ? String(saved.token).length : 0
					});

					if (typeof saved?.token === "string" && saved.token.length > 0) {
						setMessage("正在恢复登录状态…");
						const written = await element.executeJavaScript(
							makeWriteJs(saved.token, saved.userInfo ?? null)
						).catch(() => null);
						await probe("panel.injected", written);

						await navigateAndWait(element, () => element.reload(), LOAD_TIMEOUT);
						if (disposed) return;

						const second = await readGuestSession(element);
						await probe("panel.after-restore", {
							signedIn: isSignedIn(second),
							href: second?.href,
							tokenLen: second?.tokenLen
						});

						if (isSignedIn(second)) {
							rememberUrl(second.href);
							setState("ready");
							setMessage("");
							await persistIfSignedIn(second, "auto-refresh-after-restore");
							return;
						}
					}

					// 无存盘或恢复失败：显示登录页，后台轮询抓取
					setState("ready");
					setMessage("");
					await probe("panel.needs-login", {});

					void (async () => {
						const deadline = Date.now() + LOGIN_POLL_MS;
						while (!disposed && Date.now() < deadline) {
							await new Promise((r) => setTimeout(r, LOGIN_POLL_INTERVAL));
							if (disposed) return;
							const guest = await readGuestSession(element);
							if (guest === null || !isSignedIn(guest)) continue;
							rememberUrl(guest.href);
							await persistIfSignedIn(guest, "captured-after-manual-login");
							await probe("panel.login-captured", {
								tokenLen: guest.token ? String(guest.token).length : 0
							});
							return;
						}
					})();
				};

				const boot = async () => {
					const carrier = globalThis.dshDesktop;
					const bridge = carrier && carrier.protocolVersion === 1 ? carrier.browser : undefined;
					if (bridge === undefined) {
						setState("error");
						setMessage("当前环境不支持内嵌窗口（仅桌面端可用）");
						await probe("panel.no-bridge", {});
						return;
					}
					bridgeRef.current = bridge;

					let reservation;
					try {
						reservation = await bridge.acquire(WORKSPACE_ID);
					} catch (error) {
						setState("error");
						setMessage("无法创建窗口：" + String(error));
						await probe("panel.acquire-fail", { error: String(error) });
						return;
					}

					// 组件已卸载：立刻归还租约，避免泄漏
					if (disposed) {
						await bridge.release(reservation.lease).catch(() => {});
						return;
					}
					leaseRef.current = reservation.lease;

					const element = document.createElement("webview");
					element.className = "dshc-webview";
					element.setAttribute("name", reservation.lease);
					element.setAttribute("partition", reservation.partition);
					element.setAttribute("allowpopups", "");
					/* 让 webview 自身背景透明，配合页面内注入的 transparent CSS，
					   浮窗的玻璃/气泡才能透上来。缺这条属性，guest 页面即使全透明，
					   webview 容器本身仍会画一层底色。 */
					element.setAttribute("webpreferences", "backgroundThrottling=yes");
					try { element.style.background = "transparent"; } catch {}
					// useragent 属性是官方支持的口子，去掉 Electron 标识
					// 后再加载可消除「环境异常」警告
					element.setAttribute("useragent", BROWSER_UA);
					element.setAttribute("src", "about:blank#" + reservation.lease);
					webviewRef.current = element;

					// 页面真正跳转时才记录 URL（登录页 → 主界面、切换会话等）
					const onNavigate = () => {
						try {
							rememberUrl(element.getURL());
						} catch {}
						// SPA 内部跳转若重建了 head，已注入的 style 会丢失，补一次
						void applyFontScaleRef.current(fontScaleRef.current);
					};
					element.addEventListener("did-navigate", onNavigate);
					element.addEventListener("did-navigate-in-page", onNavigate);
					element.addEventListener("did-fail-load", (event) => {
						if (event.errorCode === -3) return; // -3 = 主动中止，正常
						void probe("panel.did-fail-load", {
							code: event.errorCode, description: event.errorDescription
						});
					});

					if (bodyRef.current === null) {
						setState("error");
						setMessage("窗口容器未就绪");
						await probe("panel.no-body", {});
						return;
					}
					bodyRef.current.appendChild(element);

					element.addEventListener("dom-ready", () => {
						if (!disposed) void open(element);
					}, { once: true });
				};

				void boot();

				return () => {
					disposed = true;
					const element = webviewRef.current;
					if (element !== null) {
						try { element.remove(); } catch {}
					}
					const bridge = bridgeRef.current;
					const lease = leaseRef.current;
					if (bridge != null && typeof lease === "string") {
						void bridge.release(lease).catch(() => {});
					}
				};
			}, []);
			// ---- 拖动 ----
			const startDrag = (event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				const startX = event.clientX;
				const startY = event.clientY;
				const origin = { ...box };
				// 每帧只更新一次，避免 pointermove 上百次 setState
				const throttle = createFrameThrottle();

				const move = (e) => {
					const left = origin.left + (e.clientX - startX);
					const top = origin.top + (e.clientY - startY);
					throttle.run(() => {
						setBox(clampBox({ ...origin, left, top }, readViewport()));
					});
				};
				const up = () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
					throttle.cancel();
					// 副作用（saveBox）必须留在 updater 之外，
					// 否则 StrictMode/并发渲染下会被重复执行或丢弃
					const settled = snapToEdge(clampBox(boxRef.current, readViewport()), readViewport());
					setBox(settled);
					saveBox(settled);
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			};

			// ---- 四角缩放 ----
			const startResize = (corner) => (event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				const startX = event.clientX;
				const startY = event.clientY;
				const origin = { ...box };
				const growRight = corner === "se" || corner === "ne";
				const growDown = corner === "se" || corner === "sw";

				// 每帧只更新一次：缩放是最重的路径（webview 要跟着改尺寸），
				// pointermove 原样 setState 会让整块面板每秒重排上百次
				const throttle = createFrameThrottle();

				const compute = (e) => {
					const dx = e.clientX - startX;
					const dy = e.clientY - startY;
					const next = { ...origin };

					if (growRight) {
						next.width = origin.width + dx;
					} else {
						next.width = origin.width - dx;
						next.left = origin.left + dx;
					}
					if (growDown) {
						next.height = origin.height + dy;
					} else {
						next.height = origin.height - dy;
						next.top = origin.top + dy;
					}

					// 触到最小尺寸时位置不再跟随，避免左/上角拖动时窗口乱跑
					if (next.width <= MIN_W) {
						if (!growRight) next.left = origin.left + (origin.width - MIN_W);
						next.width = MIN_W;
					}
					if (next.height <= MIN_H) {
						if (!growDown) next.top = origin.top + (origin.height - MIN_H);
						next.height = MIN_H;
					}
					return clampBox(next, readViewport());
				};

				const move = (e) => {
					const next = compute(e);
					throttle.run(() => setBox(next));
				};
				const up = () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
					throttle.cancel();
					// 同上：saveBox 不能写在 updater 里
					const settled = boxRef.current;
					setBox(settled);
					saveBox(settled);
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			};

			/*
			 * 用 portal 挂到 document.body：
			 * 入口按钮在 sidebar.footer.action 里，而侧边栏折叠动画带 transform，
			 * 会让 position:fixed 的定位基准退化为侧边栏而非视口。
			 */
			return ReactDOM.createPortal(h("div", {
					className: "dshc-wrap",
					style: {
						left: box.left + "px",
						top: box.top + "px",
						width: box.width + "px",
						height: box.height + "px"
					}
				},
				/* 水波画布：放在 wrap 层，不被 panel 的 overflow:hidden 裁剪；
				   z-index 2147482500 —— 高于 webview 原生层，低于缩放把手 2147483000。 */
				// 面板本体：需要圆角裁剪的内容都在这里
				h("div", { className: "dshc-panel", "data-theme": theme },
					// 装饰层：玻璃在最底，气泡压玻璃
					h("div", { className: "dshc-glass" }),
					h("div", { className: "dshc-bubbles", ref: bubblesRef }),
					h("canvas", { className: "dshc-water", ref: waterRef }),
					h("div", { className: "dshc-head", onPointerDown: startDrag },
					h("span", { className: "dshc-dot", "data-state": state }),
					h("span", { className: "dshc-title" }, "小助手"),
					// 字号调节：A- / 当前百分比 / A+（点百分比回到默认）
					h("button", {
						className: "dshc-fontbtn", type: "button", title: "缩小字体（Ctrl -）",
						disabled: fontScale <= FONT_SCALE_MIN,
						onClick: () => changeFontScale(-FONT_SCALE_STEP)
					}, "A-"),
					h("span", {
						className: "dshc-fontlabel",
						title: "点击恢复默认 " + Math.round(FONT_SCALE_DEFAULT * 100) + "%",
						style: { cursor: "pointer" },
						onClick: resetFontScale
					}, Math.round(fontScale * 100) + "%"),
					h("button", {
						className: "dshc-fontbtn", type: "button", title: "放大字体（Ctrl +）",
						disabled: fontScale >= FONT_SCALE_MAX,
						onClick: () => changeFontScale(FONT_SCALE_STEP)
					}, "A+"),
					h("button", {
						className: "dshc-btn", title: "重新加载", type: "button",
						onClick: () => { try { webviewRef.current?.reload(); } catch {} }
					}, "⟳"),
					h("button", {
						className: "dshc-btn", title: "收起", type: "button", onClick: onClose
					}, "×")
				),
				h("div", { className: "dshc-body", ref: bodyRef },
					message !== "" ? h("div", { className: "dshc-overlay" }, message) : null,
					["se", "sw", "ne", "nw"].map((corner) => h("div", {
						key: corner,
						className: "dshc-grip",
						"data-corner": corner,
						onPointerDown: startResize(corner)
					}))
				)
				)  // ← 闭合 .dshc-panel
			), document.body);
		}

		// ============ 侧栏入口 ============

		function SidebarEntry() {
			const [open, setOpen] = React.useState(false);
			const [ready, setReady] = React.useState(() => uiStateCache !== null);

			React.useEffect(() => {
				if (ready) return;
				let cancelled = false;
				void uiStateLoaded.then(() => {
					if (!cancelled) setReady(true);
				});
				return () => { cancelled = true; };
			}, [ready]);

			return h(React.Fragment, null,
				h("div", { className: "dshc-entrybar" },
					h("button", {
						type: "button",
						className: "dshc-entry",
						"data-open": open ? "1" : "0",
						title: open ? "收起小助手" : "打开小助手",
						"aria-label": "小助手",
						onClick: () => {
							if (!open && !ready) return;
							setOpen((v) => !v);
						}
					},
						h("img", {
							className: "dshc-entry-img",
							src: ICON_URL,
							alt: "",
							draggable: false
						})
					)
				),
				open ? h(CompanionPanel, { onClose: () => setOpen(false) }) : null
			);
		}

		// ============ 注册 ============

		const inject = ["slots"];

		function apply(ctx) {
			ensureStyle();
			// 入口：左侧栏底部，与会话列表/设置同级
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-familiar-dsweb",
				order: 50
			}, SidebarEntry));
			void probe("client.loaded", { href: location.href });
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
