# 나이테 Pages-only 배포 — 아키텍처 및 작업 기록

작성: 2026-11-08 (jin 확정: Pages+Workers로 배포, 개인용·테스트 모드 먼저)
**2026-11-09 갱신 (jin 결정): 배포 방식을 Pages+Workers에서 Pages-only로 전환.
Worker는 미사용(보관용)이다.**

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

## 2. 왜 정적 배포만으로는 안 되는가 (Pages+Workers 시절 기록)

- memoaeb은 web_fullstack이다. 서버 액션(세션, Drive 동기화, 캘린더·Tasks·People API 중계, 첨부파일 저장, 키워드 자동 추출 등)이 Muse 런타임에 있다.
- Pages 정적 호스팅에 올릴 수 있는 것은 클라이언트(UI)뿐이다. 지금 `plustree-memo`에 올라간 `index.html`은 목업이다.
- web_fullstack은 정적 HTML로 내보낼 수 없다. 따라서 Pages에 올릴 프론트엔드는 별도 빌드(정적 클라이언트 재구축)가 필요하다.

## 3. 목표 아키텍처 (Pages-only — 2026-11-09 전환)

```
사용자 (naite.plustree.net)
   └─ Pages (정적 프론트엔드: React 클라이언트 재구축본, frontend/)
        ├─ 브라우저 로컬 저장소 (localStorage): 메모·카테고리·키워드·
        │    온톨로지·사람·장소·설정 — D1 대체 (frontend/src/local-store.ts)
        ├─ Google API 직접 호출: Drive / Calendar / Tasks / People / Geocoding
        │    (frontend/src/google-client.ts, access_token은 AuthProvider가 공급)
        └─ Drive `memo` 폴더: "진실의 원본" 중 하나 (1메모=1파일 JSON, 수동 동기화)
```

Worker는 없다. `worker/` 폴더는 미사용(보관용)이다 — `worker/UNUSED.md` 참조.
Worker API 기능이 어디로 갔는지는 `docs/API_MAPPING.md` 참조.

### 기능 매핑 (memoaeb → Pages-only)

| 현재 기능 | Pages-only에서 |
|---|---|
| Google 로그인 (세션) | 그록 소유 브라우저 OAuth. access_token을 sessionStorage에 보관 (`docs/LOGIN_SEAM.md`) |
| Drive 저장·동기화 | Drive API 직접 호출: `memo` 폴더, 메모 1개=파일 1개, 수동 동기화만 |
| 캘린더 | Calendar API 직접 호출: 일정 생성·조회, 30일 어젠다 |
| 할일 | Tasks API 직접 호출: 체크리스트 동기화, `나이테 메모` 목록 |
| 연락처 | People API 직접 호출: 이름·이메일 검색 → 후보만 반환, 등록한 사람만 저장 |
| 장소 | Geocoding API 직접 호출: 장소 후보 반환 (좌표 불확실 시 null 유지). Maps 키 없으면 미지원 |
| 위치 메타데이터 | 브라우저 Geolocation + 역지오코딩 → 온톨로지 위치 노드 |
| 메모·카테고리·키워드·온톨로지 CRUD | 브라우저 로컬 저장소 (localStorage) |
| 첨부파일 (사진·음성) | Drive memo 폴더에 직접 업로드 (R2 없음, Drive 보기 링크로 대체) |
| AI 온톨로지 왕복 (미리보기·적용·되돌리기) | 브라우저 로컬에서 규칙 기반으로 미리보기·적용·스냅샷 되돌리기. AI 분석은 프롬프트를 사용자가 직접 AI에 붙여넣는 왕복 방식 |
| 분석 대시보드·프롬프트 생성 | 브라우저 로컬 집계 + 프롬프트 템플릿 |
| 백그라운드 동기화 (크론) | **미지원** — 브라우저가 닫히면 동작하지 않는다 |
| 실시간 알림·푸시 | **미지원** — 서버가 없다 |

### 데이터 저장 위치 결정 (Pages-only)

