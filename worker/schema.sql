-- 나이테 D1 스키마 (초안)
-- memoaeb의 서버 모델을 D1으로 옮긴 것. 다대다 온톨로지 간선(keyword_parents) 포함.
-- 적용: wrangler d1 execute naite-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- Google sub
  email TEXT,
  display_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  parent_id TEXT REFERENCES categories(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id),
  color TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  drive_file_id TEXT,                -- Drive memo 폴더의 파일 ID (1메모=1파일)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,                -- paragraph | todo | photo | voice | schedule
  text TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  attachment_id TEXT,
  due_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  memo_id TEXT REFERENCES memos(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,              -- R2 오브젝트 키
  mime TEXT,
  size INTEGER,
  drive_file_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 온톨로지: 키워드 노드 + 다대다 상위 간선 + 관련 링크
CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS keyword_parents (
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  locked INTEGER NOT NULL DEFAULT 0, -- 사용자가 직접 정한 간선은 AI import가 건드리지 않음
  PRIMARY KEY (keyword_id, parent_id)
);

CREATE TABLE IF NOT EXISTS keyword_links (
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  related_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (keyword_id, related_id)
);

CREATE TABLE IF NOT EXISTS memo_keywords (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY (memo_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  google_resource_name TEXT,         -- People API resourceName (검색으로 등록한 사람만)
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,                -- 역지오코딩 지역명 (예: 서울특별시 강남구 역삼동)
  lat REAL,
  lng REAL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS memo_people (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (memo_id, person_id)
);

CREATE TABLE IF NOT EXISTS memo_places (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  PRIMARY KEY (memo_id, place_id)
);

CREATE TABLE IF NOT EXISTS memo_locations (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (memo_id, location_id)
);

CREATE TABLE IF NOT EXISTS memo_events (
  memo_id TEXT PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
  google_event_id TEXT,
  start_at TEXT,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_links (
  block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  google_task_id TEXT,
  task_list_id TEXT
);

-- AI 온톨로지 왕복: 적용 전 스냅샷을 JSON으로 저장해 되돌리기
CREATE TABLE IF NOT EXISTS ontology_revisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  snapshot_json TEXT NOT NULL,
  change_summary TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memos_user ON memos(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_blocks_memo ON blocks(memo_id, position);
CREATE INDEX IF NOT EXISTS idx_keywords_user ON keywords(user_id);
