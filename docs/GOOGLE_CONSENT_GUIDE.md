# 나이테 Google 로그인·동의 안내

이 문서는 **앱 자체 안내 문구**와 **배포 전 콘솔 체크리스트**입니다.
Google 공식 동의 화면(accounts.google.com)을 흉내 내지 않습니다.

## 사용자에게 보이는 것

1. 나이테 랜딩/로그인 게이트(`LoginGuide`)에서 왜 Drive·캘린더·할 일·연락처 읽기 권한이 필요한지 설명합니다.
2. 「Google로 로그인」을 누르면 **Google 공식** 로그인·동의 화면으로 이동합니다.
3. 동의 후 `/auth/callback`으로 돌아와 access_token을 sessionStorage에 넣고 URL 해시를 지웁니다.
4. refresh_token은 브라우저에 저장하지 않습니다. 탭을 닫거나 access_token이 만료되면 다시 로그인합니다.

## 요청 범위 (현재)

- `drive.file` — 이 앱이 만들거나 연 파일만
- `calendar` / `tasks` — 일정·할 일 연결
- `contacts.readonly` — 연락처 검색만 (전체 열거 없음)
- `openid` `email` `profile` — 세션 표시용 userinfo

## 배포 전 (jin / 운영)

- [ ] Google Cloud에 **웹 애플리케이션** OAuth 클라이언트 생성 (클라이언트 비밀번호는 브라우저에 넣지 않음)
- [ ] 승인된 JavaScript 원본: Pages 도메인 (예: `https://naite.plustree.net`)
- [ ] 승인된 리다이렉트 URI: `https://<도메인>/auth/callback`
- [ ] Pages 빌드 환경 변수 `VITE_GOOGLE_CLIENT_ID` = 공개 클라이언트 ID만
- [ ] (선택) OAuth 동의 화면 앱 이름·로고·홈페이지 — **Cloud 콘솔 작업**. 코드/이 PR 범위 아님
- [ ] SPA 폴백: `frontend/public/_redirects` 에 `/* /index.html 200` (콜백 경로용)
- [ ] 테스트 사용자를 동의 화면 테스트 사용자 목록에 추가 (앱이 아직 미게시인 경우)

## 보안 메모

- access_token만 sessionStorage. refresh_token 금지.
- OAuth `state` 불일치 시 토큰을 저장하지 않음.
- 콜백 후 URL 해시 제거.
- 프로덕션에서 `VITE_AUTH_MOCK=true` 사용 금지.

## 이 PR에서 하지 않는 것

- 나이테/정원 **프로덕션 배포**
- Google 동의 화면 앱 로고를 Cloud에서 바꾸는 작업
- 토양 API를 나이테에 붙이는 작업
