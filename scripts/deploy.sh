#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DOMAIN_STATE_FILE="${ROOT_DIR}/.vercel/domain-state.json"
readonly DEPLOY_MAX_ATTEMPTS=3
readonly DEPLOY_RETRY_DELAY=5
readonly DEPLOY_WAIT_TIMEOUT=5m

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy.sh vercel

Targets:
  vercel   Deploy the app to Vercel.

Examples:
  npm run deploy -- vercel
  bash scripts/deploy.sh vercel
EOF
}

run_vercel_cli() {
  if command -v vercel >/dev/null 2>&1; then
    vercel "$@"
  else
    npx vercel@latest "$@"
  fi
}

run_vercel_api() {
  local api_dir
  api_dir="$(mktemp -d)"
  (
    cd "${api_dir}"
    run_vercel_cli api "$@"
  )
  local status=$?
  rm -rf "${api_dir}"
  return "${status}"
}

check_vercel_auth() {
  if ! run_vercel_cli whoami >/dev/null 2>&1; then
    echo 'Vercel CLI is not authenticated. Run `vercel login` and retry the deploy.' >&2
    exit 1
  fi
}

project_id() {
  node -e "const fs=require('fs'); const path=process.argv[1]; const data=JSON.parse(fs.readFileSync(path, 'utf8')); process.stdout.write(String(data.projectId || ''));" "${ROOT_DIR}/.vercel/project.json"
}

