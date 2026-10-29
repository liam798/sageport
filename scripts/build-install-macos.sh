#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Sageport.app"
APPLICATIONS_DIR="${SAGEPORT_APPLICATIONS_DIR:-/Applications}"
TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/Library/Caches/sageport/cargo-target}"
DEST_APP="$APPLICATIONS_DIR/$APP_NAME"
STAGING_APP="$APPLICATIONS_DIR/.$APP_NAME.staging.$$"
BACKUP_APP="$APPLICATIONS_DIR/.$APP_NAME.backup.$$"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此脚本仅支持 macOS" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "未找到 pnpm，请先安装 Node.js 与 pnpm" >&2
  exit 1
fi

if ! mkdir -p "$APPLICATIONS_DIR" 2>/dev/null || [[ ! -w "$APPLICATIONS_DIR" ]]; then
  echo "没有写入权限：$APPLICATIONS_DIR" >&2
  exit 1
fi

if [[ "$TARGET_DIR" != /* ]]; then
  TARGET_DIR="$PROJECT_ROOT/$TARGET_DIR"
fi

export CARGO_TARGET_DIR="$TARGET_DIR"

cd "$PROJECT_ROOT"

if [[ ! -d node_modules ]]; then
  pnpm install --frozen-lockfile
fi

pnpm tauri build \
  --bundles app \
  --no-sign \
  --ignore-version-mismatches \
  --ci

BUILT_APP="$TARGET_DIR/release/bundle/macos/$APP_NAME"

if [[ ! -d "$BUILT_APP" ]]; then
  echo "构建完成，但未找到应用包：$BUILT_APP" >&2
  exit 1
fi

rm -rf "$STAGING_APP" "$BACKUP_APP"

restore_previous_app() {
  status=$?
  if [[ $status -ne 0 && -d "$BACKUP_APP" ]]; then
    rm -rf "$DEST_APP"
    mv "$BACKUP_APP" "$DEST_APP"
  fi
  rm -rf "$STAGING_APP" "$BACKUP_APP"
  exit "$status"
}

trap restore_previous_app EXIT

ditto "$BUILT_APP" "$STAGING_APP"
codesign --force --deep --sign - "$STAGING_APP"
codesign --verify --deep --strict "$STAGING_APP"

if [[ -e "$DEST_APP" ]]; then
  mv "$DEST_APP" "$BACKUP_APP"
fi

mv "$STAGING_APP" "$DEST_APP"
rm -rf "$BACKUP_APP"
trap - EXIT

echo "已安装到：$DEST_APP"

if [[ "${SAGEPORT_SKIP_OPEN:-0}" != "1" ]]; then
  pkill -x Sageport >/dev/null 2>&1 || true
  sleep 1
  open "$DEST_APP"
  echo "已启动 Sageport"
fi
