![hyper-logo](https://assets.vercel.com/image/upload/v1549723846/repositories/hyper/hyper-3-repo-banner.png)

###### 🇯🇵 [日本語](./README.JP.md) | 🇺🇸 English

# Hyper Webview Fork

A personal fork based on [vercel/hyper](https://github.com/vercel/hyper) (`canary` branch).
The goal is to restore the webview preview feature that was removed from upstream for security reasons, and to set up a terminal environment suited for daily use.

## Relationship to upstream

-   Forked from: [vercel/hyper](https://github.com/vercel/hyper) (`canary` branch)
-   The webview implementation logic is based on the `built-in-webview` branch of [craftzdog/hyper](https://github.com/craftzdog/hyper).
    -   Reference article: [Getting side-by-side preview in a terminal app Hyper](https://dev.to/craftzdog/getting-side-by-side-preview-in-a-terminal-app-hyper-20ii)

## Features

### Webview preview

Split a pane (`Ctrl + Shift + D`), then click a URL printed in the terminal to display it in a webview in the adjacent pane.

### Custom settings via `hyper.json`

Supports the config file format used by the upstream `canary` generation (distinct from the legacy `.hyper.js` format).

## Tested environments

-   Verified on Arch Linux (Hyprland / Wayland)
-   Also verified on WSL (Ubuntu)

## Setup

```bash
pnpm install
```

### Development

```bash
# Terminal 1
pnpm run dev

# Terminal 2
pnpm run app
```

### Build

```bash
pnpm run build
```

> Runs a production build (includes a full type check via `tsc -b`).

### Producing a built app

```bash
npx electron-builder --linux dir
```

This generates a standalone binary at `dist/linux-unpacked/hyper`, directly under the project directory.

> 🔵 Note\
> Formal packaging (pacman, AppImage, etc.) is currently in progress.

## Usage

-   Split a pane (`Ctrl + Shift + D`), then click a URL printed in the terminal to display it in a webview in the adjacent pane.
-   To zoom the displayed web page in or out, **click on the web page first**, then use `Ctrl + +` / `Ctrl + -`.

## Configuration file

Placed at `~/.config/Hyper/hyper.json`. If the file doesn't exist yet, it's created automatically on first launch (migrated from `~/.hyper.js` if present, otherwise generated from the defaults).

A `schema.json` for editor autocompletion is also placed in the same directory automatically on every launch.

Simply adding a plugin to the `plugins` array does not install it automatically.
Run `Tools` → `Update plugins` (`Ctrl + Shift + U`) from the menu.

For details on each configuration option, refer to upstream's type definitions ([`typings/config.d.ts`](https://github.com/vercel/hyper/blob/canary/typings/config.d.ts)).

## Known limitations & roadmap

-   Investigating an fcitx5-skk issue where vowel-initial input passes through unconverted in romaji.
-   Windows support is planned but not yet started.

## License

[MIT](./LICENSE) (inherited from the upstream vercel/hyper license)
