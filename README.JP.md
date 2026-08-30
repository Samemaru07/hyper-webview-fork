![hyper-logo](https://assets.vercel.com/image/upload/v1549723846/repositories/hyper/hyper-3-repo-banner.png)

###### 🇯🇵 日本語 | 🇺🇸 [English](./README.md)

# Hyper Webview Fork

[vercel/hyper](https://github.com/vercel/hyper) (canaryブランチ) をベースにした個人用フォークです。
セキュリティ上の理由で本家から削除されたwebviewプレビュー機能の復元と、日常使いに適したターミナル環境の整備を目的としています。

## upstreamとの関係

-   フォーク元: [vercel/hyper](https://github.com/vercel/hyper) (canaryブランチ)
-   webview機能の実装ロジックは[craftzdog/hyper](https://github.com/craftzdog/hyper)のbuilt-in-webviewブランチを参考にしています。
    -   参考記事: [Getting side-by-side preview in a terminal app Hyper](https://dev.to/craftzdog/getting-side-by-side-preview-in-a-terminal-app-hyper-20ii)

## 主な機能

### webviewプレビュー

ペインを分割し (`Ctrl + Shift + D`) 、ターミナルに出力されたurlをクリックすると、隣のペインにwebviewで表示

### `hyper.json` によるカスタム設定

本家canary世代の設定ファイル形式に対応 (旧世代の`.hyper.js`とは別物)

### 独自SKK入力エンジン

システムのIME(fcitx5等)を一切介さず、ゼロから実装した独自のSKK(Simple Kana to Kanji conversion)エンジン。
かな入力、漢字変換(辞書引き・候補選択)、カタカナ変換、送り仮名、候補の履歴(そのキーで最後に確定した候補を次回優先表示する、本家SKKの仕様通りの挙動)に対応。

## 動作環境

-   Arch Linux (hyprland / wayland) で動作確認済み
-   WSL (Ubuntu) でも動作確認

## セットアップ

```bash
pnpm install
```

### 開発時

```bash
# ターミナル1
pnpm run dev

# ターミナル2
pnpm run app
```

### ビルド

```bash
pnpm run build
```

> 本番ビルド (`tsc -b` によるフル型チェックを含む) を実行します。

### ビルド済みアプリの生成

```bash
npx electron-builder --linux dir
```

プロジェクトディレクトリ直下 `dist/linux-unpacked/hyper` に単体で起動可能なバイナリが生成されます。

> 🔵 Note\
> pacman・appimage等の正式なパッケージ化は現在準備中です。

#### Linux: アプリランチャーへの登録

`pnpm run dev` / `pnpm run app` を毎回実行しなくても、通常のアプリと同じようにランチャーから起動できるようにする手順です。

```bash
./build/linux/install-desktop-entry.sh
```

`~/.local/share/applications/hyper-webview.desktop` が生成され、rofi/wofi等のランチャーから「Hyper-webview」として起動できるようになります。
リポジトリをどこにクローンしても、スクリプトが実際のパスを自動検出して登録するため、パスの手動書き換えは不要です。

> 🔵 Note\
> `npx electron-builder --linux dir` で `dist/linux-unpacked/hyper` が生成された後に実行してください。ソースコードに変更を加えた場合は `pnpm run build` と `npx electron-builder --linux dir` を再実行すればバイナリに反映されます(上記の登録手順自体は初回のみで問題ありません)。

## 使い方

-   ペインを分割し (`Ctrl + Shift + D`) 、ターミナルに出力されたurlをクリックすると、隣のペインにwebviewで表示されます。
-   表示されたWebページを拡大・縮小するには、**Webページをクリックしてから** `Ctrl + +` / `Ctrl + -` で行ってください。

## 設定ファイル

`~/.config/Hyper/hyper.json` に配置されます。ファイルが存在しない場合、初回起動時に自動生成されます(`~/.hyper.js` があれば内容を引き継ぎ、無ければデフォルト設定から生成)。

エディタ補完用の `schema.json` も、起動のたびに同ディレクトリへ自動配置されます。

プラグインを `plugins` に追記しただけでは自動インストールされません。
メニューの `Tools`→`Update plugins` (`Ctrl + Shift + U`) を実行してください。

各設定項目の詳細は、フォーク元の型定義([`typings/config.d.ts`](https://github.com/vercel/hyper/blob/canary/typings/config.d.ts))を参照してください。

## 既知の制限・今後の予定

-   Windows対応は対応予定 (現時点では未着手)
-   タブリネーム機能は対応予定 (現時点では未実装)
-   背景画像の指定機能は対応予定 (現時点では未実装)

## ライセンス

[MIT](./LICENSE) (本家 vercel/hyper のライセンスを継承)
