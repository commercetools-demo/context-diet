#!/usr/bin/env bash
# Read-only check of what Graphify needs. Installs nothing.
# Prints KEY=value lines: PYTHON, PYTHON_OK, UV, PIPX, BREW, GRAPHIFY, OS.

os="$(uname -s 2>/dev/null || echo unknown)"
echo "OS=$os"

py=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then py="$c"; break; fi
done

if [ -n "$py" ]; then
  ver="$("$py" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null)"
  echo "PYTHON=$ver"
  if "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
    echo "PYTHON_OK=yes"
  else
    echo "PYTHON_OK=no (need 3.10 or newer)"
  fi
else
  echo "PYTHON=missing"
  echo "PYTHON_OK=no"
fi

for t in uv pipx brew graphify; do
  key="$(echo "$t" | tr '[:lower:]' '[:upper:]')"
  if command -v "$t" >/dev/null 2>&1; then
    echo "$key=present"
  else
    echo "$key=missing"
  fi
done
