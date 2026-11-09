# 나이테 정적 프론트엔드 재구축 계획 (Pages-only)

작성: 2026-11-09. 대상: memoaeb(web_fullstack) 클라이언트 → Pages 정적 앱.
**2026-11-09 갱신: Pages-only 전환 — Worker 경유가 없어졌다.**
로그인 UI·플로우는 그록 소유라 이 계획은 로그인 화면을 설계하지 않는다.
대신 로그인 연동 지점만 인터페이스로 정리했다 (`src/auth-seam.ts`).

## 왜 재구축이 필요한가

- memoaeb은 web_fullstack이라 정적 HTML로 내보낼 수 없다. 서버 액션(약 60개)이
  Muse 런타임에 있다. 지금 Pages(`plustree-memo`)에 올라간 건 목업뿐이다.
- Pages에 올릴 정적 클라이언트는 브라우저에서 Google API를 직접 부르고
  (`src/google-client.ts`), 메모·온톨로지는 로컬 저장소에 둔다 (`src/local-store.ts`).
  Worker 중계·D1·R2는 없다. 대응표는 `docs/API_MAPPING.md` 참조.

## 목표 구조

```
frontend/ (이 폴더 — Pages 배포 루트)
  package.json            # Vite + React + TypeScript
  vite.config.ts          # base '/', build.outDir 'dist'
  index.html
  src/
    main.tsx              # 진입점: AuthProvider 주입 → App
    App.tsx               # 로그인 게이트·라우팅 (목록/편집기)
    api.ts                # Pages-only API (로컬 저장소 + Google API 직접 호출, 완성)
    local-store.ts        # 브라우저 로컬 저장소 + 규칙 기반 계산 (완성)
    google-client.ts      # 브라우저 직접 Google API 호출 (완성)
    token-store.ts        # sessionStorage 토큰 보관 (완성)
    auth-seam.ts          # 인증 경계 인터페이스 + 개발용 mock (완성, 그록 소유)
    views/
      MemoListView.tsx    # 메모 목록 (완성)
      MemoEditorView.tsx  # 메모 편집기 (완성)
    styles.css            # 최소 스타일 (자산 이식 시 교체)
    types.ts              # (미작성) api.ts의 타입 재노출 — 필요 시 작성
    components/           # (미작성) 나머지 화면 이식 시 작성
    views/ (추가)         # 격자·아웃라인·마인드맵·온톨로지·분석·일정·사람·장소 (미작성)
    assets/               # (미작성) 로고(naite-logo.png), 주전자 캐릭터, 말랑말랑체
```

## 이식 체크리스트 (memoaeb 기능 → 정적 클라이언트)

| memoaeb 기능 | 정적 클라이언트에서 할 일 | Pages-only API |
|---|---|---|
| Google 로그인 게이트·동의 화면 | **그록 소유 — 건드리지 않음.** `AuthProvider` 뒤에만 둔다 | 브라우저 OAuth (그록) |
| 랜딩 히어로·기능 설명 | 이식 (미착수) | — |
| 메모 목록 (격자·목록, 가상 스크롤, 30개씩) | ✅ 목록 뷰 구현 (`MemoListView.tsx`). 격자 보기·가상 스크롤은 미착수 | `api.memos.list` |
| 블록 편집기 (단락 기본·체크리스트·사진·음성·일정) | ✅ 단락·체크리스트 구현 (`MemoEditorView.tsx`). 사진·음성·일정 블록 편집 UI는 미착수 | `api.memos`·`api.blocks` |
| 카테고리·하위 카테고리·아이콘 | ⏳ 목록 필터까지만 구현. 카테고리 관리 화면 미착수 | `api.categories` |
| 아웃라인·마인드맵·온톨로지 (다대다 그래프) | ⏳ API만 구현. 그래프 화면 미착수 | `api.ontology.*` |
| 키워드 자동 추출 | ✅ 저장 시 `extract-keywords` 호출 (편집기 버튼) | `api.memos.extractKeywords` |
| 분석 대시보드·AI 프롬프트·왕복 JSON | ⏳ API만 구현. 대시보드 화면 미착수 | `api.analytics.*`, `api.ontology.import/*` |
| 캘린더 일정 (하단 아이콘) | ⏳ API만 구현. 일정 화면 미착수 | `api.calendar.*` |
| 할일 양방향 동기화 | ⏳ API만 구현. 할일 화면 미착수 (동기화는 수동, 자동 없음) | `api.tasks.*` |
| 연락처 검색 등록 (전체 불러오기 없음) | ⏳ API만 구현. 사람 화면 미착수 | `api.people.search` |
| 장소 검색·지도 핀·위치 메타데이터 | ⏳ API만 구현. 장소 화면 미착수. 지도 타일은 외부 로드 (Pages에서 허용) | `api.places.*`, `api.memos.setGeo` |
| 설정 (Drive·캘린더·할일·연락처·장소 토글) | ⏳ API만 구현. 설정 화면 미착수 | `api.settings`, `api.bootstrap` |
| Drive 동기화 상태 표시 | ✅ 목록 뷰에 수동 동기화 버튼 구현 | `api.drive.status`, `api.drive.sync` |
| 사진·음성 첨부 | ⏳ API만 구현 (Drive 업로드). 첨부 UI 미착수 | `api.attachments.upload` |

## 재구축 순서

1. **스캐폴드**: ✅ Vite + React + TS 프로젝트 생성, `src/api.ts`·`src/auth-seam.ts` 교체,
   API 경계·메모 목록·편집기 구현. (이 단계는 로그인 없이 mock으로 화면만 확인)
2. **화면 이식**: memoaeb 화면을 뷰 단위로 이식. 서버 액션 호출부를 `api.*`로 교체.
   로그인 게이트는 `AuthProvider.getSession()` 결과로만 분기하고, 로그인 화면 자체는
   그록 작업이 들어갈 자리를 비워둔다.
3. **연동 테스트** (OAuth 연결 없이): `VITE_AUTH_MOCK=true`로 화면·라우팅 확인.
   mock은 access_token이 없어 Google API 직접 호출은 동작하지 않는다 — 로컬 메모만 확인한다.
4. **Pages 배포**: `plustree-memo` 프로젝트의 빌드 설정을 `frontend/` 기준으로 변경
   (Framework preset: Vite, Build command: `npm run build`, Output: `dist`).
   기존 목업 배포는 교체 전에 백업한다.
5. **OAuth 연결 (맨 마지막)**: 그록 로그인 + Google OAuth 클라이언트 연결 후
   `VITE_GOOGLE_CLIENT_ID`를 Pages 환경변수로 등록하고 종단 테스트.

## 하지 말 것

- 로그인 화면·동의 화면·토큰 발급 코드를 이 폴더에서 만들지 않는다 (그록 소유).
- `VITE_AUTH_MOCK=true`를 프로덕션 빌드에 쓰지 않는다.
- memoaeb 원본 아티팩트를 직접 고치지 않는다 (정적 재구축은 별도 빌드).
- Drive `memo` 폴더 구조를 바꾸지 않는다 (1메모=1파일 유지).
- refresh_token·client_secret을 브라우저 코드·환경변수에 넣지 않는다.
