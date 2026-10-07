#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 CERTIFICATE_PROFILE" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$ROOT/dist/tizen"
PROFILE="$1"

source "$ROOT/env.sh"

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp "$ROOT/config.xml" "$STAGE/"
cp "$ROOT/icon.png" "$STAGE/"
cp "$ROOT/index.html" "$STAGE/"
cp "$ROOT/styles.css" "$STAGE/"
cp -R "$ROOT/assets" "$STAGE/"
cp -R "$ROOT/src" "$STAGE/"

tizen build-web -- "$STAGE"
tizen package -t wgt -s "$PROFILE" -- "$STAGE/.buildResult"

PACKAGE="$(find "$STAGE/.buildResult" -maxdepth 1 -name '*.wgt' -print -quit)"
SAFE_PACKAGE="$STAGE/.buildResult/MyTVArt.wgt"
if [[ "$PACKAGE" != "$SAFE_PACKAGE" ]]; then
  mv "$PACKAGE" "$SAFE_PACKAGE"
fi

echo
echo "Package created:"
echo "$SAFE_PACKAGE"
