# Kova

A fast, keyboard-driven presentation editor for people who'd rather write than click.

Kova turns plain Markdown into polished slides — with live preview, multiple layouts, theming, and PPTX export — all in a native desktop app.

---

## Download

[![Latest release](https://img.shields.io/github/v/release/KovaMD/Kova?label=release&color=orange)](https://github.com/KovaMD/Kova/releases/latest)

| Platform | Download |
|---|---|
| **macOS** (Apple Silicon + Intel) | [**Download .dmg**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_macOS.dmg) |
| **Windows 10/11** | [**Download .msi**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows.msi) · [Setup .exe](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows_setup.exe) |
| **Linux (Debian/Ubuntu)** | [**.deb package**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.deb) · [or via package manager](#linux-package-managers) |
| **Linux (Fedora/RHEL)** | [**.rpm package**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.rpm) · [or via package manager](#linux-package-managers) |
| **Linux (AppImage)** | [**.AppImage**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.AppImage) |

> macOS: signed and notarised — double-click to install. Windows: click **More info → Run anyway** if SmartScreen appears.

> **Alpha software.** Expect rough edges. Please [report bugs](https://github.com/KovaMD/Kova/issues) if you find them.
>
> **Presentation mode is actively in development and currently unstable.** Multi-monitor setups in particular are known to be buggy — use with caution.

---

## Linux package managers

<details>
<summary><strong>Debian 13+ (DEB822 format)</strong></summary>

```bash
sudo curl -fsSL https://deb.kova.md/key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kova.gpg

sudo tee /etc/apt/sources.list.d/kova.sources > /dev/null << EOF
Types: deb
URIs: https://deb.kova.md
Suites: stable
Components: main
Signed-By: /etc/apt/keyrings/kova.gpg
EOF

sudo apt update && sudo apt install kova
```

</details>

<details>
<summary><strong>Ubuntu / older Debian</strong></summary>

```bash
sudo curl -fsSL https://deb.kova.md/key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kova.gpg

echo "deb [signed-by=/etc/apt/keyrings/kova.gpg] https://deb.kova.md stable main" \
  | sudo tee /etc/apt/sources.list.d/kova.list

sudo apt update && sudo apt install kova
```

</details>

<details>
<summary><strong>Fedora / RHEL / CentOS Stream</strong></summary>

```bash
sudo rpm --import https://rpm.kova.md/key.gpg
sudo curl -o /etc/yum.repos.d/kova.repo https://rpm.kova.md/kova.repo
sudo dnf install kova
```

</details>

---

## Features

- **Markdown-first** — write slides in plain text, separated by `---`
- **Auto layout** — title, section, split, two-column, grid, quote, full-bleed, and more, detected automatically from content
- **Live preview** — editor and preview stay in sync as you type
- **Syntax highlighting** — fenced code blocks rendered with highlight.js
- **Mermaid diagrams** — pie, bar, line charts and flowcharts inline
- **Themes** — built-in themes plus custom YAML themes from `~/.kova/themes/`
- **Focus mode** — dims non-active slides, collapses side panels
- **Fullscreen presentation** — speaker notes, slide counter, keyboard and click navigation *(in development — multi-monitor mode is currently unstable)*
- **PPTX export** — export to PowerPoint (16:9 and 4:3)
- **YouTube & poll embeds** — `!youtube[label](url)` opens in browser; `!poll[label](url)` renders a QR code
- **File watcher** — reloads automatically when the file is edited externally
- **Keybindings** — configurable via `~/.kova/keybindings.yaml`

## Special syntax

```markdown
# Title slide (H1)

---

## Section break (H2, no body)

---

### Regular slide with auto-detected layout

Content here.

|||

This goes in the right column (two-column layout).

---

!youtube[Watch demo](https://youtu.be/example)

---

!poll[Vote now](https://example.com/poll)

---

!progress[Complete](80)
!progress[In progress](45)

---

> "A quote-only slide gets the quote layout automatically."

???

Speaker notes go here — only visible in presentation mode.
```

## Building from source

These instructions are for contributors and developers. If you just want to use Kova, download a pre-built binary from the [Releases page](https://github.com/KovaMD/Kova/releases/latest) instead.

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

### Run in development

```bash
git clone https://github.com/KovaMD/Kova.git
cd Kova
npm install
npm run tauri dev
```

### Build a release binary

```bash
npm run tauri build
```

## Keybindings

Default shortcuts:

| Action | Shortcut |
|--------|----------|
| New file | `Ctrl+N` |
| Open file | `Ctrl+O` |
| Save | `Ctrl+S` |
| Save as | `Ctrl+Shift+S` |
| Focus mode | `Ctrl+Shift+F` |

To customise, edit `~/.kova/keybindings.yaml` (created automatically on first launch). Open it from **Settings → Keyboard Shortcuts → Open file**.

## Custom themes

Place YAML theme files in `~/.kova/themes/`. They appear in the Inspector panel under Themes.

## License

Kova is free and open source software, released under the **GNU General Public License v3.0**.

You are free to use, study, modify, and distribute this software under the terms of the GPL v3. Any modified versions distributed to others must also be made available under the GPL v3.

See [LICENSE](LICENSE) for the full license text.

---

© 2026 Kova contributors
