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
4. **API 및 서비스 → OAuth 동의 화면**: 앱 이름 `나이테`, 사용자 유형 외부, 테스트 모드 유지 (테스트 사용자에 본인 계정 추가). 범위(최소 범위, 2026-11-10 심사 대응): `drive.file`(이 앱이 만든 파일 + 사용자가 파일 선택기로 열어준 파일만), `calendar.events`(일정만), `tasks`, `contacts.readonly`(People API 읽기). 제한된 범주인 `drive`(전체)와 `calendar`(전체)는 쓰지 않는다. 심사 제출 자료는 `docs/VERIFICATION.md` 참조.
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
| 프론트엔드 화면 이식 (Vite 앱·UI) | **이식 완료 (2026-11-10, 13절)** — 원본(memoaeb) 전 화면을 Pages 정적판으로 이식: 히어로·동의·격자·목록·아웃라인·마인드맵·온톨로지·분석·일정·사람·장소·설정·편집기(업그레이드). 빌드·타입체크 통과, Pages 재배포 완료. 일부 원본 기능은 Pages-only 한계로 미이식 (13절 참조) |
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

## 13. 원본 풀스택 이식 — 전 화면 Pages 정적판으로 (2026-11-10, jin 방향 정정)

- jin 확인 (2026-11-10): 원본 풀스택 나이테(memoaeb, v32)에 로그인만 넣는 게 아니라, 원본 화면·기능을 Pages 배포판에 그대로 옮기는 게 맞다. 메모 목록·편집기만 있던 부분 완성 상태에서 전 화면 이식으로 방향 정정.
- 원본 기능 목록: `artifact.inspect` (inspection_id `7fdc40a9-32d9-44ad-9a59-88f4bf22055d`)로 소스 기준 전수 확인 — 5개 주 보기(격자·목록·아웃라인·마인드맵·온톨로지·분석 통합) + 4개 왼쪽 메뉴 보기(일정·사람·장소·설정) + 3개 모달/관리 화면(카테고리·키워드 관리·가져오기). 서버 액션 57개는 에이전트 브리지 구조라 화면만 옮길 수 없어, Google 연동·동기화 실행 주체를 브라우저 직접 호출로 다시 설계함 (`frontend/src/api.ts`·`google-client.ts`).

