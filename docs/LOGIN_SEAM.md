# 로그인 연동 지점 (LOGIN SEAM) — 그록 소유

작성: 2026-11-09. jin 결정: 로그인 방식은 그록이 맡는다.
이 문서는 그록 작업과 나머지 개발이 충돌하지 않게, 로그인 연동 지점만 정리한다.
**이 문서가 정한 것은 인터페이스뿐이다. 로그인 구현 자체는 그록이 정한다.**

## 소유 구분

| 영역 | 소유 | 파일 |
|---|---|---|
| Google OAuth 로그인 시작·콜백·로그아웃·세션 발급 | **그록** | `worker/src/index.ts`의 `/api/auth/*` 구간 |
| 세션 확인 (쿠키 검증) | 공용 — 형식은 이 문서가 고정 | `worker/src/index.ts`의 `getSessionUserId` |
| 로그인 외 API 전부 | 나머지 개발 | `worker/src/api.ts` |
| 백그라운드 동기화 | 나머지 개발 | `worker/src/sync.ts` |
| 로그인 UI·동의 화면 (정적 프론트엔드) | **그록** | `frontend/src/auth-seam.ts`의 `AuthProvider` 구현 |
| 로그인 외 화면 전부 | 나머지 개발 | `frontend/src/api.ts` + 이식 화면 |

## 세션 쿠키 형식 (고정 — 바꾸면 양쪽 다 바꿔야 함)

- 이름: `naite_session`
- 값: `<Google sub>.<HMAC-SHA256(sub, SESSION_SECRET) base64url>`
- 속성: `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` (30일)
- 검증: `worker/src/index.ts`의 `getSessionUserId`가 HMAC을 다시 계산해 비교한다.
- **그록이 쿠키 형식을 바꾸면** `getSessionUserId`와 이 문서를 함께 바꿔야 한다.
  바꾸지 않고 배포하면 로그인 외 API가 전부 401이 된다.

## 그록이 구현·유지하는 Worker 엔드포인트

| 엔드포인트 | 동작 |
|---|---|
| `GET /api/auth/login` | PKCE 코드 챌린지 생성 → Google 인가 화면으로 302 이동 (기존 스캐폴드 있음) |
| `GET /api/auth/callback` | code → 토큰 교환, refresh_token을 KV(`refresh:<sub>`)에 저장, 세션 쿠키 발급 후 `/`로 302 (기존 스캐폴드 있음) |
| `GET /api/auth/logout` | KV refresh_token 삭제 + 세션 쿠키 만료 (기존 스캐폴드 있음) |
| `GET /api/auth/me` | **그록이 새로 구현**: 세션 쿠키에서 사용자 확인 후 `{userId, email, displayName}` 반환. 세션 없으면 401. 프론트엔드 `auth-seam.ts`가 이걸 부른다. |

## 프론트엔드가 기대하는 동작

- 정적 프론트엔드는 `fetch(..., { credentials: "include" })`로 세션 쿠키를 자동 전송한다.
- Worker API가 401을 반환하면 프론트엔드는 `AuthProvider.login()`으로 보낸다
  (로그인 화면으로 이동, 그록 구현).
- 테스트 모드: refresh_token 7일 만료. 만료 시 Worker는
  `token_expired_relogin_required` 401을 반환하고, 프론트엔드는 다시 로그인으로 보낸다.
- OAuth 동의 화면·범위는 jin이 맨 마지막에 만들 Google OAuth 클라이언트에 달려 있다.
  범위: `drive.file`, `calendar`, `tasks`, `contacts.readonly`.
  Redirect URI: `https://naite.plustree.net/api/auth/callback`.

## 테스트 모드 (jin 결정)

- 테스트할 때는 실제 OAuth 연결 없이 진행하고, 마지막에 연결한다.
- OAuth 연결 전에는 Worker API를 세션 없이 부를 수 없다.
  정적 프론트엔드 화면·라우팅 테스트는 `VITE_AUTH_MOCK=true` mock으로만 한다.
  mock으로 만든 데이터는 로컬에만 있고 Drive·D1과 동기화되지 않는다.

## 맞춰야 할 것 (체크리스트)

- [ ] 그록: `/api/auth/me` 구현 (없으면 프론트엔드가 로그인 상태를 알 수 없음)
- [ ] 그록: 세션 쿠키 형식을 바꾸면 `getSessionUserId` + 이 문서 동시 수정
- [ ] 그록: 로그인 화면에서 동의 문구 ("로그인한 사람의 구글 드라이브를 사용한다") 유지
- [ ] 나머지: 로그인 외 API는 세션 쿠키만 믿고, 토큰을 직접 만들지 않음
- [ ] jin (맨 마지막): Google OAuth 클라이언트 생성 후 `GOOGLE_CLIENT_ID`·
      `GOOGLE_CLIENT_SECRET`·`OAUTH_REDIRECT_URI`를 Worker secrets로 등록
