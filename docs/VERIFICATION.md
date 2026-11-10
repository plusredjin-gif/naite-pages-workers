# 나이테 Google OAuth 심사 제출 자료

Google OAuth 동의 화면 "확인 요청 제출"을 할 때 쓰는 정리 문서다.
제한된 범주(restricted scope)는 쓰지 않는다 — 2026-11-10 jin 결정으로
요청 범위를 최소 범위로 줄였다.

## 앱 정보

| 항목 | 내용 |
| --- | --- |
| 앱 이름 | 나이테 (naite) |
| 홈페이지 | https://naite.plustree.net |
| 개인정보처리방침 | https://naite.plustree.net/privacy |
| 개발자 연락처 | plustree@googlegroups.com |
| 운영자 | 더하기나무 (PlusTree) |
| 승인된 JavaScript 원본 | https://naite.plustree.net, https://memo.plustree.net, https://plustree-memo.pages.dev |
| 승인된 리디렉션 URI | https://naite.plustree.net/auth/callback, https://memo.plustree.net/auth/callback, https://plustree-memo.pages.dev/auth/callback |
| 사용자 유형 | 외부 (테스트 모드 → 심사 후 게시) |

## 요청 범위와 사용 이유 (영문, 심사 제출용)

| 범위 | 분류 | 사용 이유 (영문) |
| --- | --- | --- |
| `https://www.googleapis.com/auth/drive.file` | Sensitive | Naite stores each memo as one JSON file in the user's own Google Drive `memo` folder, so memos sync across the user's devices. `drive.file` only allows files this app created or files the user explicitly opened with the Drive file picker. The app never lists or opens other Drive files. |
| `https://www.googleapis.com/auth/calendar.events` | Sensitive | When the user attaches a schedule to a memo, Naite creates that event on the user's primary Google Calendar (and shows upcoming events in the schedule view). Only events are read and written; calendar settings and sharing are not accessed. |
| `https://www.googleapis.com/auth/tasks` | Sensitive | Memo checklists sync two-way with a Google Tasks list named "나이테 메모" so checking a box in a memo checks the task, and vice versa. Only that list is used. |
| `https://www.googleapis.com/auth/contacts.readonly` | Sensitive | When the user links a person to a memo, Naite searches Google Contacts by name or email and shows matching candidates. Contacts are never downloaded in bulk; a person is stored only when the user registers that one candidate. |
| `openid`, `email`, `profile` | Non-sensitive | Sign-in only: shows the signed-in user's name and email in the app. |

### 쓰지 않는 범위

- `https://www.googleapis.com/auth/drive` (제한된 범주, 전체 Drive 읽기·쓰기) —
  이전에는 원본 앱 메모를 가져오기 위해 썼으나 2026-11-10에 제거했다.
  원본 메모 가져오기는 Drive 파일 선택기(Picker)로 사용자가 직접 파일을
  고르는 방식으로 바꿨다.
- `https://www.googleapis.com/auth/calendar` (전체 캘린더) — 일정 생성·조회에
  필요한 `calendar.events`로 축소했다.

## 개인정보처리방침

- URL: https://naite.plustree.net/privacy
- 내용: 수집 항목(계정 기본 정보·메모·Drive memo 파일·연락한 일정·할 일·연락처
  검색·장소·위치), 수집 목적, 저장 위치(사용자 본인 Drive + 브라우저 로컬 저장소,
  나이테 서버에 저장하지 않음), 제3자 제공 없음, 보관 기간(삭제할 때까지),
  이용자 권리(앱 내 삭제·Drive 파일 삭제·권한 취소), 문의처. 한국어 전문 +
  영문 요약 포함.

## 데모 영상 촬영 대본 (2~3분)

심사 제출 시 데모 영상이 필요하다. 아래 순서로 화면 녹화한다.

