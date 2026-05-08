#!/usr/bin/env bash
# pre_push_guard.sh — API 키 / 민감 파일 push 차단
# 설치: cp arsenal/pre_push_guard.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push

API_PATTERN='AIzaSy[A-Za-z0-9_-]{33}|sk-proj-[A-Za-z0-9_-]{20,}|pplx-[A-Za-z0-9]{20,}|ntn_[0-9]{12,}[A-Za-z0-9]+|GOCSPX-[A-Za-z0-9_-]{20,}|r8_[A-Za-z0-9]{30,}|sk_[a-f0-9]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|"client_secret"[[:space:]]*:[[:space:]]*"[^"]+"'

SENSITIVE_FILES='config\.js$|\.env$|credentials\.json$|token\.json$|secrets\.|\.youtube_oauth_client\.json$|\.youtube_oauth_token\.json$|client_secret_[0-9]+.*\.json$'

BLOCKED=0

while read local_ref local_sha remote_ref remote_sha; do
  # 브랜치 삭제 push는 스킵
  [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue

  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    # 신규 브랜치: 최신 커밋 하나만 검사
    RANGE="$local_sha^..$local_sha"
  else
    RANGE="${remote_sha}..${local_sha}"
  fi

  # 1) API 키 패턴 검사 (추가된 줄만)
  MATCHES=$(git log -p "$RANGE" 2>/dev/null | grep '^+' | grep -v '^+++' | grep -E "$API_PATTERN")
  if [ -n "$MATCHES" ]; then
    echo ""
    echo "BLOCKED: API 키가 커밋에 포함되어 있습니다."
    echo "$MATCHES" | head -5
    BLOCKED=1
  fi

  # 2) 민감 파일 자체가 추적되고 있는지 검사
  SENSITIVE=$(git diff --name-only --diff-filter=AM "$RANGE" 2>/dev/null | grep -E "$SENSITIVE_FILES")
  if [ -n "$SENSITIVE" ]; then
    echo ""
    echo "BLOCKED: 민감 파일이 push 대상에 포함되어 있습니다."
    echo "$SENSITIVE"
    echo "→ .gitignore에 추가했는지 확인하세요."
    BLOCKED=1
  fi
done

if [ "$BLOCKED" = "1" ]; then
  echo ""
  echo "Push가 차단되었습니다. 키는 config.js 또는 .env에 저장하고 .gitignore로 제외하세요."
  exit 1
fi

exit 0
