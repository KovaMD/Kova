# Kova

Kova turns plain Markdown into polished slides — with live preview, multiple layouts, theming, and PPTX, PDF, and HTML export — all in a native desktop app.

[![Latest release](https://img.shields.io/github/v/release/KovaMD/Kova?label=release&color=orange)](https://github.com/KovaMD/Kova/releases/latest)
[![Service status](https://status.kova.md/api/badge/1/status?style=flat&label=services)](https://status.kova.md/status/infra)
[![Matrix](https://img.shields.io/matrix/kova-md%3Amatrix.org?server_fqdn=matrix.org&label=matrix&color=blue)](https://matrix.to/#/#kova-md:matrix.org)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/screenshot-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/readme/screenshot-light.png" />
    <img src="docs/readme/screenshot-light.png" alt="Kova editor" width="80%" />
  </picture>
</p>

## Features

- **Markdown-first** — write slides in plain text, separated by `---`
- **Live preview** — editor and preview stay in sync as you type
- **Auto layout** — title, section, split, two-column, grid, quote, full-bleed, and more
- **Themes** — 11 built-in themes, community themes, and custom YAML
- **Math, code & diagrams** — KaTeX math, highlight.js syntax highlighting, and Mermaid charts
- **Rich media** — images, local video, YouTube embeds, and QR codes
- **Fullscreen presentation** — speaker notes, slide counter, keyboard and click navigation
- **Build-reveal animations** — mark a bullet, image, or other element with `<!-- step -->` to reveal it on its own click, in presentation, the interactive HTML export, and native PowerPoint builds
- **Export** — PowerPoint (16:9 and 4:3, including build animations), PDF (with speaker notes), and standalone HTML
- **Computed tables** — annotate a table with `!sheet` and write formulas in the cells (`=qty * unit`, `=sum(total)`); Kova computes them, the source keeps only the formulas. See [`examples/sheet-basics.md`](examples/sheet-basics.md)

## Download

| Platform | Download |
|---|---|
| **macOS** (Apple Silicon + Intel) | [**Download .dmg**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_macOS.dmg) |
| **Windows 10/11** | [**Download .msi**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows.msi) (installs for all users) · [Setup .exe](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Windows_setup.exe) (installs for just you) |
| **Linux** | [See install options ↓](#linux) |

Both Windows installers let you skip adding Kova to PATH so `kova` works from a terminal. The `.exe` (per-user) always uses your own user PATH; the `.msi` (all users) lets you pick system PATH, your user PATH only, or neither.

## Linux

Debian/Ubuntu and Fedora/RHEL/openSUSE users should install from the repo below — it keeps Kova updated automatically. Arch, Nix, and Flatpak have native options too, or grab the self-updating AppImage if you'd rather not add a repo.

<details>
<summary><strong>Debian / Ubuntu</strong> (recommended)</summary>

```bash
sudo curl -fsSL https://deb.kova.md/key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kova.gpg
echo "deb [signed-by=/etc/apt/keyrings/kova.gpg] https://deb.kova.md stable main" \
  | sudo tee /etc/apt/sources.list.d/kova.list
sudo apt update && sudo apt install kova
```

Debian 13+ — use the [DEB822 source format](https://wiki.kova.md/install/linux/).

</details>

<details>
<summary><strong>Fedora / RHEL / openSUSE</strong> (recommended)</summary>

```bash
sudo rpm --import https://rpm.kova.md/key.gpg
sudo curl -o /etc/yum.repos.d/kova.repo \
  https://rpm.kova.md/kova.repo
sudo dnf install kova   # openSUSE: zypper install kova
```

</details>

<details>
<summary><strong>Nix (flakes)</strong></summary>

```bash
nix run github:KovaMD/Kova          # run without installing
nix profile install github:KovaMD/Kova   # install into your profile
```

Or add `github:KovaMD/Kova` as a flake input and use `packages.<system>.default`.

</details>

<details>
<summary><strong>Arch (AUR)</strong></summary>

```bash
yay -S kova-bin   # or: paru -S kova-bin
```

</details>

<details>
<summary><strong>Flatpak</strong></summary>

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

</details>

<details>
<summary><strong>AppImage</strong></summary>

Bundled graphics libs are stripped for compatibility with Arch/Fedora/etc., and the AppImage is signed so in-app auto-update works. See [issue #3](https://github.com/KovaMD/Kova/issues/3) for background.

```bash
chmod +x Kova_Linux.AppImage
./Kova_Linux.AppImage
```

[**Download .AppImage**](https://github.com/KovaMD/Kova/releases/latest/download/Kova_Linux.AppImage)

</details>

Prefer a plain package file over adding a repo? Raw `.deb` and `.rpm` builds are attached to every [release](https://github.com/KovaMD/Kova/releases/latest) — just note that manual installs like these won't get automatic updates.

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

See the [Contributing guide](https://wiki.kova.md/contributing/) for more details, or [TRANSLATING.md](.github/TRANSLATING.md) if you'd like to add a language.

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

## Support

Kova is free and community funded. If you'd like to support development, you can donate via [Open Collective](https://opencollective.com/kovamd).

## License

Kova is free and open source software, released under the **GNU General Public License v3.0**.

You are free to use, study, modify, and distribute this software under the terms of the GPL v3. Any modified versions distributed to others must also be made available under the GPL v3.

See [LICENSE](LICENSE) for the full license text.

Windows builds are code signed for free courtesy of [SignPath.io](https://signpath.io), using a free code signing certificate from the [SignPath Foundation](https://signpath.org).
