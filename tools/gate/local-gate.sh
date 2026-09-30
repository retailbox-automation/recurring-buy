#!/usr/bin/env bash
# Mechanical eligibility gate for a scaffold-hbar template, run on a FRESH
# scaffold pulled from GitHub the way a judge would: create-scaffold-hbar
# downloads the repository, then install, lint, build and boot run with no .env.
#
# Usage:
#   tools/gate/local-gate.sh <owner/repo[#ref]> [yarn|npm] [--strict]
#   tools/gate/local-gate.sh --local [yarn|npm] [--strict]
#
#   --local    gate the last commit of the repository that holds this script,
#              before it is pushed: the CLI copies it in through its
#              CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR option instead of downloading.
#              Checks that need GitHub (default branch, GitHub's licence
#              detection, the CLI reading template.json) are skipped.
#   --strict   also fail when G6 (testnet transaction link in README) is missing.
#              Without it G6 is reported as PENDING while the template is being built.
#
# Environment:
#   GATE_CLI_VERSION  create-scaffold-hbar version to run (default 0.4.0)
#   GATE_FRAMEWORK    hardhat or foundry to scaffold (default: the manifest's default).
#                     The Foundry leg needs forge on PATH.
#   GATE_ROUTES       space-separated routes to probe (default: paths in
#                     .harness/validators/playwright-smoke.yaml, else "/")
#   GATE_KEEP=1       keep the work directory (scaffold + logs) after the run
#
# Requires: node, git, curl, tar; yarn for the yarn leg; forge for the Foundry leg; gh for private repos.
# Run install in the repository that holds this script first (the manifest
# validator imports zod from it).
#
# Exit code: 0 when every item passes, 1 otherwise.

set -uo pipefail

