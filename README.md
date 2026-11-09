# 나이테 Pages + Workers 이관 — 아키텍처 및 작업 기록

작성: 2026-11-08 (jin 확정: Pages+Workers로 배포, 개인용·테스트 모드 먼저)
대상 앱: memoaeb (web_fullstack, "나이테") — 현재 Muse 호스팅에서만 동작
Cloudflare: 플러스트리 계정 `afcc73162112ed35152fe21ff2461cb0`, Pages 프로젝트 `plustree-memo`

## 1. 현재 상태 (2026-11-08 22:42 KST 확인)

| 항목 | 상태 |
|---|---|
| `https://plustree-memo.pages.dev` | 200 — 정적 목업만 서빙 중 |
| `https://memo.plustree.net` | 200 — 정적 목업 서빙 중 (active) |
| `https://naite.plustree.net` | 200 — 정적 목업 서빙 중 (**11/08 16:31 pending에서 활성화됨 확인**. 가비아 naite CNAME 전파 완료로 판단) |
| memoaeb 풀스택 앱 | Muse 호스팅에서 동작 중. 로그인·Drive·캘린더·할일·연락처·장소·온톨로지 등 서버 액션 약 60개 |
| 기존 사용자 데이터·설정 | 이번 작업에서 건드리지 않음 |

주의: 위 URL 확인은 텍스트 fetch 기준이며, 실기기 브라우저 방문 검증은 아니다.

## 2. 왜 정적 배포만으로는 안 되는가

- memoaeb은 web_fullstack이다. 서버 액션(세션, Drive 동기화, 캘린더·Tasks·People API 중계, 첨부파일 저장, 키워드 자동 추출 등)이 Muse 런타임에 있다.
- Pages 정적 호스팅에 올릴 수 있는 것은 클라이언트(UI)뿐이다. 지금 `plustree-memo`에 올라간 `index.html`은 목업이다.
- web_fullstack은 정적 HTML로 내보낼 수 없다. 따라서 Pages에 올릴 프론트엔드는 별도 빌드(정적 클라이언트 재구축)가 필요하다.

## 3. 목표 아키텍처 (Pages + Workers)

```
사용자 (naite.plustree.net)
   └─ Pages (정적 프론트엔드: React 클라이언트 재구축본)
        └─ api.naite.plustree.net (Workers, 이 폴더의 worker/)
             ├─ OAuth 콜백: Google 로그인, refresh_token을 KV에 암호화 저장
             ├─ Google API 중계: Drive / Calendar / Tasks / People / Geocoding
             ├─ 메모·카테고리·키워드·온톨로지 CRUD: D1 (SQLite)
             ├─ 사진·음성 첨부: R2
             └─ 백그라운드 동기화: Workers Cron Trigger (Drive 동기화, Tasks 양방향 동기화)
```

### 서버 기능 매핑 (memoaeb 액션 → Worker 엔드포인트)

| 현재 기능 | Worker에서 필요한 것 |
|---|---|
| Google 로그인 (`loginWithGoogle`, 세션) | OAuth 2.0 authorization-code + PKCE, 세션 쿠키, KV에 refresh_token 저장 |
| Drive 저장·동기화 (`requestDriveSync`, `requestDriveImport`, `completedrivesync`) | Drive API (`drive.file` 범위): `memo` 폴더, 메모 1개=파일 1개, 첨부 업로드 |
| 캘린더 (`createCalendarEvent`, `requestCalendarAgenda`) | Calendar API: 일정 생성·조회, 30일 어젠다 캐시 |
| 할일 (`requestTasksSync`) | Tasks API: 체크리스트 양방향 동기화, `나이테 메모` 목록 |
| 연락처 (`searchContacts`, `registerContact`) | People API: 이름·이메일 검색 → 후보만 반환, 등록한 사람만 저장 |
| 장소 (`searchPlaces`, `completePlaceSearch`) | Geocoding: 장소 후보 반환 (좌표 불확실 시 null 유지) |
| 위치 메타데이터 (`setMemoGeo`, `completeMemoGeo`) | 브라우저 Geolocation + 역지오코딩 → 온톨로지 위치 노드 |
| 메모·카테고리·키워드·온톨로지 CRUD | D1 테이블: memos, blocks, categories, keywords, keyword_parents(다대다), keyword_links, people, places, locations, memo_* 연결 테이블, ontology_revisions |
| 첨부파일 (사진·음성) | R2 버킷, 서명 URL 또는 Worker 경유 스트리밍 |
| AI 온톨로지 왕복 (`previewOntologyImport`, `applyOntologyImport`, `undoOntologyRevision`) | JSON 파싱·미리보기·적용·스냅샷 되돌리기 — D1 트랜잭션으로 구현 |
| 분석 대시보드·프롬프트 생성 | D1 집계 쿼리 (연결 수·중심 키워드·고립 메모) + 프롬프트 템플릿 |