### 이식된 것
- **히어로·동의**: 원본 헤드라인 '생각나는 순간, 바로 남기는 메모', 주전자 drawing 캐릭터(이젤 앞에서 붓으로 로고 그리는 장면), 시연용 예시 카드 3종, 기능 소개 10개. 로그인 전 히어로 → 동의 안내(LoginGuide) 2단계.
- **브랜드 자산 (원본 그대로 복사)**: `naite-logo.png`(손그림 동심원 결 + 붓글씨 naite), 한글 '나이테'(테만 주황 #e8590c), 주전자 7종(drawing/wave/laugh/good/sleep/best/cheer) + 6초 영상, 더하기나무 로고는 하단 푸터에만(plustree.net 링크). 한컴 말랑말랑체(눈누 미러 jsDelivr CDN, Regular/Bold).
- **격자 보기**: 제목 줄 순서 [전체 기간 → 최근 수정순], 파스텔 MemoCard(키워드/사람/장소/위치 칩·카테고리 경로·수정일·할 일 n/m·Drive 배지), 30개씩 더 보기.
- **목록 보기**: 기존 목록 뷰 유지(검색·카테고리 필터·30개씩 페이징). 가상 스크롤은 미이식(아래 참조).
- **아웃라인**: 카테고리>하위>메모 접힌 트리, 고정됨·미분류 포함, 카테고리별 20개씩 더 보기, 검색 시 해당 경로 자동 펼침.
- **마인드맵**: 카테고리 트리(depth 1 펼침, 메모 10개 초과 묶음 노드), 줌·100%·가운데로·미니맵·노드 검색 이동, 메모 노드→편집기.
- **온톨로지·분석 (하나의 메뉴, 탭 전환)**: 허브(키워드·사람·장소·위치)×메모 다대다 그래프(신장 트리+점선 추가 간선), 종류·관계·깊이 1~2단계 토글, 중심 노드 이웃 표시, 상세 패널, 키워드 관리(상위 다중 선택·관련 연결·잠금 토글). 분석 대시보드: 통계 4개(전체 연결·연결된 메모·중심 키워드·고립 메모), 중심 키워드 상위 5개, AI 프롬프트 생성·복사, 키워드 관계도·사람 장소 위치 시간 관계도, 고립 메모 목록, AI JSON 왕복(붙여넣기→미리보기→적용→적용 기록 되돌리기).
- **일정**: 캘린더 아젠다 30일 날짜별 그룹, 마지막 불러오기 시각, 일정 불러오기, 일정 만들기(메모 연결), 할 일 목록 조회·동기화.
- **사람**: 연락처 검색 후보 최대 10명·개별 등록(전체 가져오기 없음), 등록한 사람 목록·연결 메모 수·필터, 직접 추가.
- **장소**: Google 지도 embed(키 없이 `output=embed`)·열기/길찾기 링크, 장소 목록·상세·연결 메모, 메모를 쓴 위치 목록. 좌표 없는 장소는 지도 제외. 원본의 HatchMaps 런타임 대신 Google embed 사용(대체).
- **설정**: 계정·Drive(memo 폴더·Drive 전체 범위)·동기화(상태·마지막 시각·지금 동기화·Drive에서 불러오기)·캘린더/Tasks/연락처/장소/현재 위치 토글·카테고리 관리.
- **편집기 (업그레이드)**: 제목·쓰기/미리보기(MD 간이 렌더링)·고정·삭제 2단계·새 메모 빈 단락 1개, 블록 이동·삭제, 체크리스트 마감일·Tasks 동기화 버튼, 사진 첨부(Drive 업로드·표시), 음성 블록(MediaRecorder 녹음·Drive 저장·재생), 말해서 단락 추가(Web Speech API ko-KR), 일정 패널(날짜·시간·종일→캘린더 생성, 이 메모의 일정 표시), 키워드 칩+추가·삭제, 사람·장소 연결, 현재 위치 저장·지우기, 카테고리·카드 색상 7종, 가져오기 모달(md/txt/html 파일·붙여넣기), 빈 새 메모 닫으면 자동 삭제.
- **api.ts 추가**: 사람·장소 연결(linkPerson/unlinkPerson/linkPlace/unlinkPlace), 위치 지우기(clearGeo), 키워드 추가·삭제(addKeyword/removeKeyword), 마크다운·HTML 가져오기(importText), 키워드 삭제·이름변경(keywords.remove/rename), 첨부 1건 조회(attachments.get — 사진·음성 블록 재표시용).

### 아직 안 된 것 (솔직 정리) — 2026-11-11 기준, 19절에서 6개 항목 완료
- **목록 보기 가상 스크롤**: 완료 (19절). 100개씩 전체 로드 후 가상 스크롤 렌더링, 행 높이 96px·오버스캔 5행·최대 5000개.
- **체크리스트 하위 할 일**: 완료 (19절). 하위 할일 생성·완료·삭제, 상위 삭제 시 연쇄 삭제, Google Tasks `parent` 연결.
- **일정 삭제·알림**: 완료 (19절). 일정 삭제(2단계 확인)·알림 시간(없음·5/10/15/30분·1시간) 설정, 캘린더 팝업 알림.
- **장소 검색 API 키**: 완료 (19절). 설정에 저장한 Google API 키(`naite.google.api_key.v1`)를 장소 검색·역지오코딩에 연결. 키 없으면 설정 안내.
- **키워드 자동 추출 품질**: 완료 (19절). 조사·어미 제거 원형화 + 불용어 확대 + NO_STRIP_WORDS 예외 목록. 원본은 서버 모델 추론이라 품질이 완전히 같지는 않음 — 로컬 규칙 기반의 한계.
- **동기화·알림**: 앱이 열려 있는 동안 주기적 자동 동기화 완료 (19절, 기본 5분·설정 토글). **백그라운드(앱 닫힌 상태) 동기화·실시간 알림은 Pages-only 구조상 안 된다** — 서버·크론이 없어서, 앱을 닫으면 동기화가 멈춘다. access_token(약 1시간) 만료마다 재로그인.
- **바이너리 에셋 GitHub 미반영**: 스냅샷 푸시는 UTF-8 텍스트만 가능해서 `frontend/public/assets/`의 PNG·MP4·HatchMaps JS는 GitHub에 올라가지 않음. Pages 배포(로컬 dist 직접 업로드)에는 포함돼 정상 동작하지만, 저장소만 새로 받으면 로고·주전자 이미지가 없음. 필요하면 별도 경로로 올려야 함.

### 빌드·배포·확인 (2026-11-10)
- 빌드: `VITE_GOOGLE_CLIENT_ID=551200708040-kanrdsov8059e2rt41hrif52tk63i75f.apps.googleusercontent.com npm run build` — `tsc --noEmit` + Vite 통과 (JS 285.43KB, CSS 14.46KB, 번들에 클라이언트 ID 인라인 확인).
- 배포: Pages `plustree-memo` 직접 업로드, 배포 `b1362bf9` (2026-11-09 23:43 UTC, 22개 파일).
- 확인: `naite.plustree.net`·`memo.plustree.net` 모두 새 JS 번들(`index-UiDz_r8B.js`)을 서빙 — 로컬 빌드와 MD5 일치(`8025551b3be75d3cc471b3a1e90c5303`), 번들에 클라이언트 ID 포함. 새 배포 URL 크롤에서 새 히어로 확인(실제 로고·원본 헤드라인·drawing 주전자·예시 카드 3종·기능 10개). 로고·주전자 이미지 200 확인.
- 로그인 버튼: 히어로 "Google로 로그인" → 동의 안내 → 동의 안내의 "Google로 로그인" 버튼은 `isGoogleClientConfigured()=true`라 활성화 상태(비활성화 조건은 클라이언트 ID 미설정뿐). 실제 Google 로그인 완료까지는 테스트하지 않음 — jin이 직접. `redirect_uri_mismatch`가 나면 12절의 콘솔 등록(리디렉션 URI·JS 원본) 확인.

## 14. 원본과 맞추기 — Drive 가져오기·검색·카테고리 칩·키워드 메뉴 (2026-11-10)

- jin 지시: "개발한거와 다르네 개발된 것으로 업데이트 해줘" — 배포판이 원본과 달라 보인다는 지적. 원본(memoaeb v32)과 배포판 대조 결과, 고친 것:
  1. **메모 0개 (데이터)**: 배포판이 요청하던 `drive.file` 범위는 "이 앱이 만든 파일만" 볼 수 있어서, 원본 앱이 Drive memo 폴더에 만든 메모 파일이 안 보였다. 요청 범위를 `drive`(Drive 전체 읽기·쓰기)로 변경. 앱은 memo 폴더 외의 파일은 열지 않는다. 기존 토큰은 `drive.file` 범위라 원본 메모가 안 보이므로, 로그인 시 스코프를 확인해 부족하면 "다시 로그인" 안내를 띄운다. (재로그인해야 새 범위로 동의받는다.)
  2. **첫 로그인 자동 가져오기**: 로그인 후 로컬 메모가 비어 있으면 Drive memo 폴더에서 1회 자동 가져오기(`importAll`) 후 결과 알림. 이미 가져온 적 있으면(`drive_first_import_done`) 다시 안 한다. jin의 Drive 데이터를 지우거나 덮어쓰지 않는다 — 읽기 전용 원본에서 로컬로 복원하는 방식.
  3. **memo 폴더 여러 개 대응**: `drive.file` 시절 Pages 앱이 빈 memo 폴더를 새로 만든 경우가 있어, 이름이 `memo`인 폴더가 여러 개면 메모 JSON 파일이 가장 많은 폴더를 원본으로 쓴다. 파일 목록은 페이지네이션으로 최대 1000개까지 읽는다.
  4. **상단 검색창**: 원본처럼 헤더(로고 옆)에 검색창을 두고 격자·목록 보기와 공유. 목록 보기의 자체 검색 입력은 제거.
  5. **카테고리 칩**: 격자 보기에 전체·고정됨·미분류·카테고리 아이콘 칩 줄 추가 (모바일은 아이콘만). `api.memos.list`에 고정됨·미분류(`__none__`) 필터 추가.
  6. **키워드 메뉴**: 왼쪽 메뉴에 키워드(#) 추가 — 온톨로지 화면의 키워드 관리 카드로 스크롤해 이동한다.
  7. **빈 화면**: 메모가 0개일 때 "Drive에서 가져오기" 버튼을 빈 화면에도 추가.
- 동의 안내(LoginGuide)·문서(`docs/GOOGLE_CONSENT_GUIDE.md`, `docs/LOGIN_SEAM.md`, README 8절)의 범위 설명도 `drive` 전체로 업데이트. Worker는 미사용 보관 상태라 건드리지 않음.
- **주의**: OAuth 동의 화면의 범위(스코프) 변경은 Google Cloud 콘솔에서 동의 화면 범위에 `drive`가 등록돼 있어야 동의가 뜬다. 이미 `drive.file`로 동의한 계정은 다시 로그인해야 새 범위가 적용된다.
- **18절에서 뒤집힘**: 2026-11-10 jin 결정으로 심사받기 쉽게 `drive`(전체) 범위를 제거하고 `drive.file`로 되돌렸다. 원본 메모 가져오기는 Drive 파일 선택기(Picker)로 사용자가 직접 고르는 방식으로 바꿨다. 14절의 전체 범위 결정은 폐기.

## 15. 원본 레이아웃으로 맞추기 — 사이드바 섹션·제목 줄·보기 pill·온톨로지 통합 (2026-11-10)

- jin 정정: "메모 내용을 이야기 하는 것이 아니라 UI UX 모양이 다른데" — 메모 내용이 아니라 레이아웃이 원본과 다르다는 지적. 14절에서 검색·칩·키워드 메뉴를 넣었지만 사이드바가 여전히 납작한 메뉴 목록이었다.
- 원본(memoaeb v32, jin 스크린샷 기준)과 대조해 배포판 셸을 통째로 바꿈:
  1. **사이드바 섹션 구조**: 납작한 보기 전환 메뉴(격자·목록·아웃라인·마인드맵·온톨로지·분석·일정·사람·장소·설정) 제거 → 보기(전체 메모·개수·고정됨·미분류·사람·장소·키워드·일정) / 카테고리(관리 + 카테고리 목록, 하위 카테고리 들여쓰기) / 키워드(관리 + #키워드) / 장소 섹션으로.
  2. **제목 줄**: "전체 메모" 왼쪽 + "전체 기간"·"최근 수정순" 오른쪽 같은 줄 (격자·목록 보기에서만 기간·정렬 선택 표시, 아웃라인·마인드맵·온톨로지·분석은 제목만).
  3. **보기 전환 pill 줄**: 본문 제목 아래로 이동 — 격자(검정 pill)·목록·아웃라인·마인드맵·온톨로지·분석.
  4. **온톨로지·분석 통합**: "온톨로지 그래프"/"분석 대시보드" 분리 탭 버튼 제거 — 온톨로지 그래프 아래 분석 대시보드가 같은 화면에 이어짐 (원본과 동일).
  5. **메모 격자 카드**: "전체" 필터일 때 "고정됨" 섹션(고정 메모) + "메모" 섹션으로 나눠 표시, 미리보기 6줄로 길게.
  6. **하단**: 가져오기·설정·로그아웃을 사이드바 하단 회사 로고(더하기나무) 옆으로 이동. 본문 하단 푸터는 제거(중복 방지).
  7. **공용 필터 모듈** `frontend/src/views/memoFilters.ts` 신규: 기간·정렬·사이드바 필터(전체·고정됨·미분류·카테고리·키워드) 정의를 격자·목록 보기가 공유. `api.memos.list`에 `keywordId` 필터 추가.
  8. **레이아웃 폭**: 로그인된 셸은 860px → 1240px로 넓힘 (원본처럼).
- **검증 (2026-11-10, 실제 렌더링)**: 프로덕션 번들은 로그인 뒤라 직접 못 열어서, mock 인증 빌드(`VITE_AUTH_MOCK=true`, 프로덕션 dist와 별도 `dist-mock`)를 로컬 Chromium 대신 jsdom + esbuild IIFE 번들로 렌더링. 원본 스크린샷과 같은 데모 데이터(메모 5개·카테고리 7개·키워드 #가나다·장소 성남)를 localStorage에 심고 DOM·상호작용 전수 확인: 사이드바 4개 섹션·보기 항목·카테고리 7개·#가나다·성남, 제목 "전체 메모"·기간·정렬, pill 5개(격자 활성), 고정됨/메모 섹션 + 카드 5개, 고정됨 클릭→제목 "고정됨"·카드 1개, 목록 pill→5개, 온톨로지·분석→온톨로지+분석 h2 동시 표시·키워드 관리 카드 있음·분리 탭 없음, 키워드 클릭→"#가나다"·카드 1개, 카테고리 개인 클릭→"개인"·카드 1개, 설정→설정 화면. JS 에러 0건. (참고: VM의 meta-chromium은 Hatch WebGL 도메인 정책이 필요해 직접 실행이 안 돼서 jsdom으로 검증했고, 최종 눈으로 보는 확인은 jin 폰에서.)
- 빌드: `tsc --noEmit` + Vite 통과 (JS 292.08KB). 배포: Pages `plustree-memo` 직접 업로드, 배포 `5a12ec5c`. 확인: `naite.plustree.net`·`memo.plustree.net`·`plustree-memo.pages.dev` 모두 새 번들(`index-CihaxVhG.js`) 서빙.
- 남은 것: 위 6개 항목은 2026-11-11 19절에서 완료 (13절 갱신).

## 16. 아이콘 모양 맞추기 — 보기 pill·사이드바 모바일 아이콘 (2026-11-10)

- jin 지적 (2026-11-10 20:50, 스크린샷 2장): "아이콘 모양이 다르데?" — 배포판에 동그란 원형 아이콘 버튼 줄이 보임.
- 원인: 스크린샷 2의 원형 아이콘 버튼 2줄(보기 전환·카테고리)은 구 배포(9b153370, 14절 시절)의 `.view-chips`/`.cat-chips` 아이콘 전용 버튼. 현행 코드(5a12ec5c)에는 그 줄이 이미 없었으나 죽은 CSS가 남아 있었고, 별개로 실제 차이 2가지가 있었다: ① 보기 pill이 모든 폭에서 단어를 보여 원본 규칙(lg 미만 아이콘만)이 안 지켜짐 ② 사이드바 전체·고정됨·미분류는 아이콘이 없어 모바일 아이콘 행에서 개수 "1"만 보이거나 빈 버튼이 됨.
- 고친 것 (`frontend/src/App.tsx`·`frontend/src/styles.css`):
  1. **보기 전환 pill**: 단어에 `.pill-label` 추가, lg 미만(1023px)에서 단어 숨김 → 데스크톱 아이콘+단어 pill, 모바일 아이콘만. 아이콘만 남을 때는 패딩 유지 캡슐 형태라 동그란 원형 버튼이 아니다.
  2. **사이드바 모바일 아이콘**: 전체·고정됨·미분류에 모바일 전용 아이콘 추가(▦/📌/📁) — 데스크톱에서는 아이콘 없음(원본과 동일), 모바일(640px 이하) 아이콘 행에서만 표시. 모바일에서 개수(`nav-count`)는 숨김.
  3. **죽은 CSS 제거**: `.view-chips`/`.cat-chips` (구 원형 버튼을 만들던 클래스) 전부 삭제. 현행 코드에서 쓰는 곳이 없어 렌더링 변화 없음.
  4. 사람·장소·일정 화면: 원형(50%) 버튼 없음 확인 (사람 화면 버튼 0건).
- 검증 (jsdom + esbuild IIFE mock 빌드, 데모 데이터 동일): pill 5개 전부 아이콘+단어, 보기 메뉴 모바일 아이콘 ▦/📌/📁, 카테고리 7개 아이콘, 원형 칩 줄(`.view-chips`/`.cat-chips`) 0개, 사람 화면 이동·표시 정상, JS 에러 0건. 빌드 CSS에서 1023px pill-label 숨김·640px nav-icon-mobile 표시·nav-count 숨김 규칙 확인 (참고: minifier가 nav-count 규칙을 `.side-foot`과 합쳐 `.side-nav .nav-count,.side-foot{display:none}`로 만듦 — 규칙 존재 확인됨).
- 빌드: `tsc --noEmit` + Vite 통과 (JS 292.36KB). 배포: Pages `plustree-memo` 직접 업로드, 배포 `c551967e`. 확인: `naite.plustree.net`·`memo.plustree.net`·`plustree-memo.pages.dev` 모두 새 번들(`index-C4RLsUAk.js`) 서빙, 라이브 JS에 `view-chips`/`cat-chips` 없음.
- 주의: jin 스크린샷이 구 번들 캐시일 수 있다 — 새 버전 확인은 강력 새로고침(캐시 비우기) 후에 해달라고 전달.
- 열린 점: 편집기 하단 도구 모음은 아이콘+단어 버튼 그대로 둠. 원본 19:42 규칙은 44px 원형 아이콘 버튼인데 이번 지시(pill+단어 방향)와 달라 건드리지 않음 — jin이 편집기 도구 모음도 원본처럼 원형 아이콘으로 바꾸길 원하면 별도로.

## 17. 동그란 라인 아이콘 일관 적용 + 말랑말랑체 폰트 (2026-11-10)

- jin 정정 (2026-11-10): 동그란 라인 아이콘 디자인이 좋다. 16절에서 유니코드·이모지 아이콘으로 바꾼 방향을 되돌리고, 동그란 원형 라인 아이콘 스타일을 유지해 앱 전체에 일관되게 적용한다.
- **라인 아이콘** (`frontend/src/components/LineIcon.tsx` 신규): 24×24 viewBox, fill 없음, stroke currentColor, 두께 2의 SVG 라인 아이콘 31종 (격자·목록·아웃라인·마인드맵·온톨로지·전체·고정·폴더·사람·장소·해시·캘린더·서류가방·전구·펜·별·집·나무·카메라·음악·체크·검색·메시지·책·차·설정·다운로드·로그아웃·더하기·텍스트·이미지·마이크·태그). `.round-icon` 배지: 30px 원형 테두리(1.5px, currentColor) + 안쪽 17px 라인 SVG. 사이드바는 28px.
- **일관 적용한 곳**:
  1. 보기 전환 pill 5개: 원형 아이콘 + 단어 (데스크톱), lg 미만(1023px)에서는 단어 숨김 → 아이콘만 (모바일 버튼 패딩 축소).
  2. 사이드바 메뉴 16개 행: 보기(전체·고정됨·미분류·사람·장소·키워드·일정) + 카테고리 7개 + 키워드 + 장소 — 전부 원형 라인 아이콘 + 단어. 모바일 아이콘 행에서는 아이콘만.
  3. 카테고리 칩: 카테고리 관리 아이콘 선택 18종을 원형 라인 아이콘으로, 목록 행도 원형 라인 아이콘. 저장된 이모지 값(💼 👤 💡 …)은 데이터 그대로 두고 그릴 때만 `categoryIconFor()`로 라인 아이콘으로 바꾼다 (데이터 마이그레이션 없음).
  4. 사람·장소·일정: 사이드바 해당 행 + 편집기 사람·장소 연결 칩(라인 아이콘 + 이름).
  5. 그 외 일관성: 편집기 도구 모음 5개(단락·체크리스트·사진·음성메모·일정)·고정 토글·일정 표시를 라인 아이콘 + 단어로, 격자·목록·아웃라인 고정 표시(📌)를 라인 핀 아이콘으로, 마인드맵 노드 아이콘(📝📁📂)을 노드 안 라인 아이콘으로, 아웃라인 미분류 아이콘을 원형 라인 아이콘으로.
- **폰트** (jin 추가 요청): 앱 전체 기본 폰트는 한컴 말랑말랑체. 이미 `styles.css`에 `@font-face`(Regular/Bold, 눈누 미러 jsDelivr CDN woff2, `font-display: swap`)와 `body{font-family: HancomMalangMalang, system-ui, -apple-system, Malgun Gothic, sans-serif}`가 있었고, 이번에 woff2 CDN 로드를 직접 확인함 — Regular 200 (1,029,116 bytes), Bold 200 (1,056,372 bytes), 둘 다 `font/woff2`. 빌드 CSS에 @font-face·body 폰트·폴백 체인 포함 확인. 유일한 예외는 AI JSON 입력란(`.json-input`)의 monospace로, 코드 입력란이라 의도적으로 유지.
- 검증 (jsdom + esbuild IIFE mock 빌드, 데모 데이터 동일): pill 5개 전부 원형 SVG + 단어, 사이드바 16개 행 전부 원형 SVG·이모지 0건, 카테고리 아이콘 선택 18개 전부 원형 SVG, 카테고리 목록 7개 전부 원형 SVG, 사람 화면 이동 정상, 편집기 도구 모음 5개 전부 라인 SVG·이모지 0건, JS 에러 0건.
- 빌드: `tsc --noEmit` + Vite 통과 (JS 300.18KB). 배포: Pages `plustree-memo` 직접 업로드, 배포 `14875db8`. 확인: `naite.plustree.net`·`memo.plustree.net`·`plustree-memo.pages.dev` 모두 새 번들(`index-DzGE7sTR.js`) 서빙.
- 남은 것: 위 6개 항목은 2026-11-11 19절에서 완료 (13절 갱신).

## 18. 심사받기 쉽게 만들기 — 최소 범위·Picker·개인정보처리방침 (2026-11-10)

- jin 결정: Google OAuth 심사를 받기 쉽게 만들 것. 14절의 `drive`(전체) 범위 결정을 뒤집는다.
- **권한 축소** (`frontend/src/auth-seam.ts`, `LoginGuide.tsx`, `docs/`):
  1. `drive`(전체, 제한된 범주) → `drive.file`(이 앱이 만든 파일 + 사용자가 파일 선택기로 열어준 파일만).
  2. `calendar`(전체) → `calendar.events`(일정 생성·조회·삭제만).
  3. `tasks`, `contacts.readonly`, `openid`, `email`, `profile`은 그대로 (최소 범위).
  4. 기존 전체(`drive`) 범위 토큰은 만료 시까지 동작하고, 만료 후 다시 로그인하면 새 범위로 동의받는다. App 첫 로그인 스코프 검사는 `drive.file` 또는 `drive` 중 하나라도 있으면 통과.
- **Drive 파일 선택기(Picker) 가져오기** (`frontend/src/drive-picker.ts` 신규, `frontend/src/components/DrivePickerImport.tsx` 신규, `frontend/src/api.ts`에 `drive.importPickedFiles`·`drive.importPickedFolder` 추가):
  1. drive.file은 원본 memoaeb 메모를 직접 볼 수 없으므로, 사용자가 Drive 파일 선택기에서 memo JSON 파일(여러 개) 또는 memo 폴더를 직접 고르면 가져온다. Picker로 연 파일은 drive.file 권한으로 읽을 수 있다.
  2. Picker에는 Google API 키가 필요하다. 빌드 시 `VITE_GOOGLE_API_KEY`로 넣거나 설정 화면에서 저장(localStorage `naite.google.api_key.v1`). 키가 없으면 설정 안내를 보여준다. API 키는 콘솔에서 HTTP 리퍼러 제한(naite.plustree.net 등)을 걸어 만든다.
  3. 배치 위치: 격자 보기 빈 화면 + 설정 화면 Google Drive 섹션. 원본 앱에서 Drive 동기화를 먼저 눌러 memo 파일을 Drive에 올리라는 안내 문구를 함께 둔다.
  4. 폴더를 골랐는데 안에 JSON이 없으면 파일 직접 선택으로 안내한다.
- **개인정보처리방침** (`frontend/src/views/PrivacyView.tsx` 신규, `main.tsx`에서 `/privacy` 공개 라우트, 푸터에 링크):
  1. URL: https://naite.plustree.net/privacy (로그인 없이 열림, SPA 폴백 `/* /index.html 200`으로 서빙).
  2. 내용: 수집 항목(계정 기본 정보·메모·Drive memo 파일·연락한 일정·할 일·연락처 검색·장소·위치), 수집 목적, 저장 위치(사용자 본인 Drive + 브라우저 로컬 저장소, 나이테 서버에 저장하지 않음), 제3자 제공 없음, 보관 기간(삭제할 때까지), 이용자 권리(앱 내 삭제·Drive 파일 삭제·권한 취소), 쿠키·추적 없음, 문의 plustree@googlegroups.com, 시행일 2026-11-10. 한국어 전문 + 영문 요약 포함.
- **심사 제출 자료** (`docs/VERIFICATION.md` 신규): 앱 정보(도메인·연락처·원본·리디렉션 URI), 요청 범위 표 + 영문 사용 이유, 쓰지 않는 범위(`drive` 전체·`calendar` 전체), 데모 영상 촬영 대본(2~3분), 심사 제출 체크리스트(jin 콘솔 작업 포함).
- **모바일 수정 2건** (jin 모바일 스크린샷, 같은 빌드에 포함):
  1. **제목 잘림**: 모바일(640px 이하)에서 제목 줄이 좁아져 "전체 메모"가 "전체 …"로 잘림. `.title-row`를 감싸게 하고 제목은 한 줄로 전부 보이게, 전체 기간·최근 수정순 선택은 아래 줄 오른쪽으로 내림 (`styles.css`).
  2. **새 메모 + 버튼 가림**: 모바일 FAB(주황 + 버튼)가 메모 카드 날짜·Drive 저장 표시를 가림. 아래로 스크롤하면 FAB이 숨고 위로 올리면 다시 보이게 (`App.tsx` 스크롤 감지 + `.fab-hidden`), 모바일 하단 여백을 96px → 140px로 늘림.
- **원본 기준 재확인**: 도메인 버전이 원본 memoaeb v32와 똑같이 보이는 게 최종 목표. 모바일에서도 원본 구조(사이드바 보기·카테고리·키워드·장소 섹션, 상단 로고 옆 검색창, 제목 줄 + 기간·정렬, 보기 pill 줄, 메모 격자 카드)가 그대로 보이게 한다. 사이드바는 모바일에서 아이콘 행으로 접히지만 내용·순서는 원본과 같다.
- 빌드·배포·확인 (2026-11-10): `tsc --noEmit` + Vite 통과 (JS 310.24KB, 번들에 클라이언트 ID 인라인·`drive.file`/`calendar.events` 포함, 전체 `drive`·`calendar` 범위 요청 없음 — 기존 전체 범위 토큰 허용용 읽기 전용 검사 1건만 남음). 배포: Pages `plustree-memo` 직접 업로드, 배포 `1227d8e8`. 확인: `naite.plustree.net`·`memo.plustree.net`·`plustree-memo.pages.dev` 모두 새 번들(`index-BU-QHLsv.js`) 서빙, 라이브 번들 MD5가 로컬 빌드와 일치. `/privacy` 페이지 라이브 확인(한국어 전문 + 영문 요약 전부 표시). 로그인 안내 크롤은 캐시로 옛날 문구가 보였으나 라이브 번들 직접 확인으로 새 문구(`drive.file`·파일 선택기) 포함 확인. Picker 실제 동작은 Google API 키가 없어서 jin 키 등록 후 확인 필요.

## 19. 안 된 것 6개 항목 구현 (2026-11-11)

- jin 지시: "안된것들 진행해" — 13절 "아직 안 된 것" 목록 6개 항목을 원본 memoaeb v32 동작 기준으로 구현.
- **1. 목록 가상 스크롤** (`frontend/src/views/MemoListView.tsx`, `styles.css`): 30개씩 페이징 → 100개씩 전체 로드(최대 5000개) 후 가상 스크롤 렌더링. 행 높이 96px 고정(행 안 제목·미리보기·날짜 1줄 말줄임), 오버스캔 5행, 보이는 행만 절대 위치로 그림. 스크롤 시 다시 그림. 검증: jsdom 렌더링 테스트 — 150개 메모에서 12행만 렌더링, 스페이서 높이 14400px.
- **2. 체크리스트 하위 할일** (`local-store.ts` `Block.parentId`, `api.ts`, `MemoEditorView.tsx`, `ScheduleView.tsx`, `google-client.ts`):
  1. 모델: `Block.parentId` (상위 체크리스트 블록 id), Drive 직렬화·복원에 포함, 예전 데이터는 `parentId: null`로 정규화. `blocks.remove`는 하위 할일도 함께 삭제(연쇄 삭제).
  2. 편집기: 체크리스트 블록 옆 "하위 할일 추가" 버튼, 하위 할일은 들여쓰기 + "↳" 표시, 체크·삭제 가능.
  3. Google Tasks 연동: `tasks.sync`가 상위 할일을 먼저 동기화한 뒤 하위 할일을 `POST /tasks/v1/lists/{listId}/tasks?parent={상위 googleTaskId}`로 생성해 parent 연결. 하위만 동기화해도 상위를 먼저 동기화한다. 상위 삭제 시 연결된 Google 할일도 삭제한다 (`tasksDeleteTask`).
  4. 일정 화면 할 일 목록도 하위 할일을 들여쓰기로 표시한다.
  5. 검증: 하위 할일 생성·완료·Drive 직렬화·복원·연쇄 삭제, Tasks `parent` 파라미터 호출까지 fetch 목으로 확인.
- **3. 일정 삭제·알림** (`local-store.ts` `MemoEventRecord.reminderMinutes`, `api.ts`, `google-client.ts`, `MemoEditorView.tsx`, `ScheduleView.tsx`):
  1. 알림: 일정 만들 때 "알림" 선택 (없음·시작 5분 전·10분 전·15분 전·30분 전·1시간 전). `calendar.createEvent`가 Google Calendar API에 `reminders: { useDefault: false, overrides: [{ method: "popup", minutes }] }`로 보낸다. 종일 일정은 알림이 0분(자정) 기준으로 동작하지 않을 수 있어 안내 문구를 둔다.
  2. 삭제: 메모 편집기 일정 패널·일정 화면 아젠다에 "이 일정 삭제" 버튼 (2단계 확인). `calendar.deleteEvent`는 Google에서 삭제한 뒤 메모의 일정 연결 기록도 지운다 (`clearLocalEvent`).
  3. 원본과 달리 Google에서 지운 일정의 연결 행을 지우는 서버 훅은 없고, 삭제 버튼을 누른 메모의 연결만 지운다.
  4. 검증: 알림 30분 생성 요청 본문에 `popup`·`minutes: 30` 포함, 삭제 후 연결 기록 null, DELETE 호출 확인.
- **4. 장소 검색 API 키** (`frontend/src/api.ts` `getMapsApiKey()`, `drive-picker.ts`, `SettingsView.tsx`, `PlacesView.tsx`, `MemoEditorView.tsx`):
  1. 장소 검색·역지오코딩이 쓰던 `MAPS_API_KEY`는 빌드 환경변수(`VITE_GOOGLE_MAPS_API_KEY`)만 읽었는데, 이제 설정 화면에 저장한 Google API 키(localStorage `naite.google.api_key.v1`)도 쓴다. 순서: 빌드 키 → 설정 저장 키. 둘 다 없으면 키 없음 안내.
  2. 설정 화면에 "Google API 키" 카드를 새로 만들었다 (Picker 키와 같은 저장소, 같은 입력란 — Picker·장소 검색이 하나의 키를 공유한다). 키 저장·삭제·빌드 키 사용 여부 표시.
  3. PlacesView·편집기 장소 검색의 안내 문구를 "설정 → Google API 키"로 바꿨다.
  4. API 키 생성은 jin 몫 (Google Cloud Console에서 직접). 키가 없으면 장소 이름만 직접 추가 가능.
- **5. 키워드 추출 품질** (`frontend/src/local-store.ts` `extractKeywords`):
  1. 조사·어미 제거 원형화: 조사("은/는/이/가/을/를/의/에서/에게/으로…" 긴 것부터), 어미("습니다/입니다/합니다/했던/하면…"), 복수 "들"을 떼고, 원형이 2자 미만이면 버린다.
  2. 예외 목록 `NO_STRIP_WORDS`: "고양이"→"고양" 같은 오절단을 막는다 (고양이·호랑이·강아지·송아지·할머니·할아버지·아버지·어머니·어린이·원숭이·코끼리·병아리·토끼·다람쥐·이야기·국가·작가·평가·증가·참가·효과·결과·가격·추가·통과·불가·전문가·참가자). 조사만 떼고 완성 단어가 되면 어미를 더 떼지 않는다 ("이야기"의 "기"를 떼면 "이야"가 되는 문제 수정).
  3. 불용어 대폭 확대 (조사·어미·대명사·시간·지시어·흔한 동사·영문 관사·전치사 등).
  4. 가중치: 제목 단어 +3, 해시태그 +10, 본문 빈도 +1 (2회 이상만), 상위 10개. 더 긴 키워드에 포함되는 짧은 키워드는 제외.
  5. 한계: 원본은 서버 모델 추론이라 의미 기반 추출이 되지만, 배포판은 로컬 규칙 기반이라 품질이 완전히 같지는 않다. 테스트 14건 통과 (고양이·국가·이야기 원형 유지, "이것은"·"입니다" 제외, 한 번만 나온 단어 제외 등).
- **6. 자동 동기화** (`frontend/src/api.ts` `drive.autoSync`, `frontend/src/App.tsx`, `frontend/src/views/SettingsView.tsx`):
  1. 앱이 열려 있는 동안 주기적으로 Drive에서 바뀐 메모를 가져온다. 기본 5분 간격, 설정에서 끄고 켤 수 있고 간격(5·10·30분) 선택 가능. 탭이 안 보이면 건너뛴다. 가져온 메모가 있으면 알림 + 목록 새로고침.
  2. 안전장치: **로컬 메모가 Drive 파일보다 새로우면 덮어쓰지 않고 건너뛴다** (새로 만든 메모가 Drive 동기화 전인 경우 보호). 마지막 동기화 이후 바뀐 파일만 본다.
  3. 설정 변경은 `naite:settings-changed` 이벤트로 App 타이머가 바로 다시 시작한다. 토큰 만료 시 조용히 멈춘다 (알림 스팸 방지, 수동 동기화·다시 로그인이 안내한다).
  4. **백그라운드(앱 닫힌 상태) 동기화는 Pages-only 구조상 안 된다** — 서버·크론이 없어서 앱을 닫으면 동기화가 멈춘다. 이 점은 13절에도 명시.
  5. 검증: fetch 목으로 자동 동기화 가드 확인 — 로컬이 더 새 파일은 건너뜀(`skippedLocalNewer: 1`), 드라이브가 더 새 파일만 가져옴(`imported: 1`), `last_auto_sync_at` 기록.
- 검증 (2026-11-11): `tsc --noEmit` 통과. 로직 테스트 31건 전부 통과 (키워드 14·하위 할일 5·일정 4·Tasks 4·자동 동기화 4 — `/tmp/naite-test/logic.entry.ts`, esbuild + node, Google API fetch 목). 가상 스크롤 jsdom 렌더링 테스트 통과 (150개 메모 → 12행 렌더링, 스페이서 14400px — `/tmp/naite-test/render.entry.tsx`). 실제 Google API(캘린더·Tasks·Drive·장소 검색) 동작은 jin 계정·API 키가 없어서 실데이터로 확인 못 함 — jin이 로그인·API 키 등록 후 확인 필요.
- 빌드·배포·확인 (2026-11-11): `tsc --noEmit` + Vite 통과 (JS 324.00KB, CSS 18.23KB, 번들에 클라이언트 ID·`drive.file`·`calendar.events` 포함). 배포: Pages `plustree-memo` 직접 업로드, 배포 `4d100570` (2026-11-11 03:47 UTC). 확인: `naite.plustree.net`·`memo.plustree.net`·`plustree-memo.pages.dev` 모두 새 번들(`index-S7t3Ia4N.js`) 서빙, 라이브 번들 MD5가 로컬 빌드와 일치(`0c9cba66f6e66d1ed2d12015f12e060e`), 라이브 번들에 `auto_sync_enabled`·`가상 스크롤`·`하위 할일 추가`·`일정 삭제`·`deleteEvent` 포함 확인. `/privacy` 200 확인. (참고: 배포 스크립트를 확인용으로 한 번 더 돌려 같은 내용의 배포가 2개 생겼으나(`f513b7cf`·`4d100570`), 라이브는 최신 `4d100570` 내용과 동일하다.)

## 20. 앱 전체 스페이스 기준 맞춤 + 디자인 토큰 (2026-11-11)

- jin 지시: 스페이스(원본 memoaeb) 디자인과 배포판 차이가 크다. 히어로만이 아니라 앱 전체를 스페이스 기준으로 맞출 것. 제목 잘림("전체 …")·+ 버튼 가림은 1227d8e8에서 고쳤다고 했는데 스크린샷에 여전히 보인다는 지적도 함께 확인.
- **스크린샷 정정**: jin이 22:54~22:55에 보낸 2장 중 1장은 스페이스 원본(제목 "전체 …"로 잘림·+ 버튼이 "Drive 저장됨" 가림)이고, 2장이 배포판(제목 "전체 메모" 전체 표시 — 1227d8e8 수정이 라이브에 반영됨 확인, + 버튼이 날짜 가림). 즉 제목 잘림은 배포판이 아니라 원본 화면을 본 것이다. 라이브 번들에 `fab-hidden` 포함도 확인됨.
- **제목 CSS 모순 수정** (`styles.css`): 모바일 `.title-row h1`의 `overflow: hidden`·`text-overflow: ellipsis` 제거 (주석 "제목은 한 줄로 전부 보이고"와 모순이었음). 이제 nowrap + flex-wrap으로 제목은 전부 보이고, 전체 기간·최근 수정순은 아래 줄 오른쪽으로 내린다. 360px 렌더링에서 "전체 메모" 잘림 없음 확인 (`scrollWidth == clientWidth`).
- **모바일 FAB 제거** (`styles.css`): 떠 있는 + 버튼이 카드 글자(날짜·Drive 저장됨)를 가린다는 지적이 반복돼, 모바일에서 FAB을 아예 안 보이게 했다. 대신 상단 full-width "+ 새 메모" 버튼 + GridView/MemoListView 목록 하단(페이지네이션 아래)에 "+ 새 메모" 버튼(`.list-bottom-new`, `onNew` prop → App `handleNewMemo`) 추가. 이는 스페이스와 의도적으로 다른 부분 (스페이스의 FAB가 두 스크린샷에서 모두 글자를 가리고 있음). 360px에서 FAB `display: none`, 하단 버튼 표시 확인.
- **히어로 스페이스 맞춤** (`HeroView.tsx`·`HeroView.css`, `GoogleLoginButton.tsx` 신규): 모바일 상단 바(햄버거·주전자 아바타·"..." + 드롭다운: 로그인·개인정보처리방침·기능 소개), 주황 소제목 "Google Drive 연동 메모", 가운데 정렬 큰 제목 2줄 고정(`.hero-line` block + nowrap — "메모" 분리 방지), 설명 문구 원본 그대로, 흰색 pill 로그인 버튼(Google G 로고 SVG + "Google 계정으로 로그인"), 작은 문구 "따로 회원가입 없이, 쓰던 Google 계정으로 바로 시작합니다.", 주전자 이젤 그림 모바일 크게(360px에서 320px). 로고는 원본처럼 왼쪽 정렬, 설명·작은 문구는 `word-break: keep-all`로 단어 중간 끊김 방지. 참고: 스페이스 스크린샷 상단의 햄버거·아바타·"..." 바는 Muse 앱 자체 크롬일 가능성이 있으나, 지시대로 앱 내 모바일 상단 바로 재현했다.
- **Drive 저장됨 배지 추가** (`GridView.tsx`·`MemoListView.tsx`, `.memo-drive-badge`): 원본 카드에 있는 초록 "Drive 저장됨" 배지가 배포판 카드에 아예 없어서 추가. `driveFileId`가 있는 메모만 표시 (격자 카드: 카테고리 옆, 목록 행: 날짜 앞).
- **디자인 토큰** (`frontend/src/styles.css` `:root`, 2026-11-11 추가): 빌더 프레임워크는 이식하지 않고, 렌더링된 원본(스페이스 패널·스크린샷)에서 보이는 스타일만 CSS 변수로 옮겼다. 배포판은 Vite + React + plain CSS 구조 그대로. 토큰 목록 (앞으로 디자인 고칠 때는 이 변수만 보면 된다):
  - 색: `--naite-bg: #fafaf5` (페이지 배경), `--naite-card: #ffffff` (카드), `--naite-orange: #e8590c` (주황: 버튼·소제목·강조), `--naite-orange-dark: #c2571b`, `--naite-brown: #b98a4e`, `--naite-ink: #222222` (본문), `--naite-ink-soft: #333333`, `--naite-gray: #555555`, `--naite-gray-2: #666666`, `--naite-muted: #888888` (메타), `--naite-faint: #999999`, `--naite-pale: #aaaaaa` (섹션 라벨), `--naite-green: #2e9e5b` (Drive 저장됨·기간 초록), `--naite-border: #e5e5e5`, `--naite-border-strong: #dddddd`, `--naite-border-soft: #e0e0e0`, `--naite-border-light: #eeeeee`, `--naite-cream: #fff8ef`, `--naite-warm: #f0ede4`, `--naite-warm-2: #f5e9d8`, `--naite-notice-bg: #fff3cd`, `--naite-notice-border: #e6c87a`, `--naite-on-orange: #ffffff`, `--naite-on-dark: #ffffff`, `--naite-brown-dark: #6b4a2f`, `--naite-orange-tint: #fff3e8`, `--naite-warm-3: #f3ede2`, `--naite-offwhite: #fafafa`, `--naite-overlay: rgba(0,0,0,0.45)` (모달 배경).
  - 모양: `--radius-lg: 20px` (메모 카드 — 원본처럼 크게, 기존 10px에서 변경), `--radius-md: 12px`, `--radius-xs: 4px`, `--radius-sm: 8px`, `--radius-pill: 999px`, `--shadow-card: 0 2px 8px rgba(0,0,0,0.06)`, `--shadow-btn: 0 2px 8px rgba(0,0,0,0.12)`, `--shadow-fab: 0 4px 12px rgba(0,0,0,0.25)`.
  - 폰트 크기: `--font-hero: 44px` (데스크톱), `--font-hero-mobile: 40px`, `--font-title: 20px`, `--font-title-mobile: 18px`, `--font-card-title: 17px`, `--font-body: 15px`, `--font-meta: 13px`.
  - 간격·크기: `--gap: 12px`, `--fab-size: 56px`.
  - 적용 범위: `styles.css` + `views/*.css`의 색상·둥근 정도·그림자를 전부 변수로 교체 (MindmapView/OntologyView는 색상 없음). **주의 (2026-11-11 실수 기록)**: sed로 일괄 교체할 때 `:root` 정의 자체의 hex까지 바뀌어 `--naite-orange: var(--naite-orange)` 같은 자기 참조 순환이 생겼고, 소제목이 주황 대신 검정으로 렌더링됐다. `:root` 블록을 올바른 literal 값으로 다시 써서 해결. 앞으로 토큰 교체 시 `:root` 정의는 건드리지 말 것.
- **동그란 라인 아이콘·말랑말랑체는 유지** (jin 선호, 2026-11-10). 원본 유니코드·이모지로 바꾸지 않음.
- 검증 (2026-11-11): `tsc --noEmit` + Vite 통과 (JS 327.27KB, CSS 23.90KB). 배포: Pages `plustree-memo` 직접 업로드, 최신 배포는 JS `index-DZFKgGLF.js`·CSS `index-CXp5r51v.css` (라이브 번들 MD5 로컬 빌드와 일치, `memo-drive-badge` 포함 확인). 360px 실제 렌더링(Playwright, 라이브 히어로 + mock 빌드 목록) 확인: 히어로(소제목 주황·제목 2줄·흰색 pill 버튼·큰 주전자 그림), 목록("전체 메모" 전체 표시·전체 기간·최근 수정순 아래 줄·아이콘만 pill·카드 radius 20px·Drive 저장됨 배지·하단 + 새 메모 버튼·FAB 없음). GitHub 푸시는 미완료 — main은 아직 `c1942f8`. 승인 카드 없이 반복 푸시 금지, 부모 보고 후 승인 대기.

## 배포 시 클라이언트 ID 주입 (2026-11-11 사고 기록)
- `VITE_GOOGLE_CLIENT_ID` 없이 빌드하면 번들에 클라이언트 ID가 안 들어가 로그인 버튼이 비활성화된다 (`google_oauth_client_not_configured`).
- 2026-11-11 레이아웃·아이콘·디자인 작업 후 빌드에서 ID가 빠져 로그인이 안 됐다. 이후 빌드할 때는 반드시 `frontend/build.sh`로 빌드할 것 (ID 주입 + 번들 포함 확인 포함).
- 배포 순서: `frontend/build.sh` → `deploy_naite_frontend.py`.

## 모바일 메인 (스페이스 원본 기준, 2026-11-11)
- 모바일(768px 이하) 메인: 상단 바(햄버거·주전자 아바타·"...")만 보이고 사이드바는
  햄버거로 여는 드로어(너비 min(300px, 84vw), 기본 숨김). 드로어 안은 데스크톱과
  같은 세로 목록(아이콘+단어·보기/카테고리/키워드/장소 섹션·하단 가져오기·설정·로그아웃).
  "..." 메뉴: 가져오기·설정·개인정보처리방침·로그아웃. 항목을 누르면 드로어가 닫힌다.
- 로고 중복 제거: 보이는 로고는 헤더(로고+메모 검색) 하나뿐. 드로어 안 로고는 숨긴 상태라 안 보인다.
- "+ 새 메모"는 본문 상단 full-width 주황 버튼(모바일 전용, 데스크톱은 사이드바 버튼).
  모바일 FAB은 가림 문제로 계속 없음.
- 보기 전환 pill 줄은 모바일에서 작게(아이콘 24px, 버튼 34px).
- 데스크톱(769px 이상)은 이 변경과 무관 — 상단 바·모바일 버튼·드로어 규칙은 768px 이하에서만 동작한다.
- 캡처 스크립트: `~/workspace/naite-verification-demo/tool/cap360-drawer.mjs`
  (mock 빌드 8901 기준, 상단 바·드로어 열림/닫힘·"..." 메뉴 확인).

## 21. 편집기 + 전 화면 스페이스 기준 맞춤 + 로고 홈 이동 (2026-11-12)
- **편집기 상단 "+ 새 메모" 제거** (`App.tsx`): 모바일 full-width "+ 새 메모" 버튼이 모든 보기에서 렌더링돼 편집기 위에도 보였음. 이제 편집기(`view.name === "editor"`)에서는 안 보인다.
- **편집기 하단 툴바 동그란 라인 아이콘** (`MemoEditorView.tsx`, `styles.css` `.editor-toolbar`): 네모난 테두리 버튼 + 유니코드·이모지(T·✓·사진·🎙·📅)였던 블록 추가 버튼을 보기 전환 pill과 같은 규칙으로 변경 — `RoundIcon`(단락·체크리스트·사진·음성메모·일정) + 데스크톱 아이콘+단어 / 1024px 미만 아이콘만.
- **유니코드·이모지 제거** (`LineIcon` 신규 아이콘 7종: `chevronUp`·`chevronDown`·`x`·`refresh`·`stop`·`lock`·`unlock`):
  - 편집기 블록 이동·삭제 ↑↓✕ → 라인 아이콘. Tasks 동기화 ↻ → `refresh`. 음성 패널 ⏹/●/🎤 → `stop`/`mic`. 키워드·사람·장소 칩 ✕ → `x`. 현재 위치 ◎ → `mapPin`.
  - 온톨로지 자물쇠 🔒/🔓(버튼·범례·SVG 간선 마커) → `lock`/`unlock` 라인 아이콘 (SVG 안은 작은 자물쇠 도형으로 직접 그림).
  - 일정 할일 완료 표시 ✓/○ → 동그란 체크 (완료면 주황 채움 + 흰 체크, 미완료면 빈 원).
  - 분석 설명 문구의 🔒 삭제 (문장 자체에 "잠긴 관계는 건드리지 않습니다"가 있어 중복).
  - 카테고리 아이콘 선택기의 이모지 목록은 데이터 선택 UI라 유지 (원본도 카테고리 아이콘을 이모지 값으로 저장, 렌더링할 때만 라인 아이콘으로 바꿈).
- **전역 버튼 기본 스타일** (`styles.css` `button`): 브라우저 기본 회색 네모난 버튼이 아니라 원본처럼 부드러운 둥근 버튼(테두리 `var(--naite-border-soft)`, 둥근 정도 `var(--radius-md)`, 카드 배경). 보기 pill·사이드바·상단 바·로그인 버튼·새 메모 버튼 등 전용 스타일은 그대로 덮어쓴다. 이 하나로 일정·온톨로지·분석·마인드맵·아웃라인·사람·장소·설정·카테고리 관리·가져오기 등 전 화면의 네모난 테두리 버튼이 원본 톤으로 바뀐다.
- **로고 홈 이동** (`Logo.tsx` `NaiteLogo`에 `onClick` 추가, `App.tsx`, `HeroView.tsx`): 헤더·드로어(사이드바)·히어로의 나이테 로고를 누르면 메모 목록 홈(전체 메모·격자 보기)으로 이동한다. 히어로는 이미 홈이라 맨 위로 스크롤. 로고는 `logo-btn` 버튼으로 감싸 손가락 커서(`cursor: pointer`) + `title="홈으로 (메모 목록)"`.
- 데스크톱 레이아웃은 건드리지 않음. 동그란 라인 아이콘·말랑말랑체 유지.
- 빌드: `frontend/build.sh` (클라이언트 ID 포함 확인). 배포: Pages `plustree-memo`.
- 검증 스크립트: `~/workspace/naite-verification-demo/tool/cap-all360.mjs` (mock 8901 + 라이브 히어로·로그인 안내·개인정보처리방침, 360px).

- **추가 수정 (검증 중 발견, 2026-11-12)**:
  - 하위 할일 행 줄바꿈 (`styles.css` `.subtask-row` `flex-wrap: wrap`, 텍스트 입력 `flex: 1 1 120px`): 모바일에서 하위 할일 텍스트 입력이 30px로 찌그러져 "우유 2개"가 안 보이던 문제. 이제 텍스트가 한 줄 전체, 날짜·동기화·삭제는 다음 줄로 (상위 체크리스트 행과 같은 방식).
  - 보기 전환 pill·편집기 툴바 접근성 이름 (`App.tsx` pill `aria-label`, `MemoEditorView.tsx` 툴바 버튼 `aria-label` 추가): 모바일에서 라벨이 숨겨지면 버튼의 접근성 이름이 비어 스크린리더·자동화에서 못 찾던 문제. 이제 아이콘만 보여도 이름이 있다.
- 검증 (2026-11-12, 360px 실제 렌더링 Playwright): mock 빌드(8901) + 프로덕션 빌드 로컬 서빙(8902)으로 전 화면 확인, JS 에러 0건.
  - 편집기: "+ 새 메모" 없음 확인, 상단 액션(목록으로·미리보기·고정됨·가져오기·삭제) 부드러운 둥근 버튼, 블록 컨트롤 라인 아이콘(↑↓✕ → chevron/x), 하단 툴바 동그란 아이콘 5개(모바일 아이콘만·라벨 숨김), Tasks 새로고침 아이콘, 하위 할일 "우유 2개" 전체 표시.
  - 로고 홈: 헤더 로고 클릭 → "전체 메모" 홈으로 이동 확인 (h1 "전체 메모").
  - 아웃라인·마인드맵·온톨로지·분석: pill 전환 동작, 온톨로지 필터 칩(검정 pill), 키워드 관리 카드, 분석 통계 카드 렌더링 확인.
  - 일정: "새로고침"·"일정 만들기" 카드, 할일 동그란 체크 확인. 사람·장소·설정·카테고리 관리: 카드·검색 버튼 부드러운 둥근 버튼 확인.
  - 히어로·로그인 안내: 프로덕션 빌드 로컬 서빙으로 확인 (히어로·동의 안내 정상).
  - 개인정보처리방침: 라이브 https://naite.plustree.net/privacy 텍스트 확인 (정상 서빙, "← 나이테로 돌아가기" 링크 있음). 참고: 로컬 python 서버는 SPA 폴백이 없어 /privacy가 404로 보였으나 라이브는 정상.
  - mock 전용 안내 ("Drive 권한이 없어 다시 로그인" 노란 배너 2개)는 mock에 실제 토큰이 없어서 뜨는 것이고 실계정에서는 안 뜬다.
- 검증 스크립트: `~/workspace/naite-verification-demo/tool/cap-all360.mjs`, `cap-all360b.mjs`, `cap-pills.mjs`, `cap-subtask.mjs`. mock 서버(8901)·프로덕션 로컬 서버(8902)는 검증 후 정리함.
- GitHub 푸시는 안 함 (지시대로 매니페스트만 갱신). 변경 파일 23개 — `~/workspace/naite-push-paths.txt` 참조.
