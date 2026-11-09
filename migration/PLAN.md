# 나이테 데이터 마이그레이션 계획

작성: 2026-11-09. 원본: Drive `memo` 폴더 (1메모=1파일 JSON). 목적지: D1 + R2.
원칙: **기존 사용자 데이터를 건드리지 않는다.** 마이그레이션은 읽기 전용 원본에서
읽어 D1로 복원하는 방식이며, Drive 파일은 수정·삭제하지 않는다.

## 원본 형식 (Drive memo 파일 1개)

```json
{
  "id": "memo-uuid",
  "title": "메모 제목",
  "categoryId": "cat-uuid | null",
  "color": "#hex | null",
  "pinned": false,
  "updatedAt": "2026-11-08T10:00:00.000Z",
  "blocks": [
    {"id": "block-uuid", "type": "paragraph", "text": "...", "checked": false, "dueDate": null}
  ]
}
```

- `type`: paragraph | todo | photo | voice | schedule
- 사진·음성 블록은 같은 Drive 폴더의 첨부 파일명을 `attachmentId`로 참조한다.
  (memoaeb 스펙: 사진·음성은 같은 폴더에 파일로 저장하고 링크)

## 단계

### 1단계 — 인벤토리 (읽기만, dry-run)

- `GET /api/drive/status`로 memo 폴더 존재·동기화 메모 수 확인.
- `POST /api/drive/import?dryRun=1`로 가져올 파일 목록·개수 확인.
- Drive 파일 중 JSON 파싱이 안 되는 파일은 목록에 남기고 건너뛴다 (삭제하지 않음).

### 2단계 — D1 복원 (멱등)

- `POST /api/drive/import` 실행. Worker의 `upsertMemoFromDrive`가
  `drive_file_id` 기준으로 이미 있으면 갱신, 없으면 생성한다.
  같은 파일을 두 번 가져와도 중복 메모가 생기지 않는다.
- 카테고리는 메모 파일의 `categoryId`를 그대로 쓴다. 카테고리 자체가 Drive에
  없으면 메모는 미분류로 들어가고, 이후 `/api/categories`로 다시 묶는다.
- 키워드는 가져오기 후에 `POST /api/memos/:id/extract-keywords`로 다시 뽑는다
  (Drive 파일에는 키워드 노드가 없을 수 있다).
- 온톨로지 간선(keyword_parents·keyword_links)은 Drive 파일에 없으므로,
  마이그레이션 후 분석 대시보드에서 AI 왕복(JSON)으로 다시 만든다.

### 3단계 — 첨부파일 (사진·음성) R2 이관

- Drive memo 폴더의 첨부 파일(이미지·음성)을 `POST /api/attachments/upload`로
  R2에 올리고, 블록의 `attachmentId`를 새 첨부 ID로 교체한다.
- 원본 Drive 첨부 파일은 지우지 않는다 (백업으로 남긴다).
- 20MB 초과 파일은 건너뛰고 목록에 남긴다 (Worker 업로드 제한).

### 4단계 — 검증

- `GET /api/analytics/summary`로 메모 수·키워드 수·연결 수를 Drive 파일 수와 대조.
- 무작위 메모 5개를 열어 제목·본문·체크리스트·사진이 맞는지 눈으로 확인.
- `GET /api/drive/status`의 `syncedMemoCount`와 D1 메모 수가 같은지 확인.
- 불일치가 있으면 그 메모만 `POST /api/drive/memos/:id/push`로 다시 올리거나
  `POST /api/drive/import`를 다시 실행한다 (멱등이라 안전).

### 5단계 — 전환 후

- 새 메모는 D1이 1차 저장소가 되고, Drive는 `POST /api/drive/memos/:id/push`와
  30분 크론 동기화로 백업·동기화한다.
- 전환 전 Muse 앱(memoaeb)은 그대로 둔다. 문제 생기면 Muse 앱으로 돌아갈 수 있다.

## 실행 스크립트

- `migration/migrate.ts`: 위 단계를 순서대로 실행하는 스크립트 (틀).
  기본값은 `--dry-run`이다. 실제 적용은 `--apply`를 명시해야 한다.
- 실행에는 Worker 세션 쿠키(`NAITE_SESSION_COOKIE`)가 필요하다.
  OAuth 연결 전에는 실행하지 않는다 (jin 결정: 테스트는 연결 없이, 마지막에 연결).

## 롤백

- D1은 마이그레이션 전 스냅샷을 뜰 수 없으므로, 적용 전에 `wrangler d1 export`로
  백업을 만든다. 문제 생기면 백업으로 복원한다.
- Drive 원본은 건드리지 않았으므로, D1을 비우고 다시 가져오면 된다.
