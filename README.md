# Kova

Kova turns plain Markdown into polished slides — with live preview, multiple layouts, theming, and PPTX export — all in a native desktop app.

[![Latest release](https://img.shields.io/github/v/release/KovaMD/Kova?label=release&color=orange)](https://github.com/KovaMD/Kova/releases/latest)
[![Service status](https://status.kova.md/api/badge/1/status?style=flat&label=services)](https://status.kova.md/status/infra)
[![Matrix](https://img.shields.io/matrix/kova-md%3Amatrix.org?server_fqdn=matrix.org&label=matrix&color=blue)](https://matrix.to/#/#kova-md:matrix.org)

## Features

- **Markdown-first** — write slides in plain text, separated by `---`
- **Auto layout** — title, section, split, two-column, grid, quote, full-bleed, and more
- **Live preview** — editor and preview stay in sync as you type
- **Syntax highlighting** — fenced code blocks rendered with highlight.js
- **Math & LaTeX** — inline and block math via KaTeX (`$...$` and `$$...$$`)
- **Mermaid diagrams** — pie, bar, line charts and flowcharts inline
- **Themes** — 11 built-in themes, community themes, and custom YAML
- **Focus mode** — dims non-active slides, collapses side panels
- **Fullscreen presentation** — speaker notes, slide counter, keyboard and click navigation
- **PPTX export** — export to PowerPoint (16:9 and 4:3)
- **Academic references** — cite sources with `!ref[Author, Year. Title]`; renders as small bottom-right text on the slide and exports to PPTX
- **YouTube & poll embeds** — `!youtube[label](url)` and `!poll[label](url)`
- **Local video** — `!video[label](path.mp4)` plays an inline file (relative to the document or absolute)
- **Insert media** — drag-drop, paste, or right-click → Insert → Image or Video; files are copied into `assets/` automatically
- **File watcher** — reloads automatically when the file is edited externally
- **Keybindings** — configurable via `~/.config/kova/keybindings.yaml`

## Download

| Platform | Download |
|---|---|
| **macOS** (Apple Silicon + Intel) | [**Download .dmg**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_macOS.dmg) |
| **Windows 10/11** | [**Download .msi**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows.msi) · [Setup .exe](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows_setup.exe) |
| **Linux (Debian/Ubuntu)** | [**.deb package**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.deb) · [or via package manager](#linux-package-managers) |
| **Linux (Fedora/RHEL/openSUSE)** | [**.rpm package**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.rpm) · [or via package manager](#linux-package-managers) |
| **Linux (AppImage)** | [**.AppImage**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.AppImage) |

## Linux package managers

> **AppImage note** — Bundled graphics libs are stripped for compatibility with Arch/Fedora/etc., and the AppImage is signed so in-app auto-update works. See [issue #3](https://github.com/KovaMD/Kova/issues/3) for background.

**Debian / Ubuntu**

```bash
sudo curl -fsSL https://deb.kova.md/key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kova.gpg
echo "deb [signed-by=/etc/apt/keyrings/kova.gpg] https://deb.kova.md stable main" \
  | sudo tee /etc/apt/sources.list.d/kova.list
sudo apt update && sudo apt install kova
```

Debian 13+ — use the [DEB822 source format](https://wiki.kova.md/install/linux/).

**Fedora / RHEL / openSUSE**

```bash
sudo rpm --import https://rpm.kova.md/key.gpg
sudo curl -o /etc/yum.repos.d/kova.repo \
  https://rpm.kova.md/kova.repo
sudo dnf install kova   # openSUSE: zypper install kova
```

**Nix (flakes)**

```bash
nix run github:KovaMD/Kova          # run without installing
nix profile install github:KovaMD/Kova   # install into your profile
```

Or add `github:KovaMD/Kova` as a flake input and use `packages.<system>.default`.

**Flatpak**

Flathub's current policy excludes LLM-assisted apps, so Kova ships from a self-hosted Flatpak repo:

```bash
flatpak install https://flatpak.kova.md/kova.flatpakref
flatpak run md.kova.app
```

Or build it locally from the manifest:

```bash
flatpak install flathub org.gnome.Platform//49 org.gnome.Sdk//49
curl -fsSL -o packaging/flatpak/kova.deb \
  https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.deb
flatpak-builder --user --install --force-clean build packaging/flatpak/md.kova.app.yml
flatpak run md.kova.app
```

## Building from source

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) (stable), and [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/KovaMD/Kova.git
cd Kova
npm install
npm run tauri dev      # development — hot-reload
npm run tauri build    # release binary
```

Nix users can skip the prerequisites: `nix develop` drops you in a shell with Rust, Node, and Tauri ready.

See the [Contributing guide](https://wiki.kova.md/contributing/) for more details, or [TRANSLATING.md](TRANSLATING.md) if you'd like to add a language.

## Keybindings

To customise, edit your keybindings file (created automatically on first launch), or open it from **Settings → Keyboard Shortcuts → Open file**.

| Platform | Path |
|----------|------|
| **macOS** | `~/Library/Application Support/kova/keybindings.yaml` |
| **Linux** | `~/.config/kova/keybindings.yaml` |
| **Windows** | `%APPDATA%\kova\keybindings.yaml` |

Custom themes follow the same base path, under a `themes/` subfolder. Full reference on the [Keyboard Shortcuts](https://wiki.kova.md/keyboard-shortcuts/) wiki page.

## Themes

**Theme library** — open the Inspector, expand **Theme**, and click **More Themes…** to browse and install community themes from the [KovaMD/Themes](https://github.com/KovaMD/Themes) repository. Each download is verified against a SHA-256 checksum. Installed themes appear in the picker immediately.

**Custom themes** — place YAML theme files in the `themes/` subfolder of your config directory (see Keybindings above for platform paths). They appear in the Inspector alongside built-in themes. See the [Themes](https://wiki.kova.md/themes/) wiki page for the full YAML format.

## License

Kova is free and open source software, released under the **GNU General Public License v3.0**.

You are free to use, study, modify, and distribute this software under the terms of the GPL v3. Any modified versions distributed to others must also be made available under the GPL v3.

See [LICENSE](LICENSE) for the full license text.
