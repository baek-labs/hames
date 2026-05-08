#!/usr/bin/env bash
# Hames Codespace bootstrap.
# Runs once on container creation (postCreateCommand).
# Idempotent — safe to re-run.

set -e

echo "[Hames] === Codespace setup start ==="

# ─── 1. AI CLIs (Claude / Gemini / Codex) ────────────────────────────────────
install_cli () {
  local cmd="$1"
  local pkg="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[Hames] Installing $cmd ($pkg)..."
    npm install -g "$pkg" || echo "[Hames] WARN: $pkg install failed (non-fatal)"
  else
    echo "[Hames] $cmd already installed: $($cmd --version 2>/dev/null | head -1)"
  fi
}
install_cli claude  "@anthropic-ai/claude-code"
install_cli gemini  "@google/gemini-cli"
install_cli codex   "@openai/codex"

# ─── 2. Python deps for Arsenal scripts ──────────────────────────────────────
echo "[Hames] Installing Python deps..."
pip install --quiet --no-warn-script-location \
  requests \
  python-dotenv \
  google-api-python-client \
  google-auth-oauthlib \
  google-auth-httplib2 \
  pypdf \
  python-pptx \
  openpyxl \
  openai \
  || echo "[Hames] (some pip packages skipped — non-fatal)"

# ─── 3. Node deps if package.json exists at root ─────────────────────────────
if [ -f "package.json" ]; then
  echo "[Hames] Installing root Node deps..."
  npm install --no-audit --no-fund || true
fi
if [ -f "arsenal/package.json" ]; then
  echo "[Hames] Installing Arsenal Node deps..."
  ( cd arsenal && npm install --no-audit --no-fund ) || true
fi

# ─── 4. Hydrate .env from Codespace secrets ──────────────────────────────────
ENV_FILE="arsenal/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[Hames] Generating $ENV_FILE from Codespace secrets..."
  mkdir -p "$(dirname "$ENV_FILE")"
  {
    [ -n "$OPENAI_API_KEY" ]          && echo "OPENAI_API_KEY=$OPENAI_API_KEY"
    [ -n "$PERPLEXITY_API_KEY" ]      && echo "PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY"
    [ -n "$NOTION_KEY" ]              && echo "NOTION_KEY=$NOTION_KEY"
    [ -n "$GOOGLE_MAPS_KEY" ]         && echo "GOOGLE_MAPS_KEY=$GOOGLE_MAPS_KEY"
    [ -n "$NAVER_AD_API_KEY" ]        && echo "NAVER_AD_API_KEY=$NAVER_AD_API_KEY"
    [ -n "$NAVER_AD_SECRET_KEY" ]     && echo "NAVER_AD_SECRET_KEY=$NAVER_AD_SECRET_KEY"
    [ -n "$NAVER_AD_CUSTOMER_ID" ]    && echo "NAVER_AD_CUSTOMER_ID=$NAVER_AD_CUSTOMER_ID"
    [ -n "$ELEVENLABS_API_KEY" ]      && echo "ElevenLabs_API_Key=$ELEVENLABS_API_KEY"
    [ -n "$YOUTUBE_API_KEY" ]         && echo "Youtube_API_Key=$YOUTUBE_API_KEY"
    [ -n "$CORE_AC_UK_API_KEY" ]      && echo "CORE.AC.UK_API_KEY=$CORE_AC_UK_API_KEY"
    [ -n "$SEMANTIC_SCHOLAR_API_KEY" ]&& echo "SEMANTIC_SCHOLAR_API_KEY=$SEMANTIC_SCHOLAR_API_KEY"
  } > "$ENV_FILE"
  echo "[Hames] .env written ($(wc -l < "$ENV_FILE") keys)."
else
  echo "[Hames] .env already exists — skipping."
fi

# ─── 4b. Hydrate OAuth JSON files from Codespace secrets ─────────────────────
write_secret_file () {
  local content="$1"
  local target="$2"
  if [ -n "$content" ] && [ ! -f "$target" ]; then
    mkdir -p "$(dirname "$target")"
    printf '%s' "$content" > "$target"
    chmod 600 "$target"
    echo "[Hames] wrote $target"
  fi
}
write_secret_file "$GOOGLE_CREDENTIALS_JSON"   "arsenal/credentials.json"
write_secret_file "$GOOGLE_TOKEN_JSON"         "arsenal/token.json"
write_secret_file "$YOUTUBE_OAUTH_CLIENT_JSON" "arsenal/.youtube_oauth_client.json"
write_secret_file "$YOUTUBE_OAUTH_TOKEN_JSON"  "arsenal/.youtube_oauth_token.json"

# ─── 4c. Submodules ──────────────────────────────────────────────────────────
if [ -f .gitmodules ]; then
  echo "[Hames] Initializing submodules..."
  git submodule update --init --recursive 2>&1 | grep -v "no submodule mapping" || true
fi

# ─── 5. Workspace lock state file (Lock OFF by default) ──────────────────────
LOCK_FILE=".claude/.workspace_lock"
if [ ! -f "$LOCK_FILE" ]; then
  echo '{"workspace": null, "locked": false}' > "$LOCK_FILE"
fi

# ─── 6. Make hook scripts executable ─────────────────────────────────────────
chmod +x .claude/hooks/*.js 2>/dev/null || true
chmod +x arsenal/*.js 2>/dev/null || true

echo ""
echo "[Hames] === Codespace setup complete ==="
echo ""
echo "다음 단계:"
echo "  1) 터미널에서  claude  입력 → 첫 실행이면 /login 으로 Anthropic 계정 로그인"
echo "  2) HamesSystem 적용  으로 규칙 활성화 확인"
echo ""
