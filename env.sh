#!/usr/bin/env sh

OPEN_GALLERY_ROOT="$(git rev-parse --show-toplevel)"
export TIZEN_STUDIO="$OPEN_GALLERY_ROOT/.tools/tizen-studio"
export JAVA_HOME="$TIZEN_STUDIO/jdk"
export PATH="$TIZEN_STUDIO/tools/ide/bin:$TIZEN_STUDIO/tools:$PATH"
unset OPEN_GALLERY_ROOT
