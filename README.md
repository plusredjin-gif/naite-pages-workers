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

## 4. 배포 순서 (남은 단계 — 2026-11-09 갱신)

1. **프론트엔드 정적 빌드**: `frontend/` 계획대로 memoaeb 클라이언트를 Pages용 정적 앱으로 재구축 (artifact 빌더로 진행, 기존 Muse 앱은 유지). 로그인 화면은 그록 작업이 들어갈 자리를 비워둔다.
2. **Worker 배포**: `worker/`를 `wrangler deploy`로 배포, `api.naite.plustree.net` 커스텀 도메인 연결.
3. **D1·KV·R2 생성 및 마이그레이션 적용**, secrets 등록 (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_MAPS_API_KEY`).
4. **데이터 마이그레이션**: `migration/PLAN.md` 순서대로 Drive `memo` 폴더에서 D1/R2로 복원 (dry-run 먼저, 기존 데이터·설정을 건드리지 않고 별도 검증).
5. **도메인 전환**: `docs/domain-transition.md` 절차대로 `naite.plustree.net`을 Pages(새 프론트엔드)로, API를 Worker로 연결. `memo.plustree.net`은 전환 완료 전까지 유지.
6. **맨 마지막 — Google OAuth 클라이언트 생성·연결** (jin, 제작이 다 끝나고 나서). 테스트할 때는 실제 OAuth 연결 없이 진행한다.
7. **종단 검증**: 로그인 → 메모 작성 → Drive 동기화 → 캘린더·할일·연락처·장소 동작 확인. 다 되면 jin에게 알린다.

## 5. 지금 막혀 있는 지점 (확인된 사실만)

- **Cloudflare 추가 토큰 불필요** (2026-11-09 jin 정정): jin이 말하는 '토큰'은 Muse 토큰이다. Cloudflare는 무료라 추가 토큰 발급이 필요 없다. 이전 기록의 "추가 토큰 발급" 항목은 폐기한다. 기존 Cloudflare 토큰으로 Pages 배포는 11/08에 확인됐다.
- **로그인 소유 변경** (2026-11-09 jin 결정): 로그인 방식은 그록이 맡는다. `worker/src/index.ts`의 `/api/auth/*` 구간과 프론트엔드 로그인 화면은 그록 소유이며, 나머지 개발은 건드리지 않는다. 연동 지점은 `docs/LOGIN_SEAM.md` 참조.
- **OAuth 클라이언트 없음**: naite.plustree.net용 Google OAuth 클라이언트는 아직 없다. jin이 맨 마지막에, 제작이 다 끝나고 나서 만든다 (테스트할 때는 실제 OAuth 연결 없이 진행).
- **프론트엔드 정적 빌드 없음**: memoaeb에서 추출할 정적 번들이 없다. `frontend/README.md` 계획대로 재구축이 필요하다.

## 6. 토큰 관련 정정 (2026-11-09 jin)

- jin이 말하는 '토큰'은 **Muse 토큰**이다. Cloudflare는 무료라 추가 토큰 발급이
  필요 없다. 이 절의 이전 내용(Cloudflare 추가 토큰 발급·교체 절차)은 폐기한다.
- Muse 토큰이 떨어지면 추가 Muse 토큰을 쓰는 것은 jin과 Muse 사이의 일로,
  이 배포 작업과는 무관하다.
- 기존 Cloudflare 토큰으로 Pages 배포는 2026-11-08에 확인됐다. Workers/D1/R2
  배포는 `wrangler`로 직접 하거나, 권한이 부족하면 그때 jin에게 알린다.

## 7. jin이 해야 할 일 — Google OAuth 클라이언트 생성 (맨 마지막에)

Worker가 Google 로그인을 하려면 jin의 Google 계정으로 OAuth 클라이언트를 만들어야 한다. 대행 불가. **시점은 맨 마지막, 제작이 다 끝나고 나서** (jin 결정). 테스트할 때는 실제 OAuth 연결 없이 진행한다.

1. https://console.cloud.google.com/ 접속 (나이테에 쓸 Google 계정으로 로그인).
2. 프로젝트 선택/생성 (예: `naite`).
3. **API 및 서비스 → 라이브러리**에서 사용 설정: Google Drive API, Google Calendar API, Google Tasks API, People API.
4. **API 및 서비스 → OAuth 동의 화면**: 앱 이름 `나이테`, 사용자 유형 외부, 테스트 모드 유지 (테스트 사용자에 본인 계정 추가). 범위: `drive.file`, `calendar`, `tasks`, `contacts`(People API 읽기).
5. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션**:
   - 승인된 자바스크립트 원본: `https://naite.plustree.net`
   - 승인된 리디렉션 URI: `https://naite.plustree.net/api/auth/callback` (Worker 배포 후 실제 경로에 맞게 조정 가능 — 배포 시 최종 확정)
6. 발급된 **클라이언트 ID·클라이언트 보안 비밀번호**는 채팅·파일에 올리지 말고, Worker secrets로 직접 등록하거나 Secure Vault 제출 화면으로 전달한다.
7. 참고: 테스트 모드는 사용자 100명 cap, refresh_token 7일 만료. 공개 심사는 나중 단계로 보류 (jin 결정).

## 8. 저장소 파일 구조 (2026-11-09 갱신)

```
naite-pages-workers/
  README.md                     # 이 문서 (아키텍처·작업 기록)
  worker/
    src/
      index.ts                  # Worker 진입점 + 로그인(/api/auth/*, 그록 소유)
      api.ts                    # 로그인 외 API 전부 (카테고리·메모·키워드·온톨로지·
                                #   사람·장소·위치·캘린더·할일·Drive·첨부·분석·설정)
      sync.ts                   # 크론 백그라운드 동기화 (30분 간격)
    schema.sql                  # D1 스키마 0001 (기존)
    migrations/
      0002_settings_sync.sql    # D1 스키마 0002 (settings·sync_state)
    wrangler.toml               # naite-api Worker 설정 (D1·KV·R2 바인딩, 크론)
  frontend/
    README.md                   # 정적 재구축 계획·이식 체크리스트
    src/
      api.ts                    # Worker API 타입 클라이언트
      auth-seam.ts              # 인증 경계 (AuthProvider 인터페이스 + 개발용 mock)
  migration/
    PLAN.md                     # 데이터 마이그레이션 계획 (Drive → D1/R2)
    migrate.ts                  # 마이그레이션 스크립트 틀 (기본 dry-run)
  docs/
    LOGIN_SEAM.md               # 로그인 연동 지점 (그록 소유 구간 정의)
    domain-transition.md        # 도메인 전환 절차 (실행 전)
```

## 9. 진행 상황 (2026-11-09)

| 항목 | 상태 |
|---|---|
| Worker 로그인 외 API (`api.ts`) | 구현 완료 (코드 기준, 배포 전) |
| Worker 크론 동기화 (`sync.ts`) | 구현 완료 (토큰 연결 후 동작) |
| D1 스키마 0001·0002 | 완료 |
| 프론트엔드 API 클라이언트·인증 경계 | 완료 (`frontend/src/api.ts`, `auth-seam.ts`) |
| 프론트엔드 화면 이식 (Vite 앱·UI) | 미착수 — `frontend/README.md` 계획대로 진행 필요 |
| 마이그레이션 스크립트 틀 | 완료 (실행은 OAuth 연결 후) |
| 도메인 전환 절차서 | 완료 (실행은 전환 조건 충족 후) |
| Worker 배포 (`wrangler deploy`) | 미실시 — OAuth 클라이언트·D1/KV/R2 생성 후 |
| Google OAuth 클라이언트 | 미생성 — jin이 맨 마지막에 생성 |
| 로그인 (`/api/auth/*`, `/api/auth/me`) | 그록 소유 — 진행 상황 별도 확인 필요 |
