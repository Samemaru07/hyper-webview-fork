#!/usr/bin/env bash
# Hyper-webviewをアプリランチャーに登録するセットアップスクリプト。
# リポジトリをクローンした直後、以下を実行するだけで登録できる:
#   ./build/linux/install-desktop-entry.sh
#
# 事前に `pnpm run build && npx electron-builder --linux dir` で
# dist/linux-unpacked/hyper が生成されている必要がある。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE="${SCRIPT_DIR}/hyper-webview.desktop.template"
TARGET_DIR="${HOME}/.local/share/applications"
TARGET_FILE="${TARGET_DIR}/hyper-webview.desktop"

if [ ! -f "${REPO_ROOT}/dist/linux-unpacked/hyper" ]; then
  echo "エラー: ${REPO_ROOT}/dist/linux-unpacked/hyper が見つかりません。" >&2
  echo "先に以下を実行してください:" >&2
  echo "  pnpm run build && npx electron-builder --linux dir" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"
sed "s|__REPO_ROOT__|${REPO_ROOT}|g" "${TEMPLATE}" > "${TARGET_FILE}"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${TARGET_DIR}" || true

echo "登録しました: ${TARGET_FILE}"
echo "Exec=${REPO_ROOT}/dist/linux-unpacked/hyper"
