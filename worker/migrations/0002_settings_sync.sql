-- 나이테 D1 마이그레이션 0002: 설정 + 동기화 상태
-- schema.sql 다음에 적용: wrangler d1 execute naite-db --file=migrations/0002_settings_sync.sql
-- api.ts의 설정(/api/settings)과 크론 동기화(sync.ts)가 이 테이블을 쓴다.

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS sync_state (
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,                -- 'cron' | 'drive' | 'tasks'
  last_run_at TEXT,
  last_ok_at TEXT,
  detail TEXT,                       -- JSON 요약 (가져온 메모 수, 오류 등)
  PRIMARY KEY (user_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
