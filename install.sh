#!/usr/bin/env bash
#
# One-stop installer for claude-sessions.
#
# Run it two ways:
#   - From a clone:   ./install.sh
#   - Piped from URL: curl -fsSL https://<host>/install.sh | bash
#
# Piped (bootstrap) mode clones the repo to a stable directory and builds it
# there; from a clone it builds in place. Either way it then:
#   1. Builds the claude-sessions CLI and links its binary onto your PATH.
#   2. Installs the `claude-session` skill globally for Claude Code.
#   3. Installs the global Claude Code hooks (SessionStart + UserPromptSubmit + Stop).
#
# After this runs you still need a server to talk to and a login:
#   claude-sessions login --server <url>
#   claude-sessions enable .
#
# Usage:
#   ./install.sh [options]
#
# Options:
#   --ref <branch>    Git ref to clone/build in bootstrap mode (default: main)
#   --src <dir>       Where to clone in bootstrap mode (default: ~/.local/share/claude-sessions)
#   --bin-dir <dir>   Where to link the binary (default: ~/.local/bin)
#   --no-build        Skip `bun install` + build (use an existing dist/)
#   --skip-skill      Don't install the skill
#   --skip-hooks      Don't install the Claude Code hooks
#   -h, --help        Show this help and exit
#
# Env overrides (mirror the flags): CLAUDE_SESSIONS_REF, CLAUDE_SESSIONS_SRC,
# CLAUDE_SESSIONS_REPO.

set -euo pipefail

# --- best-effort: directory this script lives in (empty when piped) -----------
SOURCE="${BASH_SOURCE[0]:-}"
while [ -n "$SOURCE" ] && [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
if [ -n "$SOURCE" ]; then
  SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
else
  SCRIPT_DIR=""
fi

# --- defaults / flags ---------------------------------------------------------
BIN_DIR="${HOME}/.local/bin"
DO_BUILD=1
DO_SKILL=1
DO_HOOKS=1
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
REF="${CLAUDE_SESSIONS_REF:-main}"
SRC="${CLAUDE_SESSIONS_SRC:-${HOME}/.local/share/claude-sessions}"
REPO_URL="${CLAUDE_SESSIONS_REPO:-https://github.com/vertexcover-io/claude-sessions.git}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --src) SRC="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --skip-skill) DO_SKILL=0; shift ;;
    --skip-hooks) DO_HOOKS=0; shift ;;
    -h|--help) awk 'NR>1 && /^#/{sub(/^# ?/,"");print;next} NR>1{exit}' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# --- pretty logging -----------------------------------------------------------
if [ -t 1 ]; then BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else BOLD=""; DIM=""; GREEN=""; YELLOW=""; RESET=""; fi
step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%serror:%s %s\n' "$BOLD" "$RESET" "$*" >&2; exit 1; }

# --- mode detection: in-repo vs bootstrap -------------------------------------
# In-repo when the script sits beside the monorepo it builds. Otherwise (piped
# via curl) we clone the repo to $SRC and build from there.
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/packages/cli/package.json" ]; then
  REPO_ROOT="$SCRIPT_DIR"
else
  command -v git >/dev/null 2>&1 || die "git is required to bootstrap. Install git, then re-run."
  command -v bun >/dev/null 2>&1 || die "bun is required to build. Install it: curl -fsSL https://bun.sh/install | bash"
  if [ -d "${SRC}/.git" ]; then
    step "Updating existing clone at ${SRC} (${REF})"
    git -C "$SRC" fetch --depth 1 origin "$REF"
    git -C "$SRC" reset --hard FETCH_HEAD
  else
    step "Cloning ${REPO_URL} (${REF}) into ${SRC}"
    mkdir -p "$(dirname "$SRC")"
    git clone --depth 1 --branch "$REF" "$REPO_URL" "$SRC"
  fi
  REPO_ROOT="$SRC"
  [ -f "${REPO_ROOT}/packages/cli/package.json" ] || die "clone at ${REPO_ROOT} is missing packages/cli — wrong ref?"
fi

CLI_ENTRY="${REPO_ROOT}/packages/cli/dist/main.js"

# --- 1. build + link the CLI --------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  command -v bun >/dev/null 2>&1 || die "bun is required to build. Install it: curl -fsSL https://bun.sh/install | bash"
  step "Installing workspace dependencies (bun install)"
  (cd "$REPO_ROOT" && bun install)
  step "Building the CLI and its workspace dependencies"
  # turbo's ^build makes core + adapter-claude build before the CLI.
  (cd "$REPO_ROOT" && bun x turbo run build --filter=@claude-sessions/cli)
  ok "built ${CLI_ENTRY#"$REPO_ROOT"/}"
else
  step "Skipping build (--no-build)"
fi

[ -f "$CLI_ENTRY" ] || die "CLI not built: $CLI_ENTRY missing. Run without --no-build."
chmod +x "$CLI_ENTRY"

command -v node >/dev/null 2>&1 || warn "node not found on PATH — the binary needs Node 22+ at runtime."

step "Linking the binary into ${BIN_DIR}"
mkdir -p "$BIN_DIR"
ln -sf "$CLI_ENTRY" "${BIN_DIR}/claude-sessions"
ok "${BIN_DIR}/claude-sessions -> ${CLI_ENTRY}"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ok "${BIN_DIR} is on your PATH" ;;
  *) warn "${BIN_DIR} is not on your PATH. Add it:"
     printf '      %sexport PATH="%s:$PATH"%s\n' "$DIM" "$BIN_DIR" "$RESET" ;;
esac

# Use the freshly linked binary for the remaining steps.
CS="${BIN_DIR}/claude-sessions"

# --- 2. install the skill globally --------------------------------------------
if [ "$DO_SKILL" -eq 1 ]; then
  SKILL_SRC="${REPO_ROOT}/skills/claude-session"
  SKILL_DST="${CLAUDE_DIR}/skills/claude-session"
  [ -d "$SKILL_SRC" ] || die "skill source missing: $SKILL_SRC"
  step "Installing the claude-session skill into ${SKILL_DST}"
  mkdir -p "${CLAUDE_DIR}/skills"
  rm -rf "$SKILL_DST"
  cp -R "$SKILL_SRC" "$SKILL_DST"
  ok "skill installed"
else
  step "Skipping skill install (--skip-skill)"
fi

# --- 3. install the global hooks ----------------------------------------------
if [ "$DO_HOOKS" -eq 1 ]; then
  step "Installing the global Claude Code hooks"
  "$CS" install-hooks
else
  step "Skipping hook install (--skip-hooks)"
fi

# --- done ---------------------------------------------------------------------
printf '\n%sclaude-sessions is installed.%s Next steps:\n' "$BOLD" "$RESET"
printf '  1. Point the CLI at a running server and log in:\n'
printf '       %sclaude-sessions login --server <url>%s\n' "$DIM" "$RESET"
printf '  2. Enable capture for a repo (run inside it):\n'
printf '       %sclaude-sessions enable .%s\n' "$DIM" "$RESET"
printf '  3. Check it:\n'
printf '       %sclaude-sessions status%s\n' "$DIM" "$RESET"
printf '\n%sNote:%s the CLI does not run the server. Start one separately\n' "$YELLOW" "$RESET"
printf '       (see README "Quickstart — server") or point --server at a deployment.\n'
printf '%sNote:%s the watcher auto-starts (and revives if it died) whenever Claude\n' "$YELLOW" "$RESET"
printf '       Code launches, via the installed SessionStart hook — no boot step needed.\n'