- 메모 본문·관계 그래프: 브라우저 localStorage (단일 사용자·개인용 전제)
- OAuth 토큰: sessionStorage에 access_token만 저장. refresh_token은 브라우저에 저장하지 않는다
- 첨부파일: Drive memo 폴더
- Drive는 그대로 "진실의 원본" 중 하나로 유지 (기존 설계: 메모 1개=Drive 파일 1개)

## 4. Pages-only 한계 (반드시 알아야 할 것)

| 한계 | 내용 |
|---|---|
| 토큰 브라우저 보관 위험 | access_token이 브라우저(sessionStorage)에 있다. 같은 오리진의 스크립트가 읽을 수 있으므로, 서드파티 스크립트 삽입을 하지 않는다. 토큰을 URL·로그·메모 본문에 기록하지 않는다 |
| 토큰 만료 시 재로그인 | refresh_token을 저장하지 않으므로 access_token(약 1시간) 만료마다 다시 로그인해야 한다. 자동 갱신은 없다. 테스트 모드 refresh_token 7일 만료와는 별개 문제다 |
| 백그라운드 동기화 없음 | Drive·Tasks 동기화는 버튼으로 수동 실행만 된다. 앱을 닫으면 동기화되지 않는다 |
| 실시간 알림 없음 | 서버가 없어 푸시·알림을 보낼 주체가 없다 |
| 클라이언트 ID 노출 | Google OAuth 클라이언트 ID는 브라우저 번들에 실린다 (공개 식별자라 허용됨). 단, 클라이언트 보안 비밀번호(client_secret)는 절대 브라우저에 두지 않는다. Maps API 키는 HTTP 리퍼러 제한(naite.plustree.net만 허용)이 필수다 |
| 로컬 저장소 소실 위험 | 브라우저 데이터를 지우면 로컬 메모가 사라진다. Drive에 push한 메모는 Drive에서 다시 가져올 수 있다 |
| 멀티탭 동시 편집 미지원 | localStorage 단일 저장소 전제. 두 탭에서 동시에 고치면 나중 저장이 덮는다 |
| 오프라인 Google API 미지원 | Drive·캘린더·할일·연락처·장소 검색은 온라인에서만 동작. 로컬 메모 작성·편집은 오프라인 가능 |

## 5. 배포 순서 (남은 단계 — 2026-11-09 갱신)

1. **프론트엔드 정적 빌드**: `frontend/` 계획대로 memoaeb 클라이언트를 Pages용 정적 앱으로 재구축. API 경계·핵심 화면(메모 목록·편집기)까지 구현 완료. 나머지 화면은 `frontend/README.md` 체크리스트대로 이식 필요. 로그인 화면은 그록 작업이 들어갈 자리를 비워둔다.
2. **데이터 마이그레이션**: `migration/PLAN.md` 순서대로 Drive `memo` 폴더에서 로컬 저장소로 복원 (앱 안에서 `api.drive.importAll()` 실행, dry-run 먼저, 기존 데이터·설정을 건드리지 않고 별도 검증).
3. **도메인 전환**: `docs/domain-transition.md` 절차대로 `naite.plustree.net`을 Pages(새 프론트엔드)로 연결. `memo.plustree.net`은 전환 완료 전까지 유지.
4. **맨 마지막 — Google OAuth 클라이언트 생성·연결** (jin, 제작이 다 끝나고 나서). 테스트할 때는 실제 OAuth 연결 없이 진행한다.
5. **종단 검증**: 로그인 → 메모 작성 → Drive 저장 → 캘린더·할일·연락처·장소 동작 확인. 다 되면 jin에게 알린다.
6. ~~Worker 배포~~ — Pages-only에서는 하지 않는다 (폐기).
7. ~~D1·KV·R2 생성 및 마이그레이션 적용~~ — Pages-only에서는 하지 않는다 (폐기).

## 6. 지금 막혀 있는 지점 (확인된 사실만)

