#!/bin/sh
# usage: tools/qa/run.sh <phase.mjs | /abs/path.mjs> [url-query]   (dev server on :5399)
cd "$(dirname "$0")/../.." || exit 1
q="${2:-}"
f="$1"; case "$f" in /*) ;; *) f="tools/qa/$f";; esac
node tools/browse.mjs "http://localhost:5399/${q}" "$f" --size 640x480 --out /tmp/pd-qa 2>&1 | grep -v "GL Driver"
