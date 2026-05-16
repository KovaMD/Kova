# Kova

Kova turns plain Markdown into polished slides — with live preview, multiple layouts, theming, and PPTX export — all in a native desktop app.

---

## Download

[![Latest release](https://img.shields.io/github/v/release/KovaMD/Kova?label=release&color=orange)](https://github.com/KovaMD/Kova/releases/latest)
[![Service status](https://status.kova.md/api/badge/1/status?style=flat&label=services)](https://status.kova.md/status/infra)

| Platform | Download |
|---|---|
| **macOS** (Apple Silicon + Intel) | [**Download .dmg**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_macOS.dmg) |
| **Windows 10/11** | [**Download .msi**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows.msi) · [Setup .exe](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows_setup.exe) |
| **Linux (Debian/Ubuntu)** | [**.deb package**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.deb) · [or via package manager](#linux-package-managers) |
| **Linux (Fedora/RHEL/openSUSE)** | [**.rpm package**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.rpm) · [or via package manager](#linux-package-managers) |


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

<details>
<summary><strong>openSUSE</strong></summary>

```bash
sudo rpm --import https://rpm.kova.md/key.gpg
sudo curl -o /etc/zypp/repos.d/kova.repo https://rpm.kova.md/kova.repo
sudo zypper refresh && sudo zypper install kova
```

</details>

---

## Features

- **Markdown-first** — write slides in plain text, separated by `---`
- **Auto layout** — title, section, split, two-column, grid, quote, full-bleed, and more, detected automatically from content
- **Live preview** — editor and preview stay in sync as you type
- **Syntax highlighting** — fenced code blocks rendered with highlight.js
- **Mermaid diagrams** — pie, bar, line charts and flowcharts inline
- **Themes** — 11 built-in themes, community themes via the theme library, and custom YAML themes
- **Focus mode** — dims non-active slides, collapses side panels
- **Fullscreen presentation** — speaker notes, slide counter, keyboard and click navigation *(in development — multi-monitor mode is currently unstable)*
- **PPTX export** — export to PowerPoint (16:9 and 4:3)
- **YouTube & poll embeds** — `!youtube[label](url)` opens in browser; `!poll[label](url)` renders a QR code
- **File watcher** — reloads automatically when the file is edited externally
- **Keybindings** — configurable via `~/.kova/keybindings.yaml`


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

## Themes

**Theme library** — open the Inspector, expand **Theme**, and click **More Themes…** to browse and install community themes from [themes.kova.md](https://themes.kova.md). Each download is verified against a SHA-256 checksum. Installed themes appear in the picker immediately.

**Custom themes** — place YAML theme files in `~/.kova/themes/`. They appear in the Inspector alongside built-in themes. See the [Themes wiki page](https://github.com/KovaMD/Kova/wiki/Themes) for the full YAML format.

## License

Kova is free and open source software, released under the **GNU General Public License v3.0**.

You are free to use, study, modify, and distribute this software under the terms of the GPL v3. Any modified versions distributed to others must also be made available under the GPL v3.

See [LICENSE](LICENSE) for the full license text.

---

© 2026 Kova contributors