- **Cloudflare 추가 토큰 불필요** (2026-11-09 jin 정정): jin이 말하는 '토큰'은 Muse 토큰이다. Cloudflare는 무료라 추가 토큰 발급이 필요 없다. 이전 기록의 "추가 토큰 발급" 항목은 폐기한다. 기존 Cloudflare 토큰으로 Pages 배포는 11/08에 확인됐다.
- **로그인 소유 변경** (2026-11-09 jin 결정): 로그인 방식은 그록이 맡는다. 프론트엔드 로그인 화면·`AuthProvider` 구현은 그록 소유이며, 나머지 개발은 건드리지 않는다. 연동 지점은 `docs/LOGIN_SEAM.md` 참조.
- **OAuth 클라이언트 없음**: naite.plustree.net용 Google OAuth 클라이언트는 아직 없다. jin이 맨 마지막에, 제작이 다 끝나고 나서 만든다 (테스트할 때는 실제 OAuth 연결 없이 진행). → **2026-11-10 jin이 클라이언트 ID 제공, Pages 적용·배포 완료 (12절 참조).**
- **프론트엔드 화면 이식 미완료**: API 경계·메모 목록·편집기까지만 구현됐다. 나머지 화면(격자·아웃라인·마인드맵·온톨로지·분석·일정·사람·장소·설정)은 `frontend/README.md` 체크리스트대로 이식 필요.

## 7. 토큰 관련 정정 (2026-11-09 jin)

- jin이 말하는 '토큰'은 **Muse 토큰**이다. Cloudflare는 무료라 추가 토큰 발급이
  필요 없다. 이 절의 이전 내용(Cloudflare 추가 토큰 발급·교체 절차)은 폐기한다.
- Muse 토큰이 떨어지면 추가 Muse 토큰을 쓰는 것은 jin과 Muse 사이의 일로,
  이 배포 작업과는 무관하다.
- 기존 Cloudflare 토큰으로 Pages 배포는 2026-11-08에 확인됐다.

## 8. jin이 해야 할 일 — Google OAuth 클라이언트 생성 (맨 마지막에)

Pages-only에서는 Worker가 Google 로그인을 하지 않는다. 브라우저가 직접
Google OAuth를 하므로, jin의 Google 계정으로 OAuth 클라이언트를 만들어야 한다.
대행 불가. **시점은 맨 마지막, 제작이 다 끝나고 나서** (jin 결정).
테스트할 때는 실제 OAuth 연결 없이 진행한다.

1. https://console.cloud.google.com/ 접속 (나이테에 쓸 Google 계정으로 로그인).
2. 프로젝트 선택/생성 (예: `naite`).
3. **API 및 서비스 → 라이브러리**에서 사용 설정: Google Drive API, Google Calendar API, Google Tasks API, People API.
4. **API 및 서비스 → OAuth 동의 화면**: 앱 이름 `나이테`, 사용자 유형 외부, 테스트 모드 유지 (테스트 사용자에 본인 계정 추가). 범위: `drive.file`, `calendar`, `tasks`, `contacts`(People API 읽기).
5. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션**:
   - 승인된 자바스크립트 원본: `https://naite.plustree.net`
   - 승인된 리디렉션 URI: `https://naite.plustree.net/auth/callback` (브라우저 콜백 — Worker 콜백이 아니다. 그록 구현 시 최종 확정)
6. 발급된 **클라이언트 ID**는 Pages 환경변수 `VITE_GOOGLE_CLIENT_ID`로 등록한다.
   **클라이언트 보안 비밀번호는 브라우저에 두지 않는다** (Pages-only에서는 쓰지 않는다).
   클라이언트 ID·비밀번호를 채팅·파일에 올리지 않는다.
7. 참고: 테스트 모드는 사용자 100명 cap, refresh_token 7일 만료. 공개 심사는 나중 단계로 보류 (jin 결정).
   Pages-only에서는 refresh_token을 저장하지 않으므로 access_token(약 1시간) 만료마다 재로그인이 필요하다.

## 9. 저장소 파일 구조 (2026-11-09 갱신)