1. (0:00) `naite.plustree.net` 접속 — 랜딩 히어로와 "Google로 로그인" 버튼.
2. (0:15) Google 공식 로그인·동의 화면 — 요청 권한(drive.file, calendar.events,
   tasks, contacts.readonly)이 뜨는 것을 보여준다. 고급 → 계속 진행.
3. (0:40) 메모 목록 — 새 메모 작성, 제목·본문·체크리스트 입력, 키워드 자동 추출.
4. (1:10) Drive 동기화 — 설정 → 수동 동기화, Drive memo 폴더에 메모 JSON 파일이
   생기는 것을 Drive 화면에서 함께 보여준다.
5. (1:35) 원본 메모 가져오기 — 설정 → "Drive에서 파일 선택"으로 memo JSON 파일을
   직접 고르면 메모가 들어오는 것을 보여준다.
6. (1:55) 캘린더·할 일 연결 — 메모에 일정 추가 → Google 캘린더에 일정 생성,
   체크리스트 → Google Tasks "나이테 메모" 목록 동기화.
7. (2:20) 연락처 검색 — 사람 연결에서 이름 검색 → 후보 중 한 명만 등록.
8. (2:35) 로그아웃 + 개인정보처리방침 페이지(`/privacy`)를 잠깐 보여준다.

## 심사 제출 체크리스트

### 코드·배포 (완료)

- [x] 요청 범위를 최소 범위로 축소 (`drive.file`, `calendar.events`, `tasks`,
      `contacts.readonly`, `openid`, `email`, `profile`)
- [x] 개인정보처리방침 페이지 `/privacy` 배포
- [x] 푸터에 개인정보처리방침 링크
- [x] 로그인 안내 문구를 최소 범위 기준으로 교체
- [x] Drive 파일 선택기(Picker) 가져오기 구현

### jin이 콘솔에서 직접 해야 할 일

- [ ] Google Cloud Console → API 및 서비스 → OAuth 동의 화면: 앱 이름 `나이테`,
      사용자 지원 이메일, 개발자 연락처 이메일, 앱 로고, 홈페이지 URL
      (`https://naite.plustree.net`), 개인정보처리방침 URL
      (`https://naite.plustree.net/privacy`) 입력
- [ ] OAuth 동의 화면 → 범위: `drive.file`, `calendar.events`, `tasks`,
      `contacts.readonly`, `openid`, `email`, `profile`만 등록돼 있는지 확인.
      `drive`(전체)나 `calendar`(전체)가 남아 있으면 제거
- [ ] OAuth 동의 화면 → "앱 게시" 상태가 아니면 테스트 사용자에 본인 계정
      (`plusredjin@gmail.com`)이 들어 있는지 확인
- [ ] API 및 서비스 → 사용자 인증 정보: OAuth 클라이언트에 승인된 JavaScript 원본
      3개와 리디렉션 URI 3개가 등록돼 있는지 확인
- [ ] API 키 만들기 (Picker용): 사용자 인증 정보 → API 키 생성 → HTTP 리퍼러 제한에
      `https://naite.plustree.net/*`, `https://memo.plustree.net/*`,
      `https://plustree-memo.pages.dev/*` 추가 → 설정 화면에서 키 저장
      (또는 빌드 시 `VITE_GOOGLE_API_KEY`로 주입)
- [ ] 데모 영상 촬영 (위 대본 순서, 2~3분) — YouTube 비공개 링크 또는 파일
- [ ] OAuth 동의 화면 → "확인 요청 제출" (앱 게시) 클릭 → 심사 답변 대기
      (수주~수개월, 보완 요청이 오면 이 문서 기준으로 답한다)

### 심사 후

- [ ] 심사 통과 후 "확인하지 않은 앱" 경고가 사라지는지 본인 계정으로 확인
- [ ] 테스트 모드 제한(100명, 토큰 7일 만료)이 풀렸는지 확인
- [ ] 기존 사용자(본인)는 새 범위(`drive.file` 등)로 다시 로그인해야 함 —
      이전 전체(`drive`) 범위 토큰은 만료 시까지만 유효
