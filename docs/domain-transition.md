# 도메인 전환 절차 (naite.plustree.net → Pages + Workers)

작성: 2026-11-09. **실제 전환은 아직 하지 않는다.** 전환 조건이 다 갖춰진 뒤에
이 절차대로 실행한다. 전환 전에는 `naite.plustree.net`·`memo.plustree.net` 모두
정적 목업을 서빙 중인 상태로 둔다.

## 전환 조건 (전부 갖춰져야 실행)

- [ ] 정적 프론트엔드 재구축 완료 + `plustree-memo.pages.dev`에서 동작 확인
- [ ] Worker 배포 완료 (`wrangler deploy`, `api.naite.plustree.net` 응답 확인)
- [ ] D1·KV·R2 생성 + 마이그레이션(0001·0002) 적용
- [ ] 데이터 마이그레이션 완료 + 검증 완료 (migration/PLAN.md 4단계)
- [ ] 그록 로그인 동작 확인 (로그인 → 세션 → 메모 목록까지)
- [ ] Google OAuth 클라이언트 생성 완료 (jin, 맨 마지막) + secrets 등록
- [ ] 종단 테스트 완료 (로그인 → 메모 작성 → Drive 동기화 → 캘린더·할일·연락처·장소)

## 현재 DNS·배포 상태 (2026-11-08 확인)

| 항목 | 상태 |
|---|---|
| `naite.plustree.net` | Cloudflare active. 가비아 CNAME → `plustree-memo.pages.dev` |
| `memo.plustree.net` | Cloudflare active. 가비아 CNAME → `plustree-memo.pages.dev` |
| `plustree-memo.pages.dev` | Pages 프로젝트 `plustree-memo` (플러스트리 계정). 정적 목업 서빙 중 |
| `api.naite.plustree.net` | 아직 없음. Worker 배포 후 커스텀 도메인으로 연결 |

## 전환 순서

### 1. Worker API 도메인 연결

1. Cloudflare 대시보드 → Workers & Pages → `naite-api` → Settings → Custom Domains
   → `api.naite.plustree.net` 추가 (또는 `wrangler.toml` routes로 지정).
2. `curl https://api.naite.plustree.net/api/health` → `{"ok":true}` 확인.
3. `curl https://api.naite.plustree.net/api/bootstrap` → 세션 없이 401 확인
   (401이 정상 — 세션이 없다는 뜻).

### 2. Pages 프론트엔드 교체

1. Pages 프로젝트 `plustree-memo`의 빌드 설정을 `frontend/` 기준으로 변경:
   Framework preset `Vite`, Build command `npm run build`, Output directory `dist`,
   환경변수 `VITE_API_BASE_URL=https://api.naite.plustree.net`.
2. GitHub `plusredjin-gif/naite-pages-workers` main에 push하면 자동 배포되게 연결
   (또는 `wrangler pages deploy frontend/dist --project-name=plustree-memo`로 수동 배포).
3. `https://plustree-memo.pages.dev`에서 새 프론트엔드가 뜨는지 확인.
   기존 목업은 교체 전에 `~/workspace/your_files/memo-deploy/` 백업을 확인한다.

### 3. 커스텀 도메인 확인

1. `https://naite.plustree.net` 접속 → 새 프론트엔드 표시 확인
   (CNAME은 이미 `plustree-memo.pages.dev`를 가리키고 있어 DNS 변경 불필요).
2. 로그인 → 메모 목록 → 메모 작성 → Drive 동기화까지 종단 확인.
3. `memo.plustree.net`은 전환 완료 전까지 그대로 둔다 (구 목업 유지, 롤백용).

### 4. 전환 완료 후

1. `memo.plustree.net` 처리 여부를 jin에게 확인한다 (삭제할지, naite로 리디렉션할지).
2. 전환 완료를 jin에게 알린다 (jin 요청: 메모앱 다 되면 알려주기).

## 롤백

- **프론트엔드 롤백**: Pages 배포 기록에서 이전 배포(목업)로 Rollback.
  `naite.plustree.net`은 CNAME이라 DNS를 건드릴 필요가 없다.
- **API 롤백**: `wrangler rollback`으로 이전 Worker 배포로 되돌린다.
- **데이터 롤백**: D1은 마이그레이션 전 백업(`wrangler d1 export`)으로 복원한다.
  Drive 원본은 건드리지 않았으므로 다시 가져올 수 있다.
- **최후 수단**: Muse 앱(memoaeb)은 그대로 두므로, 문제 생기면 Muse 앱으로 돌아간다.
