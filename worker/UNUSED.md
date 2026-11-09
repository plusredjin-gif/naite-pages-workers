# worker/ — 미사용 (보관용)

**결정: 2026-11-09 (jin) — 나이테 배포 방식을 Pages+Workers에서 Pages-only로 전환.**

이 폴더의 Worker 코드는 **배포하지 않고, 호출하지 않는다.**
나중에 Pages-only에서 Worker 방식으로 되돌릴 일이 있을 수 있어 원본은
그대로 보관한다. 삭제하지 않는다.

- `src/index.ts` — Worker 진입점 + 로그인(`/api/auth/*`, 그록 소유 구간 포함)
- `src/api.ts` — 로그인 외 API 전부 (D1·KV·R2 기반)
- `src/sync.ts` — 크론 백그라운드 동기화 (30분 간격)
- `schema.sql`, `migrations/0002_settings_sync.sql` — D1 스키마
- `wrangler.toml` — Worker 설정 (D1·KV·R2 바인딩, 크론) — 배포하지 않는다

미사용 표시:
- 이 파일(`worker/UNUSED.md`)
- `wrangler.toml` 맨 위 주석
- `src/index.ts` 맨 위 주석

Pages-only에서 이 코드의 기능이 어디로 갔는지는 `docs/API_MAPPING.md`를 본다.
기능별 대응:
- 메모·카테고리·키워드·온톨로지·분석 → 브라우저 로컬 저장소 (`frontend/src/local-store.ts`)
- Drive·Calendar·Tasks·People·Geocoding → 브라우저 직접 Google API 호출 (`frontend/src/google-client.ts`)
- 백그라운드 동기화(크론)·실시간 알림 → Pages-only 미지원
- 로그인 → 그록 소유. 세션 쿠키/HMAC 방식이 아니라 브라우저 OAuth 토큰 직접 보관 방식이다 (`docs/LOGIN_SEAM.md`).

주의:
- 이 폴더를 `wrangler deploy`로 배포하지 않는다.
- D1·KV·R2를 새로 만들지 않는다 (만들어진 것이 있으면 그대로 둔다).
- Google OAuth 클라이언트 secrets를 이 폴더 기준으로 등록하지 않는다.
