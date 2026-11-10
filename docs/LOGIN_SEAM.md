# 로그인 연동 지점 (LOGIN SEAM) — 그록 소유

작성: 2026-11-09. jin 결정: 로그인 방식은 그록이 맡는다.
**2026-11-09 갱신: Pages-only 전환 — 세션 쿠키/HMAC 방식이 폐기됐다.**
이 문서는 그록 작업과 나머지 개발이 충돌하지 않게, 로그인 연동 지점만 정리한다.
**이 문서가 정한 것은 인터페이스뿐이다. 로그인 구현 자체는 그록이 정한다.**

## 소유 구분 (Pages-only)

| 영역 | 소유 | 파일 |
|---|---|---|
| Google OAuth 로그인 시작·콜백·로그아웃·토큰 발급 | **그록** | `frontend/src/auth-seam.ts`의 `AuthProvider` 구현 |
| 토큰 보관 (sessionStorage) | 공용 — 형식은 이 문서가 고정 | `frontend/src/token-store.ts` |
| 로그인 외 API 전부 (로컬 저장소 + Google API 직접 호출) | 나머지 개발 | `frontend/src/api.ts`, `local-store.ts`, `google-client.ts` |
| 백그라운드 동기화 | **없음 (Pages-only 미지원)** | — (Worker `sync.ts`는 미사용 보관용) |
| 로그인 UI·동의 화면 (정적 프론트엔드) | **그록** | `frontend/src/LoginGuide.tsx`, `App.tsx` 게이트, `auth-seam.ts` |
| OAuth 콜백 (`/auth/callback` 해시→token) | **그록** | `main.tsx` + `saveTokenFromCallbackHash` |
| SPA 폴백 `_redirects` | **그록** | `frontend/public/_redirects` |
| 동의 안내·콘솔 체크리스트 문서 | **그록** | `docs/GOOGLE_CONSENT_GUIDE.md` |
| 로그인 외 화면 전부 | 나머지 개발 | `frontend/src/api.ts` + 이식 화면 |

## 폐기된 것 (Pages+Workers 시절 — 다시 쓰지 않는다)

- 세션 쿠키 `naite_session` (`<Google sub>.<HMAC-SHA256(sub, SESSION_SECRET)>`)
- Worker `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`
- Worker `/api/auth/me` (구현 예정이었음)
- KV에 refresh_token 암호화 저장, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`
- `worker/src/index.ts`의 `getSessionUserId`

## 토큰 보관 형식 (고정 — 바꾸면 양쪽 다 바꿔야 함)

- 저장 위치: **sessionStorage**만. localStorage에는 토큰을 두지 않는다.
- 키: `naite.google.access_token.v1`
- 값 (JSON): `{ accessToken, expiresAt, scope, userId? }`
  - `accessToken`: Google OAuth access_token (약 1시간 유효)
  - `expiresAt`: 만료 시각 (epoch ms). 만료 60초 전부터 만료로 취급한다
  - `scope`: 발급받은 범위 (공백 구분)
  - `userId`: Google sub (있으면)
- **refresh_token은 브라우저에 절대 저장하지 않는다.** 탈취 시 오프라인
  재발급이 가능하기 때문이다. 이게 Pages-only의 가장 큰 제약이다.
- 토큰을 URL·콘솔 로그·Drive 파일·메모 본문에 절대 기록하지 않는다.
- 로그아웃·만료·사용자 전환 시 `clearAccessToken()`으로 지운다.

## 그록이 구현·유지하는 AuthProvider 인터페이스

`frontend/src/auth-seam.ts`의 `AuthProvider`를 구현한다.

| 메서드 | 동작 |
|---|---|
| `getSession(): Promise<Session \| null>` | 저장된 토큰으로 Google userinfo를 직접 불러 `{userId, email, displayName}` 반환. 토큰이 없거나 userinfo가 실패하면 null. **`/api/auth/me` 대체 수단이다.** |
| `getAccessToken(): Promise<string \| null>` | 쓸 수 있는 access_token 반환. 없거나 만료됐으면 null. 프론트엔드의 Google API 직접 호출(`google-client.ts`)이 이걸로 토큰을 받는다. |
| `login(): void` | Google 로그인 시작 (브라우저 OAuth 플로우). 인가 화면으로 이동한다. |
| `logout(): Promise<void>` | 토큰 파기 (sessionStorage에서 지운다). Google 측 세션까지 끊을지는 그록이 정한다. |

## 프론트엔드가 기대하는 동작

- Google API 호출은 `Authorization: Bearer <access_token>`을 직접 붙인다
  (`google-client.ts`의 `googleFetch`).
- 토큰이 없거나 Google API가 401을 반환하면 프론트엔드는 `AuthProvider.login()`으로
  보낸다 (로그인 화면으로 이동, 그록 구현).
- 토큰 만료 시 에러 코드: `TOKEN_EXPIRED_RELOGIN_REQUIRED` (401 상당).
  자동 갱신은 없다. 사용자가 다시 로그인해야 한다.
- OAuth 동의 화면·범위는 jin이 맨 마지막에 만들 Google OAuth 클라이언트에 달려 있다.
  범위: `drive`(Drive 전체 읽기·쓰기 — 원본 memoaeb가 만든 메모 파일까지 읽으려면 필요. 앱은 memo 폴더 외의 파일은 열지 않는다), `calendar`, `tasks`, `contacts.readonly`, `openid`, `email`, `profile`.
  Redirect URI: `https://naite.plustree.net/auth/callback` (브라우저 콜백 — Worker 콜백이 아니다.
  최종 경로는 그록 구현 시 확정한다.)

