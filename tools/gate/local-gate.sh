#!/usr/bin/env bash
# Mechanical eligibility gate for a scaffold-hbar template, run on a FRESH
# scaffold pulled from GitHub the way a judge would: create-scaffold-hbar
# downloads the repository, then install, lint, build and boot run with no .env.
#
# Usage:
#   tools/gate/local-gate.sh <owner/repo[#ref]> [yarn|npm] [--strict]
#
#   --strict   also fail when G6 (testnet transaction link in README) is missing.
#              Without it G6 is reported as PENDING while the template is being built.
#
# Environment:
#   GATE_CLI_VERSION  create-scaffold-hbar version to run (default 0.4.0)
#   GATE_ROUTES       space-separated routes to probe (default: paths in
#                     .harness/validators/playwright-smoke.yaml, else "/")
#   GATE_KEEP=1       keep the work directory (scaffold + logs) after the run
#
# Requires: node, git, curl, tar; yarn for the yarn leg; gh for private repos.
# Run install in the repository that holds this script first (the manifest
# validator imports zod from it).
#
# Exit code: 0 when every item passes, 1 otherwise.

set -uo pipefail

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

[[ $# -ge 1 ]] || usage
TEMPLATE_REF="$1"
PM="${2:-yarn}"
STRICT=0
[[ "${3:-}" == "--strict" || "${2:-}" == "--strict" ]] && STRICT=1
[[ "$PM" == "--strict" ]] && PM=yarn
[[ "$PM" == "yarn" || "$PM" == "npm" ]] || { echo "package manager must be yarn or npm, got: $PM" >&2; exit 2; }
[[ "$TEMPLATE_REF" =~ ^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(#(.+))?$ ]] || { echo "template must be owner/repo[#ref]" >&2; exit 2; }
OWNER="${BASH_REMATCH[1]}"
REPO="${BASH_REMATCH[2]}"
REF="${BASH_REMATCH[4]:-main}"

CLI_VERSION="${GATE_CLI_VERSION:-0.4.0}"
GATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/scaffold-gate.XXXXXX")"
LOGS="$WORK/logs"
APP="$WORK/app"
SRC="$WORK/src"
mkdir -p "$LOGS"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null; fi
  if [[ "${GATE_KEEP:-0}" == "1" ]]; then echo "work directory kept: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

# Commands run with a minimal environment so nothing from this shell (tokens,
# NEXT_PUBLIC_* values, npm_config_*) can make a broken template look healthy.
CLEAN_ENV=(env -i "PATH=$PATH" "HOME=$HOME" "TMPDIR=${TMPDIR:-/tmp}" "LANG=${LANG:-en_US.UTF-8}")
[[ -n "${COREPACK_HOME:-}" ]] && CLEAN_ENV+=("COREPACK_HOME=$COREPACK_HOME")
if [[ -z "$(git config user.name 2>/dev/null)" || -z "$(git config user.email 2>/dev/null)" ]]; then
  # create-scaffold-hbar refuses to run without a git identity; supply one for this run only.
  CLEAN_ENV+=("GIT_CONFIG_COUNT=2" "GIT_CONFIG_KEY_0=user.name" "GIT_CONFIG_VALUE_0=scaffold gate"
    "GIT_CONFIG_KEY_1=user.email" "GIT_CONFIG_VALUE_1=gate@localhost")
fi

IDS=(); NAMES=(); STATUSES=(); TIMES=(); NOTES=()
record() { IDS+=("$1"); NAMES+=("$2"); STATUSES+=("$3"); TIMES+=("$4"); NOTES+=("${5:-}"); }

# run_step <log-name> <command...>: runs in $APP with the clean env, returns exit code, sets STEP_SECONDS.
run_step() {
  local log="$LOGS/$1.log"; shift
  local started=$SECONDS
  (cd "$APP" && "${CLEAN_ENV[@]}" "$@") >"$log" 2>&1
  local code=$?
  STEP_SECONDS=$((SECONDS - started))
  if [[ $code -ne 0 ]]; then
    echo "---- $(basename "$log") (exit $code), last 30 lines ----" >&2
    tail -n 30 "$log" >&2
  fi
  return $code
}

if [[ "$PM" == "yarn" ]]; then
  pm_run() { run_step "$1" yarn "${@:2}"; }
  RUN_SEP=()
else
  pm_run() { run_step "$1" npm run "${@:2}"; }
  RUN_SEP=(--)
fi

echo "gate: $OWNER/$REPO#$REF · package manager $PM · create-scaffold-hbar@$CLI_VERSION · node $(node -v) · npm $(npm -v)"

# ---- source: clone the repository as GitHub serves it --------------------------------------------
t0=$SECONDS
PRIVATE=false
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  PRIVATE="$(gh api "repos/$OWNER/$REPO" --jq .private 2>/dev/null || echo unknown)"
  gh repo clone "$OWNER/$REPO" "$WORK/src.git" -- --bare --quiet >"$LOGS/clone.log" 2>&1
else
  git clone --bare --quiet "https://github.com/$OWNER/$REPO.git" "$WORK/src.git" >"$LOGS/clone.log" 2>&1
fi
if ! SHA="$(git -C "$WORK/src.git" rev-parse --verify --quiet "$REF^{commit}")"; then
  cat "$LOGS/clone.log" >&2
  echo "cannot resolve $OWNER/$REPO#$REF — nothing to gate" >&2
  exit 1
fi
DEFAULT_BRANCH="$(git -C "$WORK/src.git" symbolic-ref --short HEAD 2>/dev/null)"
mkdir -p "$SRC" && git -C "$WORK/src.git" archive "$SHA" | tar -x -C "$SRC"
echo "source: $SHA (default branch: $DEFAULT_BRANCH, private: $PRIVATE) in $((SECONDS - t0))s"

# ---- G2: template.json valid for the CLI, and served from the branch the CLI reads ----------------
t0=$SECONDS
G2_NOTE=""
if node "$GATE_DIR/validate-template-json.mjs" "$SRC/template.json" >"$LOGS/manifest.log" 2>&1; then
  G2_STATUS=PASS
else
  G2_STATUS=FAIL; G2_NOTE="$(tail -n 3 "$LOGS/manifest.log" | tr '\n' ' ')"
fi
if [[ "$DEFAULT_BRANCH" != "main" ]]; then
  G2_STATUS=FAIL; G2_NOTE="$G2_NOTE default branch is '$DEFAULT_BRANCH': the CLI reads template.json from main"
fi
G2_SECONDS=$((SECONDS - t0))
DEFAULT_FW="$(node -e 'try{const m=require(process.argv[1]);console.log(m["create-scaffold-hbar"]?.defaults?.solidityFramework??"")}catch{console.log("")}' "$SRC/template.json")"

# ---- G1: scaffold -----------------------------------------------------------------------------------
SCAFFOLD_ARGS=(app --template "$TEMPLATE_REF" --ci --skip-hedera-skills --package-manager "$PM")
SCAFFOLD_ENV=()
if [[ "$PRIVATE" != "false" ]]; then
  # The CLI fetches template.json anonymously, so a private repository falls back to CLI
  # defaults (Foundry). Pass the manifest's framework and a download token instead; the
  # "manifest applied" check below is skipped because it cannot be observed here.
  [[ -n "$DEFAULT_FW" ]] && SCAFFOLD_ARGS+=(-s "$DEFAULT_FW")
  SCAFFOLD_ENV+=("GIGET_AUTH=$(gh auth token 2>/dev/null)")
fi
started=$SECONDS
(cd "$WORK" && "${CLEAN_ENV[@]}" ${SCAFFOLD_ENV[@]+"${SCAFFOLD_ENV[@]}"} npx -y "create-scaffold-hbar@$CLI_VERSION" "${SCAFFOLD_ARGS[@]}") >"$LOGS/scaffold.log" 2>&1
code=$?
G1_SECONDS=$((SECONDS - started))
if [[ $code -eq 0 && -f "$APP/package.json" ]]; then
  record G1 "scaffold: npx create-scaffold-hbar@$CLI_VERSION --template $TEMPLATE_REF" PASS "$G1_SECONDS" "includes the CLI's own install and format"
  SCAFFOLD_OK=1
else
  echo "---- scaffold.log (exit $code), last 30 lines ----" >&2; tail -n 30 "$LOGS/scaffold.log" >&2
  record G1 "scaffold: npx create-scaffold-hbar@$CLI_VERSION --template $TEMPLATE_REF" FAIL "$G1_SECONDS" "exit $code"
  SCAFFOLD_OK=0
fi

# Must-differ control for G2: without -s the CLI picks the framework from our manifest;
# if it could not read the manifest it would fall back to Foundry.
if [[ $SCAFFOLD_OK -eq 1 && "$PRIVATE" == "false" && -n "$DEFAULT_FW" ]]; then
  if [[ -d "$APP/packages/$DEFAULT_FW" ]]; then
    G2_NOTE="$G2_NOTE manifest applied by the CLI (packages/$DEFAULT_FW present)"
  else
    G2_STATUS=FAIL; G2_NOTE="$G2_NOTE CLI ignored the manifest: packages/$DEFAULT_FW missing"
  fi
elif [[ "$PRIVATE" != "false" ]]; then
  G2_NOTE="$G2_NOTE manifest-applied check skipped (private repo: CLI reads template.json anonymously)"
fi
record G2 "template.json valid (CLI 0.4.0 schema) on branch main" "$G2_STATUS" "$G2_SECONDS" "$G2_NOTE"

if [[ $SCAFFOLD_OK -eq 1 ]]; then
  # ---- G3 -------------------------------------------------------------------------------------------
  missing=""
  for f in README.md AGENTS.md; do [[ -s "$APP/$f" ]] || missing="$missing $f"; done
  if [[ -z "$missing" ]]; then record G3 "README.md and AGENTS.md present" PASS 0
  else record G3 "README.md and AGENTS.md present" FAIL 0 "missing or empty:$missing"; fi

  # ---- G4: install, lint, build ---------------------------------------------------------------------
  if [[ "$PM" == "yarn" ]]; then run_step install yarn install --immutable
  else run_step install npm install --legacy-peer-deps; fi
  code=$?
  record G4 "install (${PM}$([[ $PM == yarn ]] && echo ' --immutable'))" "$([[ $code -eq 0 ]] && echo PASS || echo FAIL)" "$STEP_SECONDS"

  lint_seconds=0; lint_failed=""
  for script in next:lint hardhat:lint; do
    pm_run "lint-${script%%:*}" "$script" ${RUN_SEP[@]+"${RUN_SEP[@]}"} --max-warnings=0 || lint_failed="$lint_failed $script"
    lint_seconds=$((lint_seconds + STEP_SECONDS))
  done
  pm_run check-types next:check-types || lint_failed="$lint_failed next:check-types"
  lint_seconds=$((lint_seconds + STEP_SECONDS))
  if [[ -z "$lint_failed" ]]; then record G4 "lint (--max-warnings=0) + next:check-types" PASS "$lint_seconds"
  else record G4 "lint (--max-warnings=0) + next:check-types" FAIL "$lint_seconds" "failed:$lint_failed"; fi

  build_seconds=0; build_failed=""
  for script in hardhat:compile next:build; do
    pm_run "build-${script%%:*}" "$script" || build_failed="$build_failed $script"
    build_seconds=$((build_seconds + STEP_SECONDS))
  done
  if [[ -z "$build_failed" ]]; then record G4 "build (hardhat:compile + next:build)" PASS "$build_seconds"
  else record G4 "build (hardhat:compile + next:build)" FAIL "$build_seconds" "failed:$build_failed"; fi

  # ---- G5: boot without .env and probe core routes --------------------------------------------------
  started=$SECONDS
  ROUTES=()
  if [[ -n "${GATE_ROUTES:-}" ]]; then
    read -r -a ROUTES <<<"$GATE_ROUTES"
  elif [[ -f "$APP/.harness/validators/playwright-smoke.yaml" ]]; then
    read -r -a ROUTES <<<"$(sed -nE 's/^[[:space:]-]*path:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/p' "$APP/.harness/validators/playwright-smoke.yaml" | tr '\n' ' ')"
  fi
  [[ ${#ROUTES[@]} -gt 0 ]] || ROUTES=(/)
  env_files="$(cd "$APP" && find . -path ./node_modules -prune -o -name '.env*' ! -name '.env.example' -print | grep -v node_modules || true)"
  PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
  if [[ "$build_failed" != "" ]]; then
    record G5 "boot (next start, no .env) + routes: ${ROUTES[*]}" BLOCKED 0 "build failed"
  elif [[ -n "$env_files" ]]; then
    record G5 "boot (next start, no .env) + routes: ${ROUTES[*]}" FAIL 0 "scaffold contains env files: $env_files"
  else
    set -m # own process group, so the server and its children are stopped together
    (cd "$APP" && exec "${CLEAN_ENV[@]}" "$PM" run next:serve ${RUN_SEP[@]+"${RUN_SEP[@]}"} -p "$PORT") >"$LOGS/serve.log" 2>&1 &
    SERVER_PID=$!
    set +m
    ready=0
    for _ in $(seq 1 90); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      if [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" != "000" ]]; then ready=1; break; fi
      sleep 1
    done
    bad=""
    if [[ $ready -eq 1 ]]; then
      for route in "${ROUTES[@]}"; do
        status="$(curl -s -o "$LOGS/route.html" -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT$route")"
        if [[ "$status" != "200" ]]; then bad="$bad $route=$status"
        elif grep -q "Application error" "$LOGS/route.html"; then bad="$bad $route=application-error"; fi
      done
    else
      bad=" server did not answer within 90s"; tail -n 30 "$LOGS/serve.log" >&2
    fi
    kill -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
    if [[ -z "$bad" ]]; then record G5 "boot (next start, no .env) + routes: ${ROUTES[*]}" PASS $((SECONDS - started)) "HTTP 200, no 'Application error' in server HTML"
    else record G5 "boot (next start, no .env) + routes: ${ROUTES[*]}" FAIL $((SECONDS - started)) "$bad"; fi
  fi

  # ---- G6: verifiable testnet transaction link --------------------------------------------------------
  if grep -Eq 'hashscan\.io/testnet/(transaction|tx)/|testnet\.mirrornode\.hedera\.com/api/v1/transactions/' "$APP/README.md" 2>/dev/null; then
    record G6 "testnet transaction link (Hashscan or mirror node) in README" PASS 0
  elif [[ $STRICT -eq 1 ]]; then
    record G6 "testnet transaction link (Hashscan or mirror node) in README" FAIL 0 "no link yet"
  else
    record G6 "testnet transaction link (Hashscan or mirror node) in README" PENDING 0 "no link yet; use --strict before submitting"
  fi
else
  for id in G3 G4 G5 G6; do record "$id" "(not run)" BLOCKED 0 "scaffold failed"; done
fi

# ---- G7: secrets and .env: scaffold tree + full history of the template repository -----------------
started=$SECONDS
g7_note=""
TREE_DIR="$APP"; [[ $SCAFFOLD_OK -eq 1 ]] || TREE_DIR="$SRC"
if node "$GATE_DIR/scan-secrets.mjs" --tree "$TREE_DIR" --history "$WORK/src.git" >"$LOGS/secrets.log" 2>&1; then
  G7_STATUS=PASS
else
  G7_STATUS=FAIL
fi
g7_note="$(head -n 1 "$LOGS/secrets.log")"
[[ $G7_STATUS == FAIL ]] && cat "$LOGS/secrets.log" >&2
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks git --no-banner --redact --log-opts=--all "$WORK/src.git" >"$LOGS/gitleaks.log" 2>&1; then
    g7_note="$g7_note; gitleaks $(gitleaks version): no leaks in history"
  else
    G7_STATUS=FAIL; g7_note="$g7_note; gitleaks reported leaks"; cat "$LOGS/gitleaks.log" >&2
  fi
else
  g7_note="$g7_note; gitleaks not installed (regex scan only)"
fi
record G7 "no committed secrets, no committed .env" "$G7_STATUS" $((SECONDS - started)) "$g7_note"

# ---- G8: MIT licence ---------------------------------------------------------------------------------
started=$SECONDS
g8_note=""
if [[ -f "$SRC/LICENSE" ]] && head -n 3 "$SRC/LICENSE" | grep -q "^MIT License" &&
  grep -q "Permission is hereby granted, free of charge" "$SRC/LICENSE"; then
  G8_STATUS=PASS
else
  G8_STATUS=FAIL; g8_note="LICENSE missing or not the MIT text"
fi
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  spdx="$(gh api "repos/$OWNER/$REPO/license" --jq .license.spdx_id 2>/dev/null || echo none)"
  g8_note="$g8_note GitHub detects: $spdx"
  [[ "$spdx" == "MIT" ]] || G8_STATUS=FAIL
fi
record G8 "MIT licence" "$G8_STATUS" $((SECONDS - started)) "$g8_note"

# ---- report --------------------------------------------------------------------------------------------
echo
echo "| Gate | Check | Result | Time | Note |"
echo "|---|---|---|---|---|"
failed=0
for i in "${!IDS[@]}"; do
  echo "| ${IDS[$i]} | ${NAMES[$i]} | ${STATUSES[$i]} | ${TIMES[$i]}s | ${NOTES[$i]} |"
  [[ "${STATUSES[$i]}" == "FAIL" || "${STATUSES[$i]}" == "BLOCKED" ]] && failed=1
done
echo
echo "total: ${SECONDS}s · logs: $LOGS$([[ ${GATE_KEEP:-0} == 1 ]] || echo ' (deleted; set GATE_KEEP=1 to keep)')"
exit $failed