```
naite-pages-workers/
  README.md                     # 이 문서 (아키텍처·작업 기록)
  worker/
    UNUSED.md                   # 미사용(보관용) 표시 — 배포하지 않는다
    src/
      index.ts                  # (미사용) Worker 진입점 + 로그인(/api/auth/*, 그록 소유)
      api.ts                    # (미사용) 로그인 외 API 전부 (D1·KV·R2 기반)
      sync.ts                   # (미사용) 크론 백그라운드 동기화 (30분 간격)
    schema.sql                  # (미사용) D1 스키마 0001
    migrations/
      0002_settings_sync.sql    # (미사용) D1 스키마 0002
    wrangler.toml               # (미사용) Worker 설정 — 배포하지 않는다
  frontend/
    README.md                   # 정적 재구축 계획·이식 체크리스트 (Pages-only 갱신)
    package.json                # Vite + React + TypeScript
    vite.config.ts              # base '/', build.outDir 'dist'
    index.html
    src/
      api.ts                    # Pages-only API (로컬 저장소 + Google API 직접 호출)
      local-store.ts            # 브라우저 로컬 저장소 (D1 대체) + 규칙 기반 계산
      google-client.ts          # 브라우저 직접 Google API 호출 (Drive·Calendar·Tasks·People·Geocoding)
      token-store.ts            # sessionStorage 토큰 보관 (access_token만)
      auth-seam.ts              # 인증 경계 (AuthProvider 인터페이스 + 개발용 mock, 그록 소유)
      main.tsx                  # 진입점: AuthProvider 주입 → App
      App.tsx                   # 로그인 게이트·라우팅 (목록/편집기)
      views/
        MemoListView.tsx        # 메모 목록 (검색·카테고리·30개씩·Drive 수동 동기화)
        MemoEditorView.tsx      # 메모 편집기 (단락·체크리스트·키워드 추출·Drive 저장)
      styles.css                # 최소 스타일
  migration/
    PLAN.md                     # 데이터 마이그레이션 계획 (Drive → 로컬 저장소, Pages-only 갱신)
    migrate.ts                  # (미사용) Worker 시절 스크립트 틀 — 기록용
  docs/
    LOGIN_SEAM.md               # 로그인 연동 지점 (Pages-only 갱신, 그록 소유 구간 정의)
    domain-transition.md        # 도메인 전환 절차 (Pages-only 갱신, 실행 전)
    API_MAPPING.md              # Worker API → Pages-only 대응표 (신규)
```

## 10. 진행 상황 (2026-11-09)

| 항목 | 상태 |
|---|---|
| Worker 로그인 외 API (`worker/src/api.ts`) | **미사용(보관용)** — 기능은 브라우저로 이식됨 (`docs/API_MAPPING.md`) |
| Worker 크론 동기화 (`worker/src/sync.ts`) | **미사용(보관용)** — Pages-only 미지원 |
| D1 스키마 0001·0002 | **미사용(보관용)** — 로컬 저장소로 대체 |
| 프론트엔드 API 경계 (`frontend/src/api.ts` 등) | **완료 (Pages-only로 교체)** — 로컬 저장소 + Google API 직접 호출 |
| 프론트엔드 화면 이식 (Vite 앱·UI) | **부분 완료** — 메모 목록·편집기 구현, 빌드·타입체크 통과 (아래 참조). 나머지 화면은 체크리스트로 남음 |
| 마이그레이션 계획 | **갱신 완료** (Drive → 로컬 저장소). 실행은 OAuth 연결 후 앱 안에서 |
| 도메인 전환 절차서 | **갱신 완료** (Pages-only). 실행은 전환 조건 충족 후 |
| Worker 배포 (`wrangler deploy`) | **하지 않음** — Pages-only에서는 폐기 |
| Google OAuth 클라이언트 | **적용 완료 (2026-11-10)** — jin이 클라이언트 ID 제공, Pages 빌드에 주입·배포 완료 (12절). 실제 Google 로그인은 jin이 직접 테스트 |
| 로그인 (`AuthProvider`, 브라우저 OAuth) | 그록 소유 — 진행 상황 별도 확인 필요 |

## 11. 로그인 적용 (2026-11-09, 그록 브랜치 `grok/login-consent-guide` → main 적용)