## 토큰 만료와 테스트 모드 (jin 결정)

- 테스트할 때는 실제 OAuth 연결 없이 진행하고, 마지막에 연결한다.
- OAuth 연결 전에는 Google API 직접 호출을 쓸 수 없다.
  정적 프론트엔드 화면·라우팅 테스트는 `VITE_AUTH_MOCK=true` mock으로만 한다.
  mock은 access_token을 null로 반환하므로 Google API 호출은 동작하지 않고,
  로컬 메모(로컬 저장소)만 동작한다. mock으로 만든 데이터는 로컬에만 있고
  Drive와 동기화되지 않는다.
- 테스트 모드 refresh_token 7일 만료: Pages-only는 refresh_token을 저장하지
  않으므로 직접 체감되지 않는다. 대신 access_token(약 1시간)이 만료될 때마다
  다시 로그인해야 한다. 이것이 Pages-only의 사용성 한계다.

## 맞춰야 할 것 (체크리스트)

- [ ] 그록: `AuthProvider.getAccessToken()` 구현 (없으면 Drive·캘린더·할일·연락처가 전부 동작하지 않음)
- [ ] 그록: `getSession()`을 userinfo 직접 호출로 구현 (`/api/auth/me`는 없다)
- [ ] 그록: 로그인 화면에서 동의 문구 ("로그인한 사람의 구글 드라이브를 사용한다") 유지
- [ ] 그록: OAuth 콜백에서 해시(`#access_token=...`)를 읽어 `saveTokenFromCallbackHash()`로
      sessionStorage에 옮기고, URL 해시를 지운다 (토큰이 URL에 남지 않게)
- [ ] 그록: 토큰 저장 형식을 바꾸면 `token-store.ts` + 이 문서 동시 수정
- [ ] 나머지: Google API 호출은 `getAccessToken()`으로 받은 토큰만 쓰고, 토큰을 직접 만들지 않음
- [ ] jin (맨 마지막): Google OAuth 클라이언트 생성 후 클라이언트 ID를 Pages 환경변수
      `VITE_GOOGLE_CLIENT_ID`로 등록 (클라이언트 보안 비밀번호는 브라우저에 두지 않는다)