extract_deployment_url() {
  local command_output="$1"

  COMMAND_OUTPUT="${command_output}" node <<'EOF'
const raw = String(process.env.COMMAND_OUTPUT || '');

function trimJsonPayload(value) {
  const index = value.search(/[\[{]/);
  return index === -1 ? '' : value.slice(index);
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.vercel\.app$/i.test(trimmed)) return `https://${trimmed}`;
  return '';
}

const candidates = [];
const pushCandidate = (value) => {
  const normalized = normalizeUrl(value);
  if (normalized && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
};

const jsonPayload = trimJsonPayload(raw);
if (jsonPayload) {
  try {
    const parsed = JSON.parse(jsonPayload);
    if (typeof parsed === 'string') {
      pushCandidate(parsed);
    } else if (parsed && typeof parsed === 'object') {
      pushCandidate(parsed.url);
      pushCandidate(parsed.inspectorUrl);
      if (Array.isArray(parsed.alias)) parsed.alias.forEach(pushCandidate);
      if (Array.isArray(parsed.aliases)) parsed.aliases.forEach(pushCandidate);
    }
  } catch (error) {
    console.error('Failed to parse deploy output JSON:', error?.message || error);
  }
}

for (const match of raw.match(/https?:\/\/[^\s"']+/g) || []) {
  pushCandidate(match);
}
for (const match of raw.match(/[\w.-]+\.vercel\.app/g) || []) {
  pushCandidate(match);
}

if (candidates.length > 0) {
  process.stdout.write(candidates[0]);
}
EOF
}

deployment_ready_state() {
  local inspect_output="$1"

  INSPECT_OUTPUT="${inspect_output}" node <<'EOF'
const raw = String(process.env.INSPECT_OUTPUT || '');
const index = raw.search(/[\[{]/);

if (index === -1) {
  process.exit(0);
}

try {
  const parsed = JSON.parse(raw.slice(index));
  process.stdout.write(String(parsed?.readyState || '').trim());
} catch (error) {
  console.error('Failed to parse deployment inspect JSON:', error?.message || error);
}
EOF
}

wait_for_ready_deployment() {
  local deployment_url="$1"
  local inspect_output=""
  local inspect_status=0
  local log_status=0
  local ready_state=""
  local attempt

  echo "-> Waiting for Vercel deployment to become ready..."
  for attempt in $(seq 1 "${DEPLOY_MAX_ATTEMPTS}"); do
    set +e
    run_vercel_cli inspect "${deployment_url}" --logs --wait --timeout "${DEPLOY_WAIT_TIMEOUT}"
    log_status=$?
    inspect_output="$(run_vercel_cli inspect "${deployment_url}" --format json 2>&1)"
    inspect_status=$?
    set -e

    ready_state="$(deployment_ready_state "${inspect_output}")"
    if [[ "${ready_state}" == "READY" ]]; then
      return 0
    fi

    if [[ (${log_status} -eq 0 && ${inspect_status} -eq 0) || ${attempt} -ge ${DEPLOY_MAX_ATTEMPTS} ]]; then
      break
    fi

    echo "-> Inspect attempt ${attempt}/${DEPLOY_MAX_ATTEMPTS} did not reach READY (logs exit ${log_status}, inspect exit ${inspect_status}). Retrying in ${DEPLOY_RETRY_DELAY}s..." >&2
    sleep "${DEPLOY_RETRY_DELAY}"
  done

  if [[ -n "${ready_state}" ]]; then
    echo "Vercel deployment did not reach READY (state: ${ready_state}) -> ${deployment_url}" >&2
  else
    echo "Vercel deployment did not reach READY -> ${deployment_url}" >&2
  fi

  if [[ -n "${inspect_output}" ]]; then
    printf '%s\n' "${inspect_output}" >&2
  fi

  if [[ ${inspect_status} -ne 0 ]]; then
    exit ${inspect_status}
  fi

  if [[ ${log_status} -ne 0 ]]; then
    exit ${log_status}
  fi

  exit 1
}

run_deploy_with_retry() {
  local app_version="$1"
  local attempt
  local output=""
  local status=1
  local output_file

  output_file="$(mktemp)"
  trap 'rm -f "${output_file}"' RETURN

  for attempt in $(seq 1 "${DEPLOY_MAX_ATTEMPTS}"); do
    set +e
    (
      cd "${ROOT_DIR}"
      APP_VERSION="${app_version}" run_vercel_cli deploy --prod --yes --no-wait --format json 2>&1 | tee "${output_file}" >&2
    )
    status=${PIPESTATUS[0]}
    set -e

    output="$(<"${output_file}")"

    if [[ ${status} -eq 0 ]]; then
      printf '%s' "${output}"
      return 0
    fi

    if [[ ${attempt} -lt ${DEPLOY_MAX_ATTEMPTS} ]]; then
      echo "-> Deploy attempt ${attempt}/${DEPLOY_MAX_ATTEMPTS} failed (exit ${status}). Retrying in ${DEPLOY_RETRY_DELAY}s..." >&2
      sleep "${DEPLOY_RETRY_DELAY}"
    fi
  done

  printf '%s' "${output}" >&2
  return "${status}"
}

configured_base_url() {
  if [[ -n "${APP_BASE_URL:-}" ]]; then
    printf '%s' "${APP_BASE_URL}"
    return
  fi

  PROJECT_ROOT_DIR="${ROOT_DIR}" node <<'EOF'
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const values = {};
  const content = readFileSync(filePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

const rootDir = process.env.PROJECT_ROOT_DIR;
const merged = {
  ...parseEnvFile(join(rootDir, '.env')),
  ...parseEnvFile(join(rootDir, '.env.vercel'))
};

process.stdout.write(String(merged.APP_BASE_URL || '').trim());
EOF
}

configured_domain() {
  local base_url

  base_url="$(configured_base_url)"
  if [[ -z "${base_url}" ]]; then
    echo 'Missing APP_BASE_URL in shell env, .env, or .env.vercel.' >&2
    exit 1
  fi

  BASE_URL="${base_url}" node <<'EOF'
try {
  const url = new URL(process.env.BASE_URL);
  process.stdout.write(url.hostname);
} catch (error) {
  console.error(`APP_BASE_URL must be a valid absolute URL. Received: ${process.env.BASE_URL}`);
  process.exit(1);
}
EOF
}

read_managed_domain_state() {
  if [[ ! -f "${DOMAIN_STATE_FILE}" ]]; then
    return
  fi

  STATE_FILE="${DOMAIN_STATE_FILE}" node <<'EOF'
const { readFileSync } = require('fs');

try {
  const state = JSON.parse(readFileSync(process.env.STATE_FILE, 'utf8'));
  process.stdout.write(String(state.managedDomain || '').trim());
} catch (error) {
  console.error('Failed to read managed domain state:', error?.message || error);
  process.stdout.write('');
}
EOF
}

write_managed_domain_state() {
  local managed_domain="$1"

  STATE_FILE="${DOMAIN_STATE_FILE}" MANAGED_DOMAIN="${managed_domain}" node <<'EOF'
const { mkdirSync, writeFileSync } = require('fs');
const { dirname } = require('path');

const stateFile = process.env.STATE_FILE;
mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, JSON.stringify({ managedDomain: process.env.MANAGED_DOMAIN }, null, 2) + '\n');
EOF
}

list_project_domains() {
  local project_id_value="$1"

  run_vercel_api "/v9/projects/${project_id_value}/domains"
}

list_other_vercel_app_domains() {
  local project_id_value="$1"
  local current_domain="$2"
  local recorded_domain

  recorded_domain="$(read_managed_domain_state)"
  PROJECT_DOMAINS_JSON="$(list_project_domains "${project_id_value}")" CURRENT_DOMAIN="${current_domain}" RECORDED_DOMAIN="${recorded_domain}" node <<'EOF'
const payload = JSON.parse(process.env.PROJECT_DOMAINS_JSON || '{}');
const currentDomain = process.env.CURRENT_DOMAIN;
const recordedDomain = process.env.RECORDED_DOMAIN;
const domains = Array.isArray(payload) ? payload : Array.isArray(payload.domains) ? payload.domains : [];

const names = domains
  .map((entry) => String(entry?.name || '').trim())
  .filter((name) => name && name.endsWith('.vercel.app') && name !== currentDomain);

const prioritized = recordedDomain && names.includes(recordedDomain)
  ? [recordedDomain, ...names.filter((name) => name !== recordedDomain)]
  : names;

process.stdout.write(prioritized.join('\n'));
EOF
}

ensure_project_domain() {
  local project_id_value="$1"
  local domain="$2"

  if (
    run_vercel_api "/v9/projects/${project_id_value}/domains/${domain}" >/dev/null
  ); then
    return
  fi

  echo "-> Adding project production domain ${domain}..."
  run_vercel_api "/v10/projects/${project_id_value}/domains" -X POST -f "name=${domain}" >/dev/null
}

remove_project_domain() {
  local project_id_value="$1"
  local domain="$2"

  if [[ -z "${domain}" ]]; then
    return
  fi

  if ! (
    run_vercel_api "/v9/projects/${project_id_value}/domains/${domain}" >/dev/null 2>&1
  ); then
    return
  fi

  echo "-> Removing previous production domain ${domain}..."
  run_vercel_api "/v9/projects/${project_id_value}/domains/${domain}" -X DELETE --dangerously-skip-permissions >/dev/null
}

sync_project_domains() {
  local configured_domain_value
  local project_id_value
  local obsolete_domains=()
  local obsolete_domain

  configured_domain_value="$(configured_domain)"
  project_id_value="$(project_id)"
  if [[ -z "${project_id_value}" ]]; then
    echo 'Failed to determine the Vercel project ID from .vercel/project.json.' >&2
    exit 1
  fi

  ensure_project_domain "${project_id_value}" "${configured_domain_value}"

  while IFS= read -r obsolete_domain; do
    [[ -n "${obsolete_domain}" ]] || continue
    obsolete_domains+=("${obsolete_domain}")
  done < <(list_other_vercel_app_domains "${project_id_value}" "${configured_domain_value}")

  for obsolete_domain in "${obsolete_domains[@]}"; do
    remove_project_domain "${project_id_value}" "${obsolete_domain}"
  done

  write_managed_domain_state "${configured_domain_value}"
}

deploy_vercel() {
  local app_version
  local base_url
  local deploy_output
  local deployment_url
  app_version="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  base_url="$(configured_base_url)"

  if [[ ! -f "${ROOT_DIR}/.vercel/project.json" ]]; then
    echo "Missing .vercel/project.json in ${ROOT_DIR}. Run 'vercel link' from the repo root first." >&2
    exit 1
  fi

  check_vercel_auth

  echo '-> Deploying to Vercel...'
  deploy_output="$(run_deploy_with_retry "${app_version}")"

  deployment_url="$(extract_deployment_url "${deploy_output}")"
  if [[ -z "${deployment_url}" ]]; then
    echo 'Failed to determine the Vercel deployment URL.' >&2
    printf '%s\n' "${deploy_output}" >&2
    exit 1
  fi

  wait_for_ready_deployment "${deployment_url}"

  sync_project_domains

  echo "OK Vercel deploy complete -> ${base_url}"
}

main() {
  local target="${1:-}"

  case "${target}" in
    vercel)
      deploy_vercel
      ;;
    -h|--help|help|'')
      usage
      ;;
    *)
      echo "Unknown target: ${target}" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