- 가져온 커밋: `127fbf94` "feat(auth): 로그인·동의 안내 UI와 OAuth 콜백 처리" (main `a084e140` 기반).
- 적용 파일: `frontend/src/LoginGuide.tsx`(신규), `frontend/src/App.tsx`, `frontend/src/auth-seam.ts`, `frontend/src/main.tsx`, `frontend/src/styles.css`, `docs/LOGIN_SEAM.md`, `docs/GOOGLE_CONSENT_GUIDE.md`(신규), `frontend/public/_redirects`(신규, SPA 폴백 `/* /index.html 200`), `frontend/scripts/auth-callback-selftest.mjs`(신규), `frontend/package-lock.json`(신규), `.gitignore`(신규).
- 내용: 로그인 게이트에 권한 안내(LoginGuide)·더하기나무 footer, OAuth 콜백 해시 처리(state 검증·에러 처리·해시 제거), 로그인 시 `prompt=consent` + `include_granted_scopes=true`, `saveTokenFromCallbackHash` 반환값 boolean → `CallbackResult` 변경, `isGoogleClientConfigured()` 추가. Google 공식 동의 화면은 흉내 내지 않음.
- 충돌 없음: 로그인 외 파일(Worker·migration·api.ts·google-client.ts·local-store.ts·token-store.ts)은 브랜치와 동일해서 건드리지 않음.
- 주의: `saveTokenFromCallbackHash` 반환 타입이 바뀌어, 옛 boolean 사용처가 있으면 수정 필요 (현재 코드베이스에는 없음). selftest는 실제 함수를 import하지 않고 로직 복사본을 테스트함.

## 12. Google OAuth 클라이언트 ID 적용 (2026-11-10, jin 제공)

- jin이 클라이언트 ID 제공: `551200708040-kanrdsov8059e2rt41hrif52tk63i75f.apps.googleusercontent.com` (공개 식별자라 JS 번들에 실려도 됨. client_secret은 브라우저에 절대 두지 않음 — jin이 준 적도 없고 만들지도 않음).
- 적용 방식 (두 가지 병행):
  1. **빌드 시점 주입 (실제 배포에 사용)**: `VITE_GOOGLE_CLIENT_ID=<ID> npm run build` — Vite가 `import.meta.env.VITE_GOOGLE_CLIENT_ID`를 번들에 인라인한다. 직접 업로드 배포라 Pages 빌드 환경변수는 빌드에 영향을 주지 않으므로 이 방식이 필수.
  2. **Pages 프로젝트 환경변수 등록**: Cloudflare API로 `plustree-memo` 프로젝트의 production·preview `deployment_configs.env_vars`에 `VITE_GOOGLE_CLIENT_ID` 등록 완료 (나중에 Git 연동 빌드로 바꿀 때 사용).
- 빌드·배포: `tsc --noEmit` + Vite 빌드 통과 (JS 184.93KB, 번들에 클라이언트 ID 포함 확인). Pages 배포 `d7b6b43f` success (2026-11-09 23:28 UTC).
- 확인 (2026-11-10): `naite.plustree.net`·`memo.plustree.net` 모두 새 앱 서빙, 로그인 안내(LoginGuide) 화면에서 "클라이언트 ID가 아직 없습니다" 안내가 사라짐 → `isGoogleClientConfigured()=true`, "Google로 로그인" 버튼 활성화 상태. 배포된 JS 번들에 클라이언트 ID 인라인 확인. 실제 Google 로그인 완료까지는 테스트하지 않음 (jin이 직접).
- 리디렉션: 로그인 버튼을 누르면 `https://accounts.google.com/o/oauth2/v2/auth`로 이동, `redirect_uri`는 접속 도메인 기준 `https://naite.plustree.net/auth/callback` (코드상 `window.location.origin + "/auth/callback"`). **주의: Google Cloud 콘솔에 해당 리디렉션 URI와 승인된 자바스크립트 원본(`https://naite.plustree.net`)이 등록돼 있어야 로그인이 성공한다.** 콘솔 등록 여부는 여기서 확인할 수 없으니, 로그인 시 `redirect_uri_mismatch` 오류가 나면 콘솔 설정을 먼저 확인할 것. `memo.plustree.net`에서 로그인하면 리디렉션 URI가 `https://memo.plustree.net/auth/callback`이 되므로, 그 도메인으로 로그인하려면 콘솔에 해당 URI도 등록해야 한다.
