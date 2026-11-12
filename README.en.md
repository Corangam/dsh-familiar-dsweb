# dsh-familiar-dsweb

A floating companion for DSH Desktop: a draggable window embedding the DeepSeek web chat,
so you can open a free side conversation without leaving your work.

> **v1.0.0** — stable. UI frozen; behaviour verified.

---

## Features

| Feature | Notes |
|---|---|
| Sidebar entry | 30×30 round avatar in `sidebar.footer.action` |
| Floating window | Draggable, resizable from all four corners (min 280×220), snaps to edges |
| Geometry memory | Saved in `ui.json`, restored on restart, clamped into the viewport |
| Last chat restored | `lastUrl` kept, restricted to the `chat.deepseek.com` origin |
| Session persistence | Token stored locally and re-injected, so one login lasts |
| UA masking | Removes DeepSeek's "unusual environment" warning |
| Font scaling | 60%–140%, body text only, persisted |
| Theme following | Follows the DSH host theme; wave and glass follow along |
| Ocean frame | Canvas surf along the full perimeter with specular crest highlights |

### Shortcuts

`Ctrl/⌘ + =` zoom in · `Ctrl/⌘ + -` zoom out · `Ctrl/⌘ + 0` reset.
Active **only when focus is inside the panel and not inside the embedded page**.

---

## Install

```bash
dsh plugin --profile desktop add dsh-familiar-dsweb
```

Or add to `~/.dsh/profiles/<profile>/package.json`:

```json
{
  "dependencies": { "dsh-familiar-dsweb": "^1.0.0" },
  "dsh": { "profile": { "bundles": ["...", "dsh-familiar-dsweb"] } }
}
```

The plugin does **not** hot-reload. Restart DSH Desktop after installing.

---

## Security notice — please read

This plugin embeds `https://chat.deepseek.com` in an Electron `<webview>`
and **stores your DeepSeek session token in plain text** at:

```
~/.dsh/plugin-data/dsh-familiar-dsweb/session.json
```

- The token is written **only** by the local host process; nothing is sent anywhere else.
- There is **no telemetry, no analytics, and no external service**.
- Token injection is gated: it is written only when the guest page is verified to be
  `chat.deepseek.com` by origin comparison.
- The file is protected by your user-directory permissions alone.
  **Do not share or sync this directory.**

If that trade-off is unacceptable to you, do not install this plugin.

---

## Data directory

```
~/.dsh/plugin-data/dsh-familiar-dsweb/
├── session.json    # plaintext token + userInfo
├── ui.json         # geometry, lastUrl, fontScale
├── probe.log       # diagnostics, hard-capped at 1 MB
└── probe.log.1     # previous generation
```

Set `localStorage.setItem("dshc-probe", "1")` to enable verbose diagnostics.

---

## Known limitations

| Limitation | Reason |
|---|---|
| Cannot overlap the native title bar | `titleBarOverlay` is an OS-level layer |
| Cannot float outside the DSH window | The panel is renderer-process DOM |
| Reload needed after restart | The webview is rebuilt each time |
| Font scaling depends on DeepSeek class names | Degrades silently if they change |

---

## License

Two licenses cover this package. **Both prohibit commercial use.**

| Asset | License | Notes |
|---|---|---|
| Source code (`lib/`) | [PolyForm Noncommercial 1.0.0](./LICENSE) | Open source, free to modify and redistribute, **no commercial use of any kind** |
| Icon (`assets/`) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | Third-party work: attribution, non-commercial, share-alike |

The mascot comes from [treapgogo/deepseek-whale-girl](https://treapgogo.github.io/deepseek-whale-girl/),
created by **treapgogo**. Full license texts live in
[`licenses/deepseek-whale-girl/`](./licenses/deepseek-whale-girl/); the umbrella statement is in
[NOTICE](./NOTICE).

For commercial licensing, open an issue at
[github.com/Corangam/dsh-familiar-dsweb/issues](https://github.com/Corangam/dsh-familiar-dsweb/issues).

---

## Acknowledgements

All code in this plugin was written by two AI assistants working together
(the author does not write code):

- **deepseek-v4.1-flash-1017**
- **gemini 3.8 flash**

The mascot artwork was created by **treapgogo** for
[deepseek-whale-girl](https://treapgogo.github.io/deepseek-whale-girl/).
