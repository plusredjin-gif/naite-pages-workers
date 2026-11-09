# 나이테 정적 프론트엔드 재구축 계획 (Pages용)

작성: 2026-11-09. 대상: memoaeb(web_fullstack) 클라이언트 → Pages 정적 앱.
로그인 UI·플로우는 그록 소유라 이 계획은 로그인 화면을 설계하지 않는다.
대신 로그인 연동 지점만 인터페이스로 정리했다 (`src/auth-seam.ts`).

## 왜 재구축이 필요한가

- memoaeb은 web_fullstack이라 정적 HTML로 내보낼 수 없다. 서버 액션(약 60개)이
  Muse 런타임에 있다. 지금 Pages(`plustree-memo`)에 올라간 건 목업뿐이다.
- Pages에 올릴 정적 클라이언트는 이 폴더의 `src/api.ts`로 Worker를 부른다.
  Worker가 Drive·Calendar·Tasks·People·D1·R2를 대신 처리한다.

## 목표 구조

```
frontend/ (이 폴더 — Pages 배포 루트)
  package.json            # Vite + React + TypeScript (재구축 시 생성)
  vite.config.ts          # base '/', build.outDir 'dist'
  index.html
  src/
    main.tsx              # 진입점: AuthProvider 주입 → App
    api.ts                # Worker API 클라이언트 (완성)
    auth-seam.ts          # 인증 경계 인터페이스 + 개발용 mock (완성)
    types.ts              # api.ts의 타입 재노출 (재구축 시)
    App.tsx               # 라우팅·레이아웃 (재구축 시 memoaeb에서 이식)
    components/           # 메모 목록·편집기·카테고리·그래프 등 (재구축 시 이식)
    views/                # 격자·목록·아웃라인·마인드맵·온톨로지·분석·일정·사람·장소
    assets/               # 로고(naite-logo.png), 주전자 캐릭터, 말랑말랑체
```

## 이식 체크리스트 (memoaeb 기능 → 정적 클라이언트)

| memoaeb 기능 | 정적 클라이언트에서 할 일 | Worker API |
|---|---|---|
| Google 로그인 게이트·동의 화면 | **그록 소유 — 건드리지 않음.** `AuthProvider` 뒤에만 둔다 | `/api/auth/*` (그록) |
| 랜딩 히어로·기능 설명 | 그대로 이식 (로그인 전 화면) | — |
| 메모 목록 (격자·목록, 가상 스크롤, 30개씩) | 이식. 데이터만 `api.memos.list`로 교체 | `GET /api/memos` |
| 블록 편집기 (단락 기본·체크리스트·사진·음성·일정) | 이식. 저장은 `api.memos`·`api.blocks`로 교체 | `POST/PATCH /api/memos`, `/api/blocks` |
| 카테고리·하위 카테고리·아이콘 | 이식 | `/api/categories` |
| 아웃라인·마인드맵·온톨로지 (다대다 그래프) | 이식. 그래프 데이터는 `/api/ontology/graph` | `/api/ontology/*` |
| 키워드 자동 추출 | 저장 시 `extract-keywords` 호출 | `POST /api/memos/:id/extract-keywords` |
| 분석 대시보드·AI 프롬프트·왕복 JSON | 이식. 프롬프트는 Worker 생성 | `/api/analytics/*`, `/api/ontology/import/*` |
| 캘린더 일정 (하단 아이콘) | 이식 | `/api/calendar/*` |
| 할일 양방향 동기화 | 이식 (설정에서 실패 표시 유지) | `/api/tasks/*` |
| 연락처 검색 등록 (전체 불러오기 없음) | 이식 | `/api/people/search` |
| 장소 검색·지도 핀·위치 메타데이터 | 이식. 지도 타일은 외부 로드 (Pages에서 허용) | `/api/places/*`, `/api/memos/:id/geo` |
| 설정 (Drive·캘린더·할일·연락처·장소 토글) | 이식 | `/api/settings`, `/api/bootstrap` |
| Drive 동기화 상태 표시 | 이식 | `/api/drive/status` |
| 사진·음성 첨부 | 업로드는 `api.attachments.upload` (R2) | `/api/attachments/*` |

## 재구축 순서

1. **스캐폴드**: Vite + React + TS 프로젝트 생성, `src/api.ts`·`src/auth-seam.ts` 복사,
   말랑말랑체·로고·캐릭터 자산 이식. (이 단계는 로그인 없이 mock으로 화면만 확인)
2. **화면 이식**: memoaeb 화면을 뷰 단위로 이식. 서버 액션 호출부를 `api.*`로 교체.
   로그인 게이트는 `AuthProvider.getSession()` 결과로만 분기하고, 로그인 화면 자체는
   그록 작업이 들어갈 자리를 비워둔다.
3. **연동 테스트** (OAuth 연결 없이): `VITE_AUTH_MOCK=true`로 화면·라우팅 확인.
   Worker와는 mock 세션으로 통신하지 않는다 — 실제 API 테스트는 OAuth 연결 후에 한다.
4. **Pages 배포**: `plustree-memo` 프로젝트의 빌드 설정을 `frontend/` 기준으로 변경
   (Framework preset: Vite, Build command: `npm run build`, Output: `dist`).
   기존 목업 배포는 교체 전에 백업한다.
5. **OAuth 연결 (맨 마지막)**: 그록 로그인 + Google OAuth 클라이언트 연결 후
   `VITE_API_BASE_URL=https://api.naite.plustree.net`으로 종단 테스트.

## 하지 말 것

- 로그인 화면·동의 화면·세션 발급 코드를 이 폴더에서 만들지 않는다 (그록 소유).
- `VITE_AUTH_MOCK=true`를 프로덕션 빌드에 쓰지 않는다.
- memoaeb 원본 아티팩트를 직접 고치지 않는다 (정적 재구축은 별도 빌드).
- Drive `memo` 폴더 구조를 바꾸지 않는다 (1메모=1파일 유지).
