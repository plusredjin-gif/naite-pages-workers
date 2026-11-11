#!/bin/bash
# 나이테 Pages 프론트엔드 빌드 (클라이언트 ID 주입 필수)
# VITE_GOOGLE_CLIENT_ID 없이 빌드하면 로그인 버튼이 비활성화된다 (2026-11-11 사고).
# 배포 순서: ./build.sh → python3 ../custom-connectors/custom.cloudflare/bin/deploy_naite_frontend.py
set -e
cd "$(dirname "$0")"
export VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-551200708040-kanrdsov8059e2rt41hrif52tk63i75f.apps.googleusercontent.com}"
npm run build
grep -q "551200708040" dist/assets/*.js || { echo "ERROR: 클라이언트 ID가 번들에 없습니다"; exit 1; }
echo "OK: 클라이언트 ID 포함 확인"
