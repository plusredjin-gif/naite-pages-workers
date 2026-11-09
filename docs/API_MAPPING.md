# Worker API → Pages-only 대응표

작성: 2026-11-09 (Pages-only 전환). Worker(`worker/`)는 미사용(보관용)이다.
이 문서는 Worker API(`worker/src/api.ts`)의 기능이 Pages-only에서 어디로
갔는지 정리한다. 구현은 `frontend/src/api.ts` + `local-store.ts` + `google-client.ts`.

## 대응 원칙

| 구분 | Pages-only에서 |
|---|---|
| 메모·카테고리·키워드·온톨로지·사람·장소·설정 저장 | 브라우저 localStorage (`local-store.ts`) |
| Drive·Calendar·Tasks·People·Geocoding | 브라우저에서 Google API 직접 호출 (`google-client.ts`) |
| Drive `memo` 폴더 | "진실의 원본" 중 하나로 유지 (1메모=1파일 JSON). 수동 동기화로 맞춤 |
| 규칙 기반 계산 (키워드 추출·순환 거부·온톨로지 왕복·분석) | 브라우저 로컬에서 동일 규칙으로 계산 (worker/api.ts에서 이식) |
| 백그라운드 동기화·실시간 알림 | **미지원** (서버가 없어 동작 주체가 없음) |

## 엔드포인트별 대응

### 로그인 (그록 소유 — 이 표의 범위가 아니다)

| Worker | Pages-only |
|---|---|
| `GET /api/auth/login`, `/callback`, `/logout` | 그록 소유 브라우저 OAuth 플로우. Worker 경유 없음. `docs/LOGIN_SEAM.md` 참조 |
| `GET /api/auth/me` (그록 구현 예정이었음) | **대체 수단**: access_token으로 Google userinfo 직접 호출 (`google-client.ts`의 `fetchGoogleUserinfo`) |
| 세션 쿠키 `naite_session` + HMAC 검증 | **없음**. 토큰은 sessionStorage에 access_token만 보관 (`token-store.ts`) |

### 메모·블록·카테고리 — 로컬 저장소로 구현 완료

| Worker | Pages-only | 상태 |
|---|---|---|
| `GET/POST /api/memos`, `GET/PATCH/DELETE /api/memos/:id` | `api.memos.*` → localStorage | ✅ 구현 |
| `POST /api/memos/:id/blocks`, `PATCH/DELETE /api/blocks/:id` | `api.memos.addBlock`, `api.blocks.*` → localStorage | ✅ 구현 |
| `GET/POST/PATCH/DELETE /api/categories` | `api.categories.*` → localStorage | ✅ 구현 |
| `POST /api/memos/:id/extract-keywords` | `api.memos.extractKeywords` → 규칙 기반 로컬 추출 (worker와 동일 규칙) | ✅ 구현 |

### 키워드·온톨로지 — 로컬 계산으로 구현 완료

| Worker | Pages-only | 상태 |
|---|---|---|
| `GET/POST /api/keywords`, 간선 추가·삭제 | `api.keywords.*` → localStorage (순환 거부·잠금 규칙 동일) | ✅ 구현 |
| `GET /api/ontology/graph` | `api.ontology.graph` → 로컬 상태에서 조립 | ✅ 구현 |
| `POST /api/ontology/import/preview`, `/apply` | `api.ontology.previewImport` / `applyImport` → 로컬 미리보기·적용 (잠긴 간선 건너뜀, 스냅샷 저장) | ✅ 구현 |
| `GET /api/ontology/revisions`, `POST .../undo` | `api.ontology.revisions` / `undoRevision` → 로컬 리비전·되돌리기 | ✅ 구현 |
| `GET /api/analytics/summary`, `/analytics/prompt` | `api.analytics.*` → 로컬 집계·프롬프트 생성 (AI 왕복은 사용자가 프롬프트를 직접 AI에 붙여넣는 방식) | ✅ 구현 |

### 사람·장소·위치 — 로컬 저장 + 직접 API 호출