### 데이터 저장 위치 결정

- 메모 본문·관계 그래프: D1 (관계형이 온톨로지 다대다 간선에 적합)
- OAuth 토큰: KV (암호화 저장, Workers secret으로 암호화 키 관리)
- 첨부파일: R2
- Drive는 그대로 "진실의 원본" 중 하나로 유지 (기존 설계: 메모 1개=Drive 파일 1개)

## 4. 배포 순서 (남은 단계)

1. **jin이 할 일 A — Cloudflare 추가 토큰 발급·제출** (아래 6절 참조). Workers·D1·R2·KV 권한이 있는 토큰이 필요하다. 기존 토큰은 Pages 배포만 확인됐고, Account Read도 없다.
2. **jin이 할 일 B — Google OAuth 클라이언트 생성** (아래 7절 참조). jin의 Google 계정으로만 가능하다. Redirect URI에 `https://naite.plustree.net/api/auth/callback` 등록.
3. 프론트엔드 정적 빌드: memoaeb 클라이언트를 Pages용 정적 앱으로 재구축 (artifact 빌더로 진행, 기존 Muse 앱은 유지).
4. Worker 배포: `worker/`를 `wrangler deploy`로 배포, `api.naite.plustree.net` 커스텀 도메인 연결.
5. D1·KV·R2 생성 및 마이그레이션 적용, secrets 등록 (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`).
6. 데이터 마이그레이션: Muse 앱의 기존 메모·설정을 D1/R2로 이전 (Drive `memo` 폴더가 원본이므로 Drive import 경로로 복원 가능 — 기존 데이터·설정을 건드리지 않고 별도 검증).
7. 도메인 전환: `naite.plustree.net`을 Pages(새 프론트엔드)로, API를 Worker로 연결. `memo.plustree.net`은 전환 완료 전까지 유지.
8. 종단 검증: 로그인 → 메모 작성 → Drive 동기화 → 캘린더·할일·연락처·장소 동작 확인.

## 5. 지금 막혀 있는 지점 (확인된 사실만)

- **추가 토큰 없음**: "추가 토큰"이 어디에도 없다. Secure Vault에 저장된 Cloudflare 자격증명은 기존 토큰 1개뿐이고, 워크스페이스 파일·메모 어디에도 추가 토큰은 없다. 2026-11-02 jin의 "만들었다"는 발언은 토큰인지 계정인지 불명이며, 저장된 토큰은 바뀐 적 없다. → 새로 만들어서 제출해야 한다.
- **기존 토큰 상태**: 2026-11-08 기준 Pages 배포는 됐으나, 계정 목록 조회는 0개(Account Read 없음). Workers/D1/R2 권한 보유 여부는 미확인. 토큰 만료 여부는 이번에 직접 확인하지 않았다 (jin 지시: 기존 토큰이 떨어지면 그때 교체).
- **OAuth 클라이언트 없음**: naite.plustree.net용 Google OAuth 클라이언트는 아직 없다. jin이 직접 만들어야 한다.
- **프론트엔드 정적 빌드 없음**: memoaeb에서 추출할 정적 번들이 없다. 재구축이 필요하다.

## 6. 토큰 교체 절차 (jin 지시: 기존 토큰이 떨어지면 추가 토큰으로 교체)

### 교체 시점 판단
- 배포·API 호출이 `403 / error 9109 (Invalid access token)` 또는 `401`로 실패하면 기존 토큰 만료·무효로 판단한다.
- 토큰 교체는 Cloudflare 자격증명만 바꾸는 것이고, **Pages 프로젝트·커스텀 도메인·배포물은 그대로 유지**된다. 배포물 자체는 토큰과 무관하게 계속 서빙된다.
- 데이터는 D1/R2/Drive에 있고 토큰에 귀속되지 않으므로, 토큰 교체로 메모·설정이 끊기거나 지워지지 않는다. 단, 교체 완료 전까지는 새 배포·Workers 관리 API 호출만 멈춘다.

### 교체 순서 (끊김 없이)
1. 새 토큰을 발급한다 (아래 발급 방법 참조).
2. Secure Vault의 `custom.cloudflare` 커넥터에 새 토큰으로 **교체(reconnect)** 한다. 기존 토큰은 교체 순간까지 유지되므로, 교체 전에 기존 배포물은 계속 동작한다.
3. 교체 직후 `GET /accounts/{플러스트리 계정 ID}/pages/projects/plustree-memo` 조회로 새 토큰 유효성을 확인한다.
4. 확인이 끝나면 정적 재배포 1회로 파이프라인을 검증한다 (`plustree-memo.pages.dev` 200 확인).
5. 기존 토큰은 Cloudflare 대시보드에서 폐기한다 (동일 토큰을 두 곳에서 쓰지 않기 위해).

### 추가 토큰 발급 방법 (jin이 직접, Cloudflare 대시보드)
1. https://dash.cloudflare.com/ 로그인 (plusredjin@gmail.com).
2. 우측 상단 프로필 → **My Profile → API Tokens → Create Token**.
3. **권한 (Account Resources: 플러스트리 계정 `afcc73162112ed35152fe21ff2461cb0` 지정)**:
   - Account: **Cloudflare Pages — Edit**
   - Account: **Workers Scripts — Edit**
   - Account: **Workers KV Storage — Edit**
   - Account: **D1 — Edit**
   - Account: **Workers R2 Storage — Edit**
   - Account: **Account — Read** (계정 목록 조회용; 없으면 ID 직접 지정 우회 가능)
   - (또는 "Edit Cloudflare Workers" 템플릿 + Pages Edit 추가)
4. **TTL(유효기간)**: 지정하지 않음 (만료되면 또 교체해야 한다). IP 제한은 걸지 않는다.
5. 생성 직후 보이는 토큰 값을 **채팅·파일에 붙여넣지 말고** Secure Vault 제출 화면에 입력한다. 토큰은 생성 시 1회만 보인다.

### 제출 방법
- Muse의 Cloudflare 커넥터 reconnect 링크로 새 토큰을 제출한다. 제출은 jin 본인이 Secure Vault 화면에서 직접 입력한다. 토큰 값을 채팅으로 보내면 안 된다.

## 7. jin이 해야 할 일 — Google OAuth 클라이언트 생성

Worker가 Google 로그인을 하려면 jin의 Google 계정으로 OAuth 클라이언트를 만들어야 한다. 대행 불가.

1. https://console.cloud.google.com/ 접속 (나이테에 쓸 Google 계정으로 로그인).
2. 프로젝트 선택/생성 (예: `naite`).
3. **API 및 서비스 → 라이브러리**에서 사용 설정: Google Drive API, Google Calendar API, Google Tasks API, People API.
4. **API 및 서비스 → OAuth 동의 화면**: 앱 이름 `나이테`, 사용자 유형 외부, 테스트 모드 유지 (테스트 사용자에 본인 계정 추가). 범위: `drive.file`, `calendar`, `tasks`, `contacts`(People API 읽기).
5. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션**:
   - 승인된 자바스크립트 원본: `https://naite.plustree.net`
   - 승인된 리디렉션 URI: `https://naite.plustree.net/api/auth/callback` (Worker 배포 후 실제 경로에 맞게 조정 가능 — 배포 시 최종 확정)
6. 발급된 **클라이언트 ID·클라이언트 보안 비밀번호**는 채팅·파일에 올리지 말고, Worker secrets로 직접 등록하거나 Secure Vault 제출 화면으로 전달한다.
7. 참고: 테스트 모드는 사용자 100명 cap, refresh_token 7일 만료. 공개 심사는 나중 단계로 보류 (jin 결정).
