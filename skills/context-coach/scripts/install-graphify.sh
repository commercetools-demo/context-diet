#!/usr/bin/env bash
# Installs whatever Graphify is missing: Python 3.10+, uv, graphify itself, then registers the skill.
# macOS and Linux only. Windows: see the note printed at the end of the SKILL.
#
# Usage:
#   bash install-graphify.sh          # dry run: prints the plan, changes nothing
#   bash install-graphify.sh --yes    # actually install
#
# Never uses sudo. If something needs it, the script prints the command for you to run.

set -u
YES=0
[ "${1:-}" = "--yes" ] && YES=1

run() {
  if [ "$YES" -eq 1 ]; then
    echo "+ $*"
    eval "$*"
  else
    echo "[dry run] would run: $*"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

py_ok() {
  for c in python3 python; do
    if have "$c" && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "Windows detected. Run in PowerShell instead:"
    echo "  winget install Python.Python.3.12"
    echo "  winget install astral-sh.uv"
    echo "  uv tool install graphifyy"
    echo "  graphify install"
    exit 0 ;;
esac

# 1. Python 3.10+
if py_ok; then
  echo "Python OK"
else
  echo "Python 3.10+ missing"
  if have brew; then
    run "brew install python@3.12"
  else
    echo "Cannot install Python automatically without Homebrew or sudo."
    echo "  macOS: install Homebrew (https://brew.sh) or Python from https://www.python.org/downloads/"
    echo "  Debian/Ubuntu: sudo apt install python3.12 python3-pip pipx"
    echo "Re-run this script afterwards."
    exit 1
  fi
fi

# 2. uv (or pipx already present)
if have uv; then
  echo "uv OK"
  INSTALLER="uv tool install graphifyy"
elif have pipx; then
  echo "pipx OK (using it instead of uv)"
  INSTALLER="pipx install graphifyy"
else
  echo "uv missing"
  if have brew; then
    run "brew install uv"
  else
    echo "Using the official uv installer from astral.sh (downloads and runs a script)."
    run "curl -LsSf https://astral.sh/uv/install.sh | sh"
    # make uv visible in this shell
    [ "$YES" -eq 1 ] && export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  fi
  INSTALLER="uv tool install graphifyy"
fi

# 3. graphify itself
if have graphify; then
  echo "graphify already installed"
else
  run "$INSTALLER"
  [ "$YES" -eq 1 ] && export PATH="$HOME/.local/bin:$PATH"
fi

# 4. register the skill with Claude Code
if [ "$YES" -eq 1 ]; then
  if have graphify; then
    run "graphify install"
  else
    echo "graphify not found on PATH after install."
    echo "Run: uv tool update-shell   then open a new terminal and run: graphify install"
    exit 1
  fi
else
  echo "[dry run] would run: graphify install"
  echo
  echo "Dry run only. Re-run with --yes to install."
  exit 0
fi

echo
echo "Done. Restart Claude Code, open your project folder, and type: /graphify ."