| Worker | Pages-only | 상태 |
|---|---|---|
| `GET/POST/DELETE /api/people` | `api.people.*` (목록·등록·삭제) → localStorage | ✅ 구현 |
| `GET /api/people/search?q=` | `api.people.search` → People API `searchContacts` 직접 호출 (전체 열거 없음) | ✅ 구현 |
| `GET/POST/DELETE /api/places` | `api.places.*` → localStorage | ✅ 구현 |
| `GET /api/places/search?q=` | `api.places.search` → Geocoding API 직접 호출. Maps API 키(`VITE_GOOGLE_MAPS_API_KEY`)가 없으면 빈 결과 + `MAPS_KEY_NOT_CONFIGURED` 반환 (미지원 표시) | ✅ 구현 (키 없을 시 미지원) |
| `GET /api/locations`, `POST /api/memos/:id/geo` | `api.locations.list`, `api.memos.setGeo` → localStorage + 역지오코딩 직접 호출 (키 없으면 좌표만 저장) | ✅ 구현 |

### 캘린더·할일 — 직접 API 호출로 구현 완료

| Worker | Pages-only | 상태 |
|---|---|---|
| `POST /api/calendar/events` | `api.calendar.createEvent` → Calendar API 직접 호출 + 로컬 memo_events 저장 | ✅ 구현 |
| `GET /api/calendar/agenda` | `api.calendar.agenda` → Calendar API 직접 호출 | ✅ 구현 |
| `GET /api/tasks` | `api.tasks.list` → Tasks API 직접 호출 (`나이테 메모` 목록 자동 생성) | ✅ 구현 |
| `POST /api/tasks/sync` | `api.tasks.sync` → Tasks API 직접 호출 (한 블록씩, 로컬 task_links 저장) | ✅ 구현 |

### Drive — 직접 API 호출, 수동 동기화만

| Worker | Pages-only | 상태 |
|---|---|---|
| `GET /api/drive/status` | `api.drive.status` → Drive API 직접 호출 (토큰 없으면 폴더 확인 불가, 로컬 수만 반환) | ✅ 구현 |
| `POST /api/drive/sync` (증분, 크론도 사용) | `api.drive.sync` → 수동 실행만. dryRun 지원. 크론은 없음 | ✅ 구현 (수동만) |
| `POST /api/drive/import` | `api.drive.importAll` → 수동 전체 가져오기 (마이그레이션 경로) | ✅ 구현 |
| `POST /api/drive/memos/:id/push` | `api.drive.pushMemo` → 수동 1개 저장 | ✅ 구현 |

### 첨부파일 — Drive로 대체

| Worker | Pages-only | 상태 |
|---|---|---|
| `POST /api/attachments/upload` (R2) | `api.attachments.upload` → Drive memo 폴더에 직접 업로드. 반환 url은 Drive 보기 링크. 20MB 제한 유지 | ✅ 구현 (R2 없음) |
| `GET /api/attachments/:id` (R2 서빙) | **없음**. Drive 보기 링크로 대신 본다 | ⚠️ 대체됨 |

### 설정·부트스트랩

| Worker | Pages-only | 상태 |
|---|---|---|
| `GET/PATCH /api/settings` | `api.settings.*` → localStorage | ✅ 구현 |
| `GET /api/bootstrap` | `api.bootstrap` → 로컬 설정 + (토큰 있으면) userinfo로 사용자 확인 | ✅ 구현 |

## 미지원 / 제한 (Pages-only)

| 항목 | 내용 |
|---|---|
| 백그라운드 동기화 (크론 30분) | **미지원**. 브라우저가 닫히면 동작하지 않는다. Drive 동기화는 버튼으로 수동 실행 (`api.drive.sync`, `api.unsupported.backgroundSync` 호출 시 에러) |
| 실시간 알림·푸시 | **미지원**. 서버가 없어 보낼 주체가 없다 |
| 서버 측 AI 온톨로지 계산 | **미지원**. 키워드 추출·그래프 계산·왕복 미리보기/적용은 브라우저 로컬 규칙 기반으로 처리. AI 분석은 `analytics.prompt`로 만든 프롬프트를 사용자가 직접 AI에 붙여넣는 왕복 방식 |
| 토큰 자동 갱신 | **미지원**. refresh_token을 브라우저에 저장하지 않는다. access_token(약 1시간) 만료 시 재로그인 필요 |
| 오프라인 Google API | **미지원**. Drive·캘린더·할일·연락처·장소 검색은 온라인에서만 동작. 로컬 메모 작성·편집은 오프라인 가능 |
| 멀티탭 동시 편집 | **미지원**. localStorage 단일 저장소 전제. 두 탭에서 동시에 고치면 나중 저장이 덮는다 |
| 첨부파일 서빙 | R2가 없어 Drive 보기 링크로 대체. 앱 안에서 직접 스트리밍하지 않는다 |