usage() { sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

[[ $# -ge 1 ]] || usage
LOCAL=0
TEMPLATE_REF="$1"
if [[ "$TEMPLATE_REF" == "--local" ]]; then
  LOCAL=1
  TEMPLATE_REF="local/HEAD" # the CLI wants owner/repo; the files come from CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR
fi
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
# npm also gets an empty user config: a setting in ~/.npmrc can break or rescue an install
# (npm@12 with `allow-scripts` in ~/.npmrc fails every install the CLI starts, EALLOWSCRIPTS),
# and a judge's machine has neither.
: >"$WORK/empty-npmrc"
CLEAN_ENV=(env -i "PATH=$PATH" "HOME=$HOME" "TMPDIR=${TMPDIR:-/tmp}" "LANG=${LANG:-en_US.UTF-8}"
  "NPM_CONFIG_USERCONFIG=$WORK/empty-npmrc")
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

echo "gate: $([[ $LOCAL -eq 1 ]] && echo "last local commit" || echo "$OWNER/$REPO#$REF") · package manager $PM · create-scaffold-hbar@$CLI_VERSION · node $(node -v) · npm $(npm -v)"

# ---- source: the repository as GitHub serves it, or with --local the last local commit -------------
t0=$SECONDS
PRIVATE=false
if [[ $LOCAL -eq 1 ]]; then
  HISTORY_DIR="$(git -C "$GATE_DIR" rev-parse --show-toplevel)"
  SHA="$(git -C "$HISTORY_DIR" rev-parse HEAD)"
  DEFAULT_BRANCH=""
  mkdir -p "$SRC" && git -C "$HISTORY_DIR" archive "$SHA" | tar -x -C "$SRC"
  echo "source: $SHA, the last commit in $HISTORY_DIR ($(git -C "$HISTORY_DIR" status --porcelain | wc -l | tr -d ' ') uncommitted paths left out) in $((SECONDS - t0))s"
else
  HISTORY_DIR="$WORK/src.git"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    PRIVATE="$(gh api "repos/$OWNER/$REPO" --jq .private 2>/dev/null || echo unknown)"
    gh repo clone "$OWNER/$REPO" "$HISTORY_DIR" -- --bare --quiet >"$LOGS/clone.log" 2>&1
  else
    git clone --bare --quiet "https://github.com/$OWNER/$REPO.git" "$HISTORY_DIR" >"$LOGS/clone.log" 2>&1
  fi
  if ! SHA="$(git -C "$HISTORY_DIR" rev-parse --verify --quiet "$REF^{commit}")"; then
    cat "$LOGS/clone.log" >&2
    echo "cannot resolve $OWNER/$REPO#$REF — nothing to gate" >&2
    exit 1
  fi
  DEFAULT_BRANCH="$(git -C "$HISTORY_DIR" symbolic-ref --short HEAD 2>/dev/null)"
  mkdir -p "$SRC" && git -C "$HISTORY_DIR" archive "$SHA" | tar -x -C "$SRC"
  echo "source: $SHA (default branch: $DEFAULT_BRANCH, private: $PRIVATE) in $((SECONDS - t0))s"
fi

# ---- G2: template.json valid for the CLI, and served from the branch the CLI reads ----------------
t0=$SECONDS
G2_NOTE=""
if node "$GATE_DIR/validate-template-json.mjs" "$SRC/template.json" >"$LOGS/manifest.log" 2>&1; then
  G2_STATUS=PASS
else
  G2_STATUS=FAIL; G2_NOTE="$(tail -n 3 "$LOGS/manifest.log" | tr '\n' ' ')"
fi
if [[ $LOCAL -eq 0 && "$DEFAULT_BRANCH" != "main" ]]; then
  G2_STATUS=FAIL; G2_NOTE="$G2_NOTE default branch is '$DEFAULT_BRANCH': the CLI reads template.json from main"
fi
G2_SECONDS=$((SECONDS - t0))
DEFAULT_FW="$(node -e 'try{const m=require(process.argv[1]);console.log(m["create-scaffold-hbar"]?.defaults?.solidityFramework??"")}catch{console.log("")}' "$SRC/template.json")"
FW="${GATE_FRAMEWORK:-${DEFAULT_FW:-hardhat}}"
[[ "$FW" == "hardhat" || "$FW" == "foundry" ]] || { echo "framework must be hardhat or foundry, got: $FW" >&2; exit 2; }
echo "framework: $FW$([[ "$FW" == "$DEFAULT_FW" ]] && echo " (the manifest's default)")"

# ---- G1: scaffold -----------------------------------------------------------------------------------
SCAFFOLD_ARGS=(app --template "$TEMPLATE_REF" --ci --skip-hedera-skills --package-manager "$PM")
SCAFFOLD_ENV=()
if [[ $LOCAL -eq 1 ]]; then
  # The CLI reads capabilities from GitHub, which has no local/HEAD: pass the framework.
  SCAFFOLD_ARGS+=(-s "$FW")
  SCAFFOLD_ENV+=("CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR=$SRC")
elif [[ "$PRIVATE" != "false" ]]; then
  # The CLI fetches template.json anonymously, so a private repository falls back to CLI
  # defaults (Foundry). Pass the framework and a download token instead; the
  # "manifest applied" check below is skipped because it cannot be observed here.
  SCAFFOLD_ARGS+=(-s "$FW")
  SCAFFOLD_ENV+=("GIGET_AUTH=$(gh auth token 2>/dev/null)")
elif [[ "$FW" != "$DEFAULT_FW" ]]; then
  SCAFFOLD_ARGS+=(-s "$FW")
fi
started=$SECONDS
(cd "$WORK" && "${CLEAN_ENV[@]}" ${SCAFFOLD_ENV[@]+"${SCAFFOLD_ENV[@]}"} npx -y "create-scaffold-hbar@$CLI_VERSION" "${SCAFFOLD_ARGS[@]}") >"$LOGS/scaffold.log" 2>&1
code=$?
G1_SECONDS=$((SECONDS - started))
if [[ $code -eq 0 && -f "$APP/package.json" ]]; then
  record G1 "scaffold: npx create-scaffold-hbar@$CLI_VERSION --template $TEMPLATE_REF ($FW)" PASS "$G1_SECONDS" "includes the CLI's own install and format"
  SCAFFOLD_OK=1
else
  echo "---- scaffold.log (exit $code), last 30 lines ----" >&2; tail -n 30 "$LOGS/scaffold.log" >&2
  record G1 "scaffold: npx create-scaffold-hbar@$CLI_VERSION --template $TEMPLATE_REF ($FW)" FAIL "$G1_SECONDS" "exit $code"
  SCAFFOLD_OK=0
fi

# Must-differ control for G2: without -s the CLI picks the framework from our manifest;
# if it could not read the manifest it would fall back to Foundry.
if [[ $SCAFFOLD_OK -eq 1 && $LOCAL -eq 0 && "$PRIVATE" == "false" && -n "$DEFAULT_FW" && "$FW" == "$DEFAULT_FW" ]]; then
  if [[ -d "$APP/packages/$DEFAULT_FW" ]]; then
    G2_NOTE="$G2_NOTE manifest applied by the CLI (packages/$DEFAULT_FW present)"
  else
    G2_STATUS=FAIL; G2_NOTE="$G2_NOTE CLI ignored the manifest: packages/$DEFAULT_FW missing"
  fi
elif [[ $LOCAL -eq 1 ]]; then
  G2_NOTE="$G2_NOTE manifest-applied check skipped (--local: the CLI reads template.json from GitHub)"
elif [[ "$PRIVATE" != "false" ]]; then
  G2_NOTE="$G2_NOTE manifest-applied check skipped (private repo: CLI reads template.json anonymously)"
elif [[ "$FW" != "$DEFAULT_FW" ]]; then
  G2_NOTE="$G2_NOTE manifest-applied check skipped (-s $FW)"
fi
record G2 "template.json valid (CLI 0.4.0 schema)$([[ $LOCAL -eq 1 ]] || echo ' on branch main')" "$G2_STATUS" "$G2_SECONDS" "$G2_NOTE"

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

  # ESLint runs with --max-warnings=0; forge fmt --check (foundry:lint) has no warnings to count.
  lint_seconds=0; lint_failed=""
  for script in next:lint "$FW:lint"; do
    if [[ "$script" == foundry:lint ]]; then pm_run lint-foundry "$script" || lint_failed="$lint_failed $script"
    else pm_run "lint-${script%%:*}" "$script" ${RUN_SEP[@]+"${RUN_SEP[@]}"} --max-warnings=0 || lint_failed="$lint_failed $script"; fi
    lint_seconds=$((lint_seconds + STEP_SECONDS))
  done
  pm_run check-types next:check-types || lint_failed="$lint_failed next:check-types"
  lint_seconds=$((lint_seconds + STEP_SECONDS))
  if [[ -z "$lint_failed" ]]; then record G4 "lint (next:lint, $FW:lint) + next:check-types" PASS "$lint_seconds"
  else record G4 "lint (next:lint, $FW:lint) + next:check-types" FAIL "$lint_seconds" "failed:$lint_failed"; fi

  build_seconds=0; build_failed=""
  for script in "$FW:compile" next:build; do
    pm_run "build-${script%%:*}" "$script" || build_failed="$build_failed $script"
    build_seconds=$((build_seconds + STEP_SECONDS))
  done
  if [[ -z "$build_failed" ]]; then record G4 "build ($FW:compile + next:build)" PASS "$build_seconds"
  else record G4 "build ($FW:compile + next:build)" FAIL "$build_seconds" "failed:$build_failed"; fi

  # After the compile: next:test compares the app's ABI with the compiled contract.
  test_seconds=0; test_failed=""
  for script in "$FW:test" next:test; do
    pm_run "test-${script%%:*}" "$script" || test_failed="$test_failed $script"
    test_seconds=$((test_seconds + STEP_SECONDS))
  done
  if [[ -z "$test_failed" ]]; then record G4 "test ($FW:test + next:test)" PASS "$test_seconds"
  else record G4 "test ($FW:test + next:test)" FAIL "$test_seconds" "failed:$test_failed"; fi

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
  # A real id after the path: a template such as .../transaction/<timestamp> in the prose does not count.
  if grep -Eq 'hashscan\.io/testnet/(transaction|tx)/[0-9]|testnet\.mirrornode\.hedera\.com/api/v1/transactions/[0-9]' "$APP/README.md" 2>/dev/null; then
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
if node "$GATE_DIR/scan-secrets.mjs" --tree "$TREE_DIR" --history "$HISTORY_DIR" >"$LOGS/secrets.log" 2>&1; then
  G7_STATUS=PASS
else
  G7_STATUS=FAIL
fi
g7_note="$(head -n 1 "$LOGS/secrets.log")"
[[ $G7_STATUS == FAIL ]] && cat "$LOGS/secrets.log" >&2
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_ARGS=(git --no-banner --redact --log-opts=--all)
  [[ -f "$SRC/.gitleaks.toml" ]] && GITLEAKS_ARGS+=(--config "$SRC/.gitleaks.toml")
  if gitleaks "${GITLEAKS_ARGS[@]}" "$HISTORY_DIR" >"$LOGS/gitleaks.log" 2>&1; then
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
if [[ $LOCAL -eq 1 ]]; then
  g8_note="$g8_note GitHub's licence detection skipped (--local)"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  spdx="$(gh api "repos/$OWNER/$REPO/license" --jq .license.spdx_id 2>/dev/null || echo none)"
  g8_note="$g8_note GitHub detects: $spdx"
  [[ "$spdx" == "MIT" ]] || G8_STATUS=FAIL
fi
record G8 "MIT licence" "$G8_STATUS" $((SECONDS - started)) "$g8_note"

# ---- G9: the Hardhat and Foundry packages carry the same contract sources (checked in the template) --------
started=$SECONDS
if node "$GATE_DIR/same-contracts.mjs" "$SRC" >"$LOGS/same-contracts.log" 2>&1; then
  record G9 "same contracts/ in packages/hardhat and packages/foundry" PASS $((SECONDS - started))
else
  cat "$LOGS/same-contracts.log" >&2
  record G9 "same contracts/ in packages/hardhat and packages/foundry" FAIL $((SECONDS - started)) "see same-contracts.log"
fi

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
