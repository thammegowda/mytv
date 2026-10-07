#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT/.tools"
SDK_DIR="$TOOLS_DIR/tizen-studio"
INSTALLER="$TOOLS_DIR/web-cli_Tizen_Studio_6.1_macos-64.bin"
INSTALLER_URL="https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_macos-64.bin"
PACKAGE_MANAGER="$SDK_DIR/package-manager/package-manager-cli.bin"
TV_PACKAGES="TV-SAMSUNG-Public,TV-SAMSUNG-Public-WebAppDevelopment,TV-SAMSUNG-Extension-Tools,TV-SAMSUNG-Extension-Resources"

mkdir -p "$TOOLS_DIR"

if ! arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
  echo "Installing Apple's Rosetta 2 prerequisite..."
  /usr/sbin/softwareupdate --install-rosetta --agree-to-license
fi

if [[ ! -x "$SDK_DIR/tools/ide/bin/tizen" ]]; then
  echo "Downloading Tizen Studio Web CLI 6.1..."
  curl \
    --fail \
    --location \
    --continue-at - \
    --retry 8 \
    --retry-all-errors \
    --output "$INSTALLER" \
    "$INSTALLER_URL"
  chmod +x "$INSTALLER"

  echo "Installing Tizen Studio into $SDK_DIR..."
  "$INSTALLER" --accept-license "$SDK_DIR"
  rm -f "$INSTALLER"
else
  echo "Tizen Studio is already installed at $SDK_DIR"
fi

if [[ ! -d "$HOME/.package-manager/jdk" ]]; then
  mkdir -p "$HOME/.package-manager"
  cp -a "$SDK_DIR/jdk" "$HOME/.package-manager/jdk"
fi

echo "Installing Samsung TV extension packages..."
"$PACKAGE_MANAGER" install --accept-license "$TV_PACKAGES"

source "$ROOT/env.sh"

echo
echo "Tizen CLI:"
tizen version
echo
echo "SDB:"
sdb version
echo
echo "Samsung TV SDK installation complete."
echo "Run 'source env.sh' from the repository before using the CLI."
