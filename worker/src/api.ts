/**
 * 나이테 API Worker — 로그인 외 기능 (api.ts)
 *
 * 범위: 로그인(/api/auth/*)은 그록 소유. 이 파일은 로그인 코드를 일절 포함하지 않는다.
 * index.ts에서 로그인 라우트와 googleProxy 뒤에 연결된다.
 * index.ts가 넘겨주는 helpers(getSessionUserId, getAccessToken, googleProxy, json)만
 * 사용하므로, 로그인 구현이 바뀌어도 이 파일은 그대로 동작한다.
 * (단, 세션 쿠키 형식(naite_session=<sub>.<hmac>)이 바뀌면 index.ts의
 * getSessionUserId와 docs/LOGIN_SEAM.md를 함께 바꿔야 한다 — 연동 지점.)
 *
 * 엔드포인트 목록 (전부 세션 필요, /api/health 제외):
 *   카테고리  GET/POST /api/categories, PATCH/DELETE /api/categories/:id
 *   메모      GET /api/memos, POST /api/memos, GET/PATCH/DELETE /api/memos/:id
 *             POST /api/memos/:id/blocks, PATCH/DELETE /api/blocks/:id
 *   키워드    GET/POST /api/keywords, POST /api/keywords/:id/parents|related,
 *             DELETE /api/keywords/:id/parents/:parentId|related/:relatedId,
 *             POST /api/memos/:id/extract-keywords
 *   온톨로지  GET /api/ontology/graph, POST /api/ontology/import/preview|apply,
 *             GET /api/ontology/revisions, POST /api/ontology/revisions/:id/undo
 *   사람      GET /api/people, POST /api/people, DELETE /api/people/:id,
 *             GET /api/people/search?q= (People API 검색만, 전체 열거 없음)
 *   장소      GET /api/places, POST /api/places, DELETE /api/places/:id,
 *             GET /api/places/search?q= (Geocoding, 좌표 불확실 시 null)
 *   위치      GET /api/locations, POST /api/memos/:id/geo
 *   캘린더    POST /api/calendar/events, GET /api/calendar/agenda?days=30
 *   할일      GET /api/tasks, POST /api/tasks/sync
 *   Drive     GET /api/drive/status, POST /api/drive/sync, POST /api/drive/import,
 *             POST /api/drive/memos/:id/push
 *   첨부      POST /api/attachments/upload, GET /api/attachments/:id
 *   분석      GET /api/analytics/summary, GET /api/analytics/prompt
 *   설정      GET /api/settings, PATCH /api/settings
 *   부트스트랩 GET /api/bootstrap
 */

export interface ApiEnv {
  DB: D1Database;
  TOKENS: KVNamespace;
  ATTACHMENTS: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  OAUTH_REDIRECT_URI: string;
  GOOGLE_AUTH_URL: string;
  GOOGLE_TOKEN_URL: string;
  GOOGLE_MAPS_API_KEY?: string;
}

export interface ApiHelpers {
  json: (data: unknown, status?: number) => Response;
  getSessionUserId: (req: Request, env: ApiEnv) => Promise<string | null>;
  getAccessToken: (userId: string, env: ApiEnv) => Promise<string | null>;
  googleProxy: (req: Request, env: ApiEnv, path: string) => Promise<Response>;
}

/* ---------------- CORS (Pages 정적 프론트엔드에서 api 도메인 호출용) ---------------- */

const ALLOWED_ORIGINS = new Set([
  "https://naite.plustree.net",
  "https://memo.plustree.net",
  "https://plustree-memo.pages.dev",
  "http://localhost:5173",
  "http://localhost:3000",
]);

export function corsPreflightHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}

function withCors(res: Response, req: Request): Response {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return res;
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return new Response(res.body, { status: res.status, headers });
}

/* ---------------- 공용 헬퍼 ---------------- */

function uid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function requireUser(
  req: Request,
  env: ApiEnv,
  h: ApiHelpers,
): Promise<string | Response> {
  const userId = await h.getSessionUserId(req, env);
  if (!userId) return h.json({ error: "unauthorized" }, 401);
  return userId;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** access_token으로 Google API를 직접 호출한다 (중계 프록시와 달리 응답 JSON을 쓴다). */
async function googleFetch(
  env: ApiEnv,
  h: ApiHelpers,
  userId: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await h.getAccessToken(userId, env);
  if (!token) {
    return new Response(JSON.stringify({ error: "token_expired_relogin_required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function ensureUser(env: ApiEnv, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id) VALUES (?)",
  )
    .bind(userId)
    .run();
}

/* ---------------- 키워드 자동 추출 (규칙 기반 — 의미 분석은 AI 왕복으로) ---------------- */

const KEYWORD_STOPWORDS = new Set([
  "이", "그", "저", "것", "수", "등", "및", "또", "더", "잘", "좀", "것이다",
  "있다", "없다", "하다", "되다", "이다", "가다", "오다", "보다", "이다.",
  "the", "and", "for", "with", "this", "that", "from", "into",
]);

export function extractKeywords(text: string): string[] {
  const found = new Map<string, number>();
  // 1) 해시태그 우선
  for (const m of text.matchAll(/#([^\s#.,!?()[\]{}"']+)/g)) {
    const tag = m[1].trim();
    if (tag.length >= 2) found.set(tag, (found.get(tag) ?? 0) + 10);
  }
  // 2) 2자 이상 토큰 빈도 (한글·영문)
  for (const m of text.matchAll(/[가-힣]{2,}|[A-Za-z][A-Za-z0-9_-]{1,}/g)) {
    const w = m[0];
    if (KEYWORD_STOPWORDS.has(w)) continue;
    found.set(w, (found.get(w) ?? 0) + 1);
  }
  return [...found.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

async function getOrCreateKeyword(
  env: ApiEnv,
  userId: string,
  name: string,
): Promise<string> {
  const id = uid();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO keywords (id, user_id, name) VALUES (?, ?, ?)",
  )
    .bind(id, userId, name)
    .run();
  const row = await env.DB.prepare(
    "SELECT id FROM keywords WHERE user_id = ? AND name = ?",
  )
    .bind(userId, name)
    .first<{ id: string }>();
  return row?.id ?? id;
}

/* ---------------- 카테고리 ---------------- */

async function listCategories(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, color, icon, parent_id AS parentId, created_at AS createdAt, updated_at AS updatedAt FROM categories WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(userId)
    .all();
  return h.json({ categories: results ?? [] });
}

async function createCategory(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  if (!isNonEmptyString(body.name)) return h.json({ error: "name_required" }, 400);
  const id = uid();
  await env.DB.prepare(
    "INSERT INTO categories (id, user_id, name, color, icon, parent_id) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      userId,
      (body.name as string).trim(),
      (body.color as string) ?? null,
      (body.icon as string) ?? null,
      (body.parentId as string) ?? null,
    )
    .run();
  return h.json({ id }, 201);
}

async function updateCategory(req: Request, env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const body = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (isNonEmptyString(body.name)) { sets.push("name = ?"); vals.push((body.name as string).trim()); }
  if (body.color !== undefined) { sets.push("color = ?"); vals.push(body.color); }
  if (body.icon !== undefined) { sets.push("icon = ?"); vals.push(body.icon); }
  if (body.parentId !== undefined) { sets.push("parent_id = ?"); vals.push(body.parentId); }
  if (sets.length === 0) return h.json({ error: "nothing_to_update" }, 400);
  sets.push("updated_at = ?");
  vals.push(nowIso());
  const res = await env.DB.prepare(
    `UPDATE categories SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  )
    .bind(...vals, id, userId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return h.json({ error: "not_found" }, 404);
  return h.json({ ok: true });
}

async function deleteCategory(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  // 하위 카테고리와 메모는 미분류로 푼다 (삭제 시 데이터 소실 방지).
  await env.DB.batch([
    env.DB.prepare("UPDATE categories SET parent_id = NULL WHERE parent_id = ? AND user_id = ?").bind(id, userId),
    env.DB.prepare("UPDATE memos SET category_id = NULL WHERE category_id = ? AND user_id = ?").bind(id, userId),
    env.DB.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return h.json({ ok: true });
}

/* ---------------- 메모·블록 ---------------- */

type MemoRow = {
  id: string;
  title: string;
  category_id: string | null;
  color: string | null;
  pinned: number;
  drive_file_id: string | null;
  created_at: string;
  updated_at: string;
};

async function listMemos(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId");
  const search = url.searchParams.get("search")?.trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const sort = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const conds = ["m.user_id = ?"];
  const vals: unknown[] = [userId];
  if (categoryId) { conds.push("m.category_id = ?"); vals.push(categoryId); }
  if (search) {
    conds.push("(m.title LIKE ? OR EXISTS (SELECT 1 FROM blocks b WHERE b.memo_id = m.id AND b.text LIKE ?))");
    vals.push(`%${search}%`, `%${search}%`);
  }
  if (from) { conds.push("m.updated_at >= ?"); vals.push(from); }
  if (to) { conds.push("m.updated_at <= ?"); vals.push(to); }

  const where = `WHERE ${conds.join(" AND ")}`;
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memos m ${where}`)
    .bind(...vals)
    .first<{ n: number }>();
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.title, m.category_id AS categoryId, m.color, m.pinned, m.drive_file_id AS driveFileId,
            m.created_at AS createdAt, m.updated_at AS updatedAt,
            (SELECT b.text FROM blocks b WHERE b.memo_id = m.id ORDER BY b.position ASC LIMIT 1) AS preview
     FROM memos m ${where}
     ORDER BY m.pinned DESC, m.updated_at ${sort} LIMIT ? OFFSET ?`,
  )
    .bind(...vals, limit, offset)
    .all();
  return h.json({ memos: results ?? [], total: total?.n ?? 0, limit, offset });
}

async function createMemo(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const id = uid();
  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO memos (id, user_id, title, category_id, color, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      userId,
      (body.title as string) ?? "",
      (body.categoryId as string) ?? null,
      (body.color as string) ?? null,
      body.pinned ? 1 : 0,
      ts,
      ts,
    ),
    // 새 메모는 제목 밑에 빈 단락 블록을 기본으로 깐다 (memoaeb 스펙).
    env.DB.prepare(
      "INSERT INTO blocks (id, memo_id, position, type, text, checked) VALUES (?, ?, 0, 'paragraph', '', 0)",
    ).bind(uid(), id),
  ]);
  return h.json({ id }, 201);
}

async function getMemo(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const memo = await env.DB.prepare(
    "SELECT id, title, category_id AS categoryId, color, pinned, drive_file_id AS driveFileId, created_at AS createdAt, updated_at AS updatedAt FROM memos WHERE id = ? AND user_id = ?",
  )
    .bind(id, userId)
    .first<MemoRow>();
  if (!memo) return h.json({ error: "not_found" }, 404);
  const { results: blocks } = await env.DB.prepare(
    "SELECT id, position, type, text, checked, attachment_id AS attachmentId, due_date AS dueDate FROM blocks WHERE memo_id = ? ORDER BY position ASC",
  )
    .bind(id)
    .all();
  const { results: keywords } = await env.DB.prepare(
    "SELECT k.id, k.name FROM memo_keywords mk JOIN keywords k ON k.id = mk.keyword_id WHERE mk.memo_id = ?",
  )
    .bind(id)
    .all();
  const { results: people } = await env.DB.prepare(
    "SELECT p.id, p.name, p.email FROM memo_people mp JOIN people p ON p.id = mp.person_id WHERE mp.memo_id = ?",
  )
    .bind(id)
    .all();
  const { results: places } = await env.DB.prepare(
    "SELECT p.id, p.name, p.address, p.lat, p.lng FROM memo_places mp JOIN places p ON p.id = mp.place_id WHERE mp.memo_id = ?",
  )
    .bind(id)
    .all();
  const { results: locations } = await env.DB.prepare(
    "SELECT l.id, l.name, l.lat, l.lng FROM memo_locations ml JOIN locations l ON l.id = ml.location_id WHERE ml.memo_id = ?",
  )
    .bind(id)
    .all();
  const event = await env.DB.prepare(
    "SELECT google_event_id AS googleEventId, start_at AS startAt, end_at AS endAt, all_day AS allDay FROM memo_events WHERE memo_id = ?",
  )
    .bind(id)
    .first();
  return h.json({ ...memo, blocks: blocks ?? [], keywords: keywords ?? [], people: people ?? [], places: places ?? [], locations: locations ?? [], event: event ?? null });
}

async function updateMemo(req: Request, env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const body = await readJson(req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.title !== undefined) { sets.push("title = ?"); vals.push(body.title); }
  if (body.categoryId !== undefined) { sets.push("category_id = ?"); vals.push(body.categoryId); }
  if (body.color !== undefined) { sets.push("color = ?"); vals.push(body.color); }
  if (body.pinned !== undefined) { sets.push("pinned = ?"); vals.push(body.pinned ? 1 : 0); }
  if (body.driveFileId !== undefined) { sets.push("drive_file_id = ?"); vals.push(body.driveFileId); }
  if (sets.length === 0) return h.json({ error: "nothing_to_update" }, 400);
  sets.push("updated_at = ?");
  vals.push(nowIso());
  const res = await env.DB.prepare(
    `UPDATE memos SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  )
    .bind(...vals, id, userId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return h.json({ error: "not_found" }, 404);
  return h.json({ ok: true });
}

async function deleteMemo(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const res = await env.DB.prepare("DELETE FROM memos WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return h.json({ error: "not_found" }, 404);
  return h.json({ ok: true });
}

async function addBlock(req: Request, env: ApiEnv, userId: string, memoId: string, h: ApiHelpers) {
  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?")
    .bind(memoId, userId)
    .first();
  if (!memo) return h.json({ error: "not_found" }, 404);
  const body = await readJson(req);
  const type = ["paragraph", "todo", "photo", "voice", "schedule"].includes(body.type as string)
    ? (body.type as string)
    : "paragraph";
  const maxPos = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM blocks WHERE memo_id = ?")
    .bind(memoId)
    .first<{ m: number }>();
  const id = uid();
  await env.DB.prepare(
    "INSERT INTO blocks (id, memo_id, position, type, text, checked, attachment_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      memoId,
      (maxPos?.m ?? -1) + 1,
      type,
      (body.text as string) ?? "",
      body.checked ? 1 : 0,
      (body.attachmentId as string) ?? null,
      (body.dueDate as string) ?? null,
    )
    .run();
  await env.DB.prepare("UPDATE memos SET updated_at = ? WHERE id = ?").bind(nowIso(), memoId).run();
  return h.json({ id }, 201);
}

async function updateBlock(req: Request, env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const body = await readJson(req);
  const owner = await env.DB.prepare(
    "SELECT b.memo_id AS memoId FROM blocks b JOIN memos m ON m.id = b.memo_id WHERE b.id = ? AND m.user_id = ?",
  )
    .bind(id, userId)
    .first<{ memoId: string }>();
  if (!owner) return h.json({ error: "not_found" }, 404);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.text !== undefined) { sets.push("text = ?"); vals.push(body.text); }
  if (body.checked !== undefined) { sets.push("checked = ?"); vals.push(body.checked ? 1 : 0); }
  if (body.position !== undefined) { sets.push("position = ?"); vals.push(body.position); }
  if (body.dueDate !== undefined) { sets.push("due_date = ?"); vals.push(body.dueDate); }
  if (body.attachmentId !== undefined) { sets.push("attachment_id = ?"); vals.push(body.attachmentId); }
  if (sets.length === 0) return h.json({ error: "nothing_to_update" }, 400);
  await env.DB.prepare(`UPDATE blocks SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  await env.DB.prepare("UPDATE memos SET updated_at = ? WHERE id = ?").bind(nowIso(), owner.memoId).run();
  return h.json({ ok: true });
}

async function deleteBlock(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const owner = await env.DB.prepare(
    "SELECT b.memo_id AS memoId FROM blocks b JOIN memos m ON m.id = b.memo_id WHERE b.id = ? AND m.user_id = ?",
  )
    .bind(id, userId)
    .first<{ memoId: string }>();
  if (!owner) return h.json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM blocks WHERE id = ?").bind(id).run();
  await env.DB.prepare("UPDATE memos SET updated_at = ? WHERE id = ?").bind(nowIso(), owner.memoId).run();
  return h.json({ ok: true });
}

/* ---------------- 키워드·온톨로지 ---------------- */

async function listKeywords(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results: keywords } = await env.DB.prepare(
    "SELECT id, name, created_at AS createdAt FROM keywords WHERE user_id = ? ORDER BY name ASC",
  )
    .bind(userId)
    .all();
  const { results: parents } = await env.DB.prepare(
    "SELECT kp.keyword_id AS keywordId, kp.parent_id AS parentId, kp.locked FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all();
  const { results: links } = await env.DB.prepare(
    "SELECT kl.keyword_id AS keywordId, kl.related_id AS relatedId, kl.locked FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all();
  return h.json({ keywords: keywords ?? [], parents: parents ?? [], links: links ?? [] });
}

async function createKeyword(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  if (!isNonEmptyString(body.name)) return h.json({ error: "name_required" }, 400);
  const id = await getOrCreateKeyword(env, userId, (body.name as string).trim());
  return h.json({ id }, 201);
}

/** 간선 추가 시 순환을 거부한다 (A가 B의 상위인데 B를 A의 상위로 거는 경우). */
async function wouldCycle(env: ApiEnv, userId: string, keywordId: string, parentId: string): Promise<boolean> {
  // parentId에서 시작해 상위 간선을 따라가다 keywordId에 닿으면 순환.
  const seen = new Set<string>();
  let frontier = [parentId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const cur of frontier) {
      if (cur === keywordId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const { results } = await env.DB.prepare(
        "SELECT parent_id AS parentId FROM keyword_parents WHERE keyword_id = ?",
      )
        .bind(cur)
        .all<{ parentId: string }>();
      for (const r of results ?? []) next.push(r.parentId);
    }
    frontier = next;
  }
  return false;
}

async function addParentEdge(req: Request, env: ApiEnv, userId: string, keywordId: string, h: ApiHelpers) {
  const body = await readJson(req);
  if (!isNonEmptyString(body.parentId)) return h.json({ error: "parentId_required" }, 400);
  const parentId = body.parentId as string;
  const kw = await env.DB.prepare("SELECT id FROM keywords WHERE id = ? AND user_id = ?")
    .bind(keywordId, userId)
    .first();
  const parent = await env.DB.prepare("SELECT id FROM keywords WHERE id = ? AND user_id = ?")
    .bind(parentId, userId)
    .first();
  if (!kw || !parent) return h.json({ error: "not_found" }, 404);
  if (keywordId === parentId) return h.json({ error: "self_parent" }, 400);
  if (await wouldCycle(env, userId, keywordId, parentId)) {
    return h.json({ error: "cycle_rejected" }, 400);
  }
  await env.DB.prepare(
    "INSERT OR REPLACE INTO keyword_parents (keyword_id, parent_id, locked) VALUES (?, ?, ?)",
  )
    .bind(keywordId, parentId, body.locked ? 1 : 0)
    .run();
  return h.json({ ok: true });
}

async function removeParentEdge(env: ApiEnv, userId: string, keywordId: string, parentId: string, h: ApiHelpers) {
  const edge = await env.DB.prepare(
    "SELECT kp.locked FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE kp.keyword_id = ? AND kp.parent_id = ? AND k.user_id = ?",
  )
    .bind(keywordId, parentId, userId)
    .first<{ locked: number }>();
  if (!edge) return h.json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM keyword_parents WHERE keyword_id = ? AND parent_id = ?")
    .bind(keywordId, parentId)
    .run();
  return h.json({ ok: true, wasLocked: edge.locked === 1 });
}

async function addRelatedLink(req: Request, env: ApiEnv, userId: string, keywordId: string, h: ApiHelpers) {
  const body = await readJson(req);
  if (!isNonEmptyString(body.relatedId)) return h.json({ error: "relatedId_required" }, 400);
  const relatedId = body.relatedId as string;
  const kw = await env.DB.prepare("SELECT id FROM keywords WHERE id = ? AND user_id = ?")
    .bind(keywordId, userId)
    .first();
  const rel = await env.DB.prepare("SELECT id FROM keywords WHERE id = ? AND user_id = ?")
    .bind(relatedId, userId)
    .first();
  if (!kw || !rel) return h.json({ error: "not_found" }, 404);
  if (keywordId === relatedId) return h.json({ error: "self_link" }, 400);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO keyword_links (keyword_id, related_id, locked) VALUES (?, ?, ?)")
      .bind(keywordId, relatedId, body.locked ? 1 : 0),
    env.DB.prepare("INSERT OR REPLACE INTO keyword_links (keyword_id, related_id, locked) VALUES (?, ?, ?)")
      .bind(relatedId, keywordId, body.locked ? 1 : 0),
  ]);
  return h.json({ ok: true });
}

async function removeRelatedLink(env: ApiEnv, userId: string, keywordId: string, relatedId: string, h: ApiHelpers) {
  const link = await env.DB.prepare(
    "SELECT kl.locked FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE kl.keyword_id = ? AND kl.related_id = ? AND k.user_id = ?",
  )
    .bind(keywordId, relatedId, userId)
    .first<{ locked: number }>();
  if (!link) return h.json({ error: "not_found" }, 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM keyword_links WHERE keyword_id = ? AND related_id = ?").bind(keywordId, relatedId),
    env.DB.prepare("DELETE FROM keyword_links WHERE keyword_id = ? AND related_id = ?").bind(relatedId, keywordId),
  ]);
  return h.json({ ok: true, wasLocked: link.locked === 1 });
}

async function extractKeywordsForMemo(env: ApiEnv, userId: string, memoId: string, h: ApiHelpers) {
  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?")
    .bind(memoId, userId)
    .first();
  if (!memo) return h.json({ error: "not_found" }, 404);
  const { results: blocks } = await env.DB.prepare("SELECT text FROM blocks WHERE memo_id = ? AND type IN ('paragraph', 'todo')")
    .bind(memoId)
    .all<{ text: string }>();
  const title = await env.DB.prepare("SELECT title FROM memos WHERE id = ?").bind(memoId).first<{ title: string }>();
  const text = [title?.title ?? "", ...(blocks ?? []).map((b) => b.text ?? "")].join("\n");
  const names = extractKeywords(text);
  const linked: string[] = [];
  for (const name of names) {
    const kid = await getOrCreateKeyword(env, userId, name);
    await env.DB.prepare("INSERT OR IGNORE INTO memo_keywords (memo_id, keyword_id) VALUES (?, ?)")
      .bind(memoId, kid)
      .run();
    linked.push(name);
  }
  return h.json({ keywords: linked });
}

async function ontologyGraph(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results: keywords } = await env.DB.prepare("SELECT id, name FROM keywords WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; name: string }>();
  const { results: parents } = await env.DB.prepare(
    "SELECT kp.keyword_id AS fromId, kp.parent_id AS toId, kp.locked FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all();
  const { results: links } = await env.DB.prepare(
    "SELECT kl.keyword_id AS fromId, kl.related_id AS toId, kl.locked FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all();
  const { results: memoKeywords } = await env.DB.prepare(
    "SELECT mk.memo_id AS memoId, mk.keyword_id AS keywordId FROM memo_keywords mk JOIN memos m ON m.id = mk.memo_id WHERE m.user_id = ?",
  )
    .bind(userId)
    .all();
  const { results: people } = await env.DB.prepare("SELECT id, name FROM people WHERE user_id = ?")
    .bind(userId)
    .all();
  const { results: places } = await env.DB.prepare("SELECT id, name, lat, lng FROM places WHERE user_id = ?")
    .bind(userId)
    .all();
  const { results: locations } = await env.DB.prepare("SELECT id, name, lat, lng FROM locations WHERE user_id = ?")
    .bind(userId)
    .all();
  return h.json({
    keywords: keywords ?? [],
    parentEdges: (parents ?? []).map((e) => ({ ...e, kind: "parent" })),
    relatedEdges: (links ?? []).map((e) => ({ ...e, kind: "related" })),
    memoKeywords: memoKeywords ?? [],
    people: people ?? [],
    places: places ?? [],
    locations: locations ?? [],
  });
}

type OntologyImportInput = {
  keywords?: Array<{ name: string; parents?: string[]; parent?: string; related?: string[] }>;
  linksToRemove?: Array<{ from: string; to: string; kind?: "parent" | "related" }>;
};

function parseOntologyJson(raw: string): OntologyImportInput | null {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as OntologyImportInput;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keywords)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function previewOntologyImport(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const input = parseOntologyJson(typeof body.json === "string" ? body.json : JSON.stringify(body));
  if (!input) return h.json({ ok: false, error: "invalid_json" }, 400);
  const { results: existing } = await env.DB.prepare("SELECT id, name FROM keywords WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; name: string }>();
  const byName = new Map((existing ?? []).map((k) => [k.name, k.id]));
  const { results: lockedParents } = await env.DB.prepare(
    "SELECT kp.keyword_id AS keywordId, kp.parent_id AS parentId FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE k.user_id = ? AND kp.locked = 1",
  )
    .bind(userId)
    .all<{ keywordId: string; parentId: string }>();
  const lockedParentSet = new Set((lockedParents ?? []).map((e) => `${e.keywordId}|${e.parentId}`));
  const { results: lockedLinks } = await env.DB.prepare(
    "SELECT kl.keyword_id AS keywordId, kl.related_id AS relatedId FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE k.user_id = ? AND kl.locked = 1",
  )
    .bind(userId)
    .all<{ keywordId: string; relatedId: string }>();
  const lockedLinkSet = new Set((lockedLinks ?? []).map((e) => `${e.keywordId}|${e.relatedId}`));

  const newKeywords: string[] = [];
  const parentChanges: Array<{ keyword: string; parent: string }> = [];
  const linksAdded: Array<{ from: string; to: string }> = [];
  const skippedLocked: Array<{ keyword: string; parent?: string; related?: string }> = [];

  for (const kw of input.keywords ?? []) {
    if (!kw.name) continue;
    if (!byName.has(kw.name)) newKeywords.push(kw.name);
    const parents = kw.parents ?? (kw.parent ? [kw.parent] : []);
    for (const p of parents) {
      const kid = byName.get(kw.name);
      const pid = byName.get(p);
      if (kid && pid && lockedParentSet.has(`${kid}|${pid}`)) {
        skippedLocked.push({ keyword: kw.name, parent: p });
      } else {
        parentChanges.push({ keyword: kw.name, parent: p });
      }
    }
    for (const r of kw.related ?? []) {
      const kid = byName.get(kw.name);
      const rid = byName.get(r);
      if (kid && rid && lockedLinkSet.has(`${kid}|${rid}`)) {
        skippedLocked.push({ keyword: kw.name, related: r });
      } else {
        linksAdded.push({ from: kw.name, to: r });
      }
    }
  }
  const removals = (input.linksToRemove ?? []).filter((l) => {
    const kid = byName.get(l.from);
    const tid = byName.get(l.to);
    if (!kid || !tid) return false;
    if (l.kind === "parent") return !lockedParentSet.has(`${kid}|${tid}`);
    return !lockedLinkSet.has(`${kid}|${tid}`);
  });
  return h.json({
    ok: true,
    newKeywords,
    parentChanges,
    linksAdded,
    linksToRemove: removals,
    skippedLocked,
  });
}

async function applyOntologyImport(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const input = parseOntologyJson(typeof body.json === "string" ? body.json : JSON.stringify(body));
  if (!input) return h.json({ ok: false, error: "invalid_json" }, 400);

  // 1) 적용 전 스냅샷 저장 (되돌리기용)
  const { results: snapParents } = await env.DB.prepare(
    "SELECT kp.keyword_id AS keywordId, kp.parent_id AS parentId, kp.locked FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all();
  const { results: snapLinks } = await env.DB.prepare(
    "SELECT kl.keyword_id AS keywordId, kl.related_id AS relatedId, kl.locked FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all();
  const { results: snapKeywords } = await env.DB.prepare("SELECT id, name FROM keywords WHERE user_id = ?")
    .bind(userId)
    .all();
  const revisionId = uid();
  const snapshot = JSON.stringify({ keywords: snapKeywords ?? [], parents: snapParents ?? [], links: snapLinks ?? [] });

  // 2) 미리보기와 같은 규칙으로 변경 계산 (잠긴 간선은 건드리지 않음)
  const previewRes = await previewOntologyImport(
    new Request(req.url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    env, userId, h,
  );
  const preview = (await previewRes.json()) as {
    newKeywords: string[]; parentChanges: Array<{ keyword: string; parent: string }>;
    linksAdded: Array<{ from: string; to: string }>;
    linksToRemove: Array<{ from: string; to: string; kind?: string }>;
  };
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO ontology_revisions (id, user_id, snapshot_json, change_summary) VALUES (?, ?, ?, ?)")
      .bind(revisionId, userId, snapshot, JSON.stringify({
        newKeywords: preview.newKeywords.length,
        parentChanges: preview.parentChanges.length,
        linksAdded: preview.linksAdded.length,
        linksRemoved: preview.linksToRemove.length,
      })),
  ];
  const createdKeywordIds: string[] = [];
  for (const name of preview.newKeywords) {
    const id = uid();
    createdKeywordIds.push(id);
    stmts.push(
      env.DB.prepare("INSERT OR IGNORE INTO keywords (id, user_id, name) VALUES (?, ?, ?)").bind(id, userId, name),
    );
  }
  await env.DB.batch(stmts);

  // 3) 변경 적용 (이름 → ID 해석은 적용 시점 기준으로 다시 조회)
  const { results: allKeywords } = await env.DB.prepare("SELECT id, name FROM keywords WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; name: string }>();
  const byName = new Map((allKeywords ?? []).map((k) => [k.name, k.id]));
  const applyStmts: D1PreparedStatement[] = [];
  for (const c of preview.parentChanges) {
    const kid = byName.get(c.keyword);
    const pid = byName.get(c.parent);
    if (!kid || !pid || kid === pid) continue;
    if (await wouldCycle(env, userId, kid, pid)) continue;
    applyStmts.push(
      env.DB.prepare("INSERT OR REPLACE INTO keyword_parents (keyword_id, parent_id, locked) VALUES (?, ?, 0)").bind(kid, pid),
    );
  }
  for (const l of preview.linksAdded) {
    const from = byName.get(l.from);
    const to = byName.get(l.to);
    if (!from || !to || from === to) continue;
    applyStmts.push(
      env.DB.prepare("INSERT OR REPLACE INTO keyword_links (keyword_id, related_id, locked) VALUES (?, ?, 0)").bind(from, to),
      env.DB.prepare("INSERT OR REPLACE INTO keyword_links (keyword_id, related_id, locked) VALUES (?, ?, 0)").bind(to, from),
    );
  }
  for (const l of preview.linksToRemove) {
    const from = byName.get(l.from);
    const to = byName.get(l.to);
    if (!from || !to) continue;
    if (l.kind === "parent") {
      applyStmts.push(
        env.DB.prepare("DELETE FROM keyword_parents WHERE keyword_id = ? AND parent_id = ? AND locked = 0").bind(from, to),
      );
    } else {
      applyStmts.push(
        env.DB.prepare("DELETE FROM keyword_links WHERE keyword_id = ? AND related_id = ? AND locked = 0").bind(from, to),
        env.DB.prepare("DELETE FROM keyword_links WHERE keyword_id = ? AND related_id = ? AND locked = 0").bind(to, from),
      );
    }
  }
  if (applyStmts.length > 0) await env.DB.batch(applyStmts);
  return h.json({ ok: true, revisionId, applied: { newKeywords: preview.newKeywords, parentChanges: preview.parentChanges.length, linksAdded: preview.linksAdded.length, linksRemoved: preview.linksToRemove.length } });
}

async function listOntologyRevisions(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results } = await env.DB.prepare(
    "SELECT id, change_summary AS changeSummary, undone, created_at AS createdAt FROM ontology_revisions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
  )
    .bind(userId)
    .all();
  return h.json({ revisions: results ?? [] });
}

async function undoOntologyRevision(env: ApiEnv, userId: string, revisionId: string, h: ApiHelpers) {
  const rev = await env.DB.prepare(
    "SELECT snapshot_json AS snapshotJson, undone FROM ontology_revisions WHERE id = ? AND user_id = ?",
  )
    .bind(revisionId, userId)
    .first<{ snapshotJson: string; undone: number }>();
  if (!rev) return h.json({ error: "not_found" }, 404);
  if (rev.undone === 1) return h.json({ error: "already_undone" }, 400);
  const snap = JSON.parse(rev.snapshotJson) as {
    keywords: Array<{ id: string; name: string }>;
    parents: Array<{ keywordId: string; parentId: string; locked: number }>;
    links: Array<{ keywordId: string; relatedId: string; locked: number }>;
  };
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM keyword_parents WHERE keyword_id IN (SELECT id FROM keywords WHERE user_id = ?)").bind(userId),
    env.DB.prepare("DELETE FROM keyword_links WHERE keyword_id IN (SELECT id FROM keywords WHERE user_id = ?)").bind(userId),
    env.DB.prepare("DELETE FROM keywords WHERE user_id = ?").bind(userId),
  ];
  for (const k of snap.keywords) {
    stmts.push(env.DB.prepare("INSERT INTO keywords (id, user_id, name) VALUES (?, ?, ?)").bind(k.id, userId, k.name));
  }
  for (const p of snap.parents) {
    stmts.push(env.DB.prepare("INSERT INTO keyword_parents (keyword_id, parent_id, locked) VALUES (?, ?, ?)").bind(p.keywordId, p.parentId, p.locked));
  }
  for (const l of snap.links) {
    stmts.push(env.DB.prepare("INSERT INTO keyword_links (keyword_id, related_id, locked) VALUES (?, ?, ?)").bind(l.keywordId, l.relatedId, l.locked));
  }
  stmts.push(env.DB.prepare("UPDATE ontology_revisions SET undone = 1 WHERE id = ?").bind(revisionId));
  await env.DB.batch(stmts);
  return h.json({ ok: true });
}

/* ---------------- 사람·장소·위치 ---------------- */

async function listPeople(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results } = await env.DB.prepare(
    "SELECT p.id, p.name, p.email, p.phone, p.google_resource_name AS googleResourceName, (SELECT COUNT(*) FROM memo_people mp WHERE mp.person_id = p.id) AS memoCount FROM people p WHERE p.user_id = ? ORDER BY p.name ASC",
  )
    .bind(userId)
    .all();
  return h.json({ people: results ?? [] });
}

async function addPerson(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  if (!isNonEmptyString(body.name)) return h.json({ error: "name_required" }, 400);
  const id = uid();
  await env.DB.prepare(
    "INSERT INTO people (id, user_id, google_resource_name, name, email, phone) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      userId,
      (body.googleResourceName as string) ?? null,
      (body.name as string).trim(),
      (body.email as string) ?? null,
      (body.phone as string) ?? null,
    )
    .run();
  return h.json({ id }, 201);
}

async function deletePerson(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const res = await env.DB.prepare("DELETE FROM people WHERE id = ? AND user_id = ?").bind(id, userId).run();
  if ((res.meta.changes ?? 0) === 0) return h.json({ error: "not_found" }, 404);
  return h.json({ ok: true });
}

/** 연락처 검색: People API 검색만 사용한다. 전체 열거(list)는 하지 않는다. */
async function searchPeople(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 1) return h.json({ error: "query_required" }, 400);
  const url =
    "https://people.googleapis.com/v1/people:searchContacts?query=" +
    encodeURIComponent(q) +
    "&readMask=names,emailAddresses,phoneNumbers&pageSize=10";
  const res = await googleFetch(env, h, userId, url);
  if (!res.ok) return h.json({ error: "people_search_failed", status: res.status }, 502);
  const data = (await res.json()) as {
    results?: Array<{ person?: { resourceName?: string; names?: Array<{ displayName?: string }>; emailAddresses?: Array<{ value?: string }>; phoneNumbers?: Array<{ value?: string }> } }>;
  };
  const candidates = (data.results ?? []).map((r) => ({
    googleResourceName: r.person?.resourceName ?? "",
    name: r.person?.names?.[0]?.displayName ?? "",
    email: r.person?.emailAddresses?.[0]?.value ?? "",
    phone: r.person?.phoneNumbers?.[0]?.value ?? "",
  })).filter((c) => c.name);
  return h.json({ candidates });
}

async function listPlaces(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results } = await env.DB.prepare(
    "SELECT p.id, p.name, p.address, p.lat, p.lng, (SELECT COUNT(*) FROM memo_places mp WHERE mp.place_id = p.id) AS memoCount FROM places p WHERE p.user_id = ? ORDER BY p.name ASC",
  )
    .bind(userId)
    .all();
  return h.json({ places: results ?? [] });
}

async function addPlace(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  if (!isNonEmptyString(body.name)) return h.json({ error: "name_required" }, 400);
  const id = uid();
  await env.DB.prepare(
    "INSERT INTO places (id, user_id, name, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      userId,
      (body.name as string).trim(),
      (body.address as string) ?? null,
      typeof body.lat === "number" ? body.lat : null,
      typeof body.lng === "number" ? body.lng : null,
    )
    .run();
  return h.json({ id }, 201);
}

async function deletePlace(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const res = await env.DB.prepare("DELETE FROM places WHERE id = ? AND user_id = ?").bind(id, userId).run();
  if ((res.meta.changes ?? 0) === 0) return h.json({ error: "not_found" }, 404);
  return h.json({ ok: true });
}

/** 장소 검색: Google Geocoding API. 좌표가 불확실하면 null로 둔다 (지어내지 않음). */
async function searchPlaces(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return h.json({ error: "query_required" }, 400);
  if (!env.GOOGLE_MAPS_API_KEY) {
    return h.json({ error: "maps_key_not_configured" }, 501);
  }
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(q) +
    "&key=" +
    encodeURIComponent(env.GOOGLE_MAPS_API_KEY) +
    "&language=ko";
  const res = await fetch(url);
  if (!res.ok) return h.json({ error: "geocode_failed", status: res.status }, 502);
  const data = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
      partial_match?: boolean;
    }>;
  };
  const candidates = (data.results ?? []).map((r) => {
    const loc = r.geometry?.location;
    const certain = r.geometry?.location_type === "ROOFTOP" || r.geometry?.location_type === "RANGE_INTERPOLATED";
    return {
      name: q,
      address: r.formatted_address ?? "",
      // 건물 단위 확정이 아니면 좌표를 비워둔다.
      lat: certain && typeof loc?.lat === "number" ? loc.lat : null,
      lng: certain && typeof loc?.lng === "number" ? loc.lng : null,
      partialMatch: r.partial_match ?? false,
    };
  });
  return h.json({ candidates, status: data.status ?? "UNKNOWN" });
}

async function listLocations(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results } = await env.DB.prepare(
    "SELECT l.id, l.name, l.lat, l.lng, (SELECT COUNT(*) FROM memo_locations ml WHERE ml.location_id = l.id) AS memoCount FROM locations l WHERE l.user_id = ? ORDER BY l.name ASC",
  )
    .bind(userId)
    .all();
  return h.json({ locations: results ?? [] });
}

/** 메모 작성 시 현재 위치 저장 + 역지오코딩으로 위치 노드 생성 */
async function setMemoGeo(req: Request, env: ApiEnv, userId: string, memoId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const lat = body.lat as number | undefined;
  const lng = body.lng as number | undefined;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return h.json({ error: "lat_lng_required" }, 400);
  }
  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?")
    .bind(memoId, userId)
    .first();
  if (!memo) return h.json({ error: "not_found" }, 404);
  let name = (body.name as string) ?? "";
  if (!name && env.GOOGLE_MAPS_API_KEY) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(env.GOOGLE_MAPS_API_KEY)}&language=ko`,
      );
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ formatted_address?: string }> };
        name = data.results?.[0]?.formatted_address ?? "";
      }
    } catch {
      // 역지오코딩 실패 시 좌표만 저장한다.
    }
  }
  if (!name) name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const locId = uid();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO locations (id, user_id, name, lat, lng) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(locId, userId, name, lat, lng)
    .run();
  const loc = await env.DB.prepare("SELECT id FROM locations WHERE user_id = ? AND name = ?")
    .bind(userId, name)
    .first<{ id: string }>();
  if (loc) {
    await env.DB.prepare("INSERT OR IGNORE INTO memo_locations (memo_id, location_id) VALUES (?, ?)")
      .bind(memoId, loc.id)
      .run();
  }
  return h.json({ ok: true, locationId: loc?.id ?? locId, name });
}

/* ---------------- 캘린더 ---------------- */

async function createCalendarEvent(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const memoId = body.memoId as string | undefined;
  if (!isNonEmptyString(body.title) || !body.start) {
    return h.json({ error: "title_and_start_required" }, 400);
  }
  const allDay = body.allDay === true;
  const eventBody: Record<string, unknown> = {
    summary: body.title,
    description: (body.description as string) ?? "",
  };
  if (allDay) {
    eventBody.start = { date: (body.start as string).slice(0, 10) };
    eventBody.end = { date: ((body.end as string) ?? (body.start as string)).slice(0, 10) };
  } else {
    eventBody.start = { dateTime: body.start };
    eventBody.end = { dateTime: body.end ?? body.start };
  }
  const res = await googleFetch(
    env, h, userId,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(eventBody) },
  );
  if (!res.ok) return h.json({ error: "calendar_create_failed", status: res.status }, 502);
  const created = (await res.json()) as { id?: string };
  if (memoId) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO memo_events (memo_id, google_event_id, start_at, end_at, all_day) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(memoId, created.id ?? null, body.start, body.end ?? body.start, allDay ? 1 : 0)
      .run();
  }
  return h.json({ ok: true, googleEventId: created.id ?? null }, 201);
}

async function calendarAgenda(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("days") ?? "30", 10) || 30, 1), 90);
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=" +
    encodeURIComponent(timeMin) + "&timeMax=" + encodeURIComponent(timeMax) +
    "&singleEvents=true&orderBy=startTime&maxResults=100";
  const res = await googleFetch(env, h, userId, url);
  if (!res.ok) return h.json({ error: "calendar_agenda_failed", status: res.status }, 502);
  const data = (await res.json()) as {
    items?: Array<{ id?: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }>;
  };
  const { results: memoEvents } = await env.DB.prepare(
    "SELECT memo_id AS memoId, google_event_id AS googleEventId FROM memo_events WHERE memo_id IN (SELECT id FROM memos WHERE user_id = ?)",
  )
    .bind(userId)
    .all<{ memoId: string; googleEventId: string | null }>();
  const memoByEvent = new Map((memoEvents ?? []).map((e) => [e.googleEventId, e.memoId]));
  const events = (data.items ?? []).map((e) => ({
    googleEventId: e.id ?? "",
    title: e.summary ?? "",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    memoId: e.id ? memoByEvent.get(e.id) ?? null : null,
  }));
  return h.json({ events });
}

/* ---------------- 할일 (Google Tasks) ---------------- */

async function getTaskListId(env: ApiEnv, h: ApiHelpers, userId: string): Promise<string | null> {
  const res = await googleFetch(env, h, userId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists");
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: Array<{ id?: string; title?: string }> };
  const found = (data.items ?? []).find((l) => l.title === "나이테 메모");
  if (found?.id) return found.id;
  const created = await googleFetch(env, h, userId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "나이테 메모" }),
  });
  if (!created.ok) return null;
  const createdData = (await created.json()) as { id?: string };
  return createdData.id ?? null;
}

async function listTasks(env: ApiEnv, userId: string, h: ApiHelpers) {
  const listId = await getTaskListId(env, h, userId);
  if (!listId) return h.json({ error: "tasks_list_failed" }, 502);
  const res = await googleFetch(env, h, userId, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&maxResults=100`);
  if (!res.ok) return h.json({ error: "tasks_list_failed", status: res.status }, 502);
  const data = (await res.json()) as {
    items?: Array<{ id?: string; title?: string; status?: string; due?: string; notes?: string; parent?: string }>;
  };
  const { results: links } = await env.DB.prepare(
    "SELECT block_id AS blockId, google_task_id AS googleTaskId FROM task_links WHERE task_list_id = ?",
  )
    .bind(listId)
    .all<{ blockId: string; googleTaskId: string }>();
  const blockByTask = new Map((links ?? []).map((l) => [l.googleTaskId, l.blockId]));
  const tasks = (data.items ?? []).map((t) => ({
    googleTaskId: t.id ?? "",
    title: t.title ?? "",
    completed: t.status === "completed",
    due: t.due ?? null,
    parent: t.parent ?? null,
    blockId: t.id ? blockByTask.get(t.id) ?? null : null,
  }));
  return h.json({ tasks, taskListId: listId });
}

/** 체크리스트 블록 ↔ Google 할일 양방향 동기화 (한 블록씩). */
async function syncTask(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const blockId = body.blockId as string | undefined;
  if (!blockId) return h.json({ error: "blockId_required" }, 400);
  const block = await env.DB.prepare(
    "SELECT b.id, b.text, b.checked, b.due_date AS dueDate, b.memo_id AS memoId FROM blocks b JOIN memos m ON m.id = b.memo_id WHERE b.id = ? AND m.user_id = ? AND b.type = 'todo'",
  )
    .bind(blockId, userId)
    .first<{ id: string; text: string; checked: number; dueDate: string | null; memoId: string }>();
  if (!block) return h.json({ error: "not_found" }, 404);
  const listId = await getTaskListId(env, h, userId);
  if (!listId) return h.json({ error: "tasks_list_failed" }, 502);
  const existing = await env.DB.prepare("SELECT google_task_id AS googleTaskId FROM task_links WHERE block_id = ?")
    .bind(blockId)
    .first<{ googleTaskId: string }>();
  const taskBody: Record<string, unknown> = {
    title: block.text,
    status: block.checked === 1 ? "completed" : "needsAction",
    notes: `naite:block:${blockId}`,
  };
  if (block.dueDate) taskBody.due = new Date(block.dueDate).toISOString();
  let taskId = existing?.googleTaskId;
  if (taskId) {
    const res = await googleFetch(env, h, userId, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(taskBody),
    });
    if (!res.ok) {
      taskId = undefined; // 삭제된 할일이면 새로 만든다.
    }
  }
  if (!taskId) {
    const res = await googleFetch(env, h, userId, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(taskBody),
    });
    if (!res.ok) return h.json({ error: "task_create_failed", status: res.status }, 502);
    const created = (await res.json()) as { id?: string };
    taskId = created.id;
    if (taskId) {
      await env.DB.prepare("INSERT OR REPLACE INTO task_links (block_id, google_task_id, task_list_id) VALUES (?, ?, ?)")
        .bind(blockId, taskId, listId)
        .run();
    }
  }
  return h.json({ ok: true, googleTaskId: taskId ?? null });
}

/* ---------------- Drive ---------------- */

const MEMO_FOLDER_NAME = "memo";

async function findMemoFolder(env: ApiEnv, h: ApiHelpers, userId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${MEMO_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await googleFetch(
    env, h, userId,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: Array<{ id?: string }> };
  return data.files?.[0]?.id ?? null;
}

async function ensureMemoFolder(env: ApiEnv, h: ApiHelpers, userId: string): Promise<string | null> {
  const existing = await findMemoFolder(env, h, userId);
  if (existing) return existing;
  const res = await googleFetch(env, h, userId, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: MEMO_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

async function driveStatus(env: ApiEnv, userId: string, h: ApiHelpers) {
  const folderId = await findMemoFolder(env, h, userId);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM memos WHERE user_id = ? AND drive_file_id IS NOT NULL",
  )
    .bind(userId)
    .first<{ n: number }>();
  const lastSync = await env.DB.prepare(
    "SELECT value FROM settings WHERE user_id = ? AND key = 'last_drive_sync'",
  )
    .bind(userId)
    .first<{ value: string }>();
  return h.json({
    memoFolderExists: folderId !== null,
    memoFolderId: folderId,
    syncedMemoCount: count?.n ?? 0,
    lastSyncAt: lastSync?.value ?? null,
  });
}

type DriveMemoFile = {
  id: string;
  title: string;
  categoryId?: string | null;
  color?: string | null;
  pinned?: boolean;
  updatedAt?: string;
  blocks?: Array<{ id?: string; type?: string; text?: string; checked?: boolean; dueDate?: string | null }>;
};

async function upsertMemoFromDrive(env: ApiEnv, userId: string, file: DriveMemoFile, driveFileId: string): Promise<string> {
  const existing = await env.DB.prepare(
    "SELECT id FROM memos WHERE (id = ? OR drive_file_id = ?) AND user_id = ?",
  )
    .bind(file.id, driveFileId, userId)
    .first<{ id: string }>();
  const memoId = existing?.id ?? file.id ?? uid();
  const ts = nowIso();
  if (existing) {
    await env.DB.prepare(
      "UPDATE memos SET title = ?, category_id = ?, color = ?, pinned = ?, drive_file_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(file.title ?? "", file.categoryId ?? null, file.color ?? null, file.pinned ? 1 : 0, driveFileId, file.updatedAt ?? ts, memoId)
      .run();
    await env.DB.prepare("DELETE FROM blocks WHERE memo_id = ?").bind(memoId).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO memos (id, user_id, title, category_id, color, pinned, drive_file_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(memoId, userId, file.title ?? "", file.categoryId ?? null, file.color ?? null, file.pinned ? 1 : 0, driveFileId, ts, file.updatedAt ?? ts)
      .run();
  }
  const stmts: D1PreparedStatement[] = [];
  (file.blocks ?? []).forEach((b, i) => {
    stmts.push(
      env.DB.prepare("INSERT INTO blocks (id, memo_id, position, type, text, checked, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(b.id ?? uid(), memoId, i, ["paragraph", "todo", "photo", "voice", "schedule"].includes(b.type ?? "") ? b.type! : "paragraph", b.text ?? "", b.checked ? 1 : 0, b.dueDate ?? null),
    );
  });
  if (stmts.length > 0) await env.DB.batch(stmts);
  return memoId;
}

async function listDriveMemoFiles(env: ApiEnv, h: ApiHelpers, userId: string, folderId: string) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await googleFetch(
    env, h, userId,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,mimeType)&pageSize=100`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string; mimeType?: string }>;
  };
  return (data.files ?? []).filter((f) => f.mimeType === "application/json" || (f.name ?? "").endsWith(".json"));
}

/** Drive 증분 동기화: 바뀐 파일만 가져온다. ?dryRun=1이면 목록만 반환한다. */
async function driveSync(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const folderId = await ensureMemoFolder(env, h, userId);
  if (!folderId) return h.json({ error: "drive_folder_failed" }, 502);
  const files = await listDriveMemoFiles(env, h, userId, folderId);
  if (!files) return h.json({ error: "drive_list_failed" }, 502);
  const lastSync = await env.DB.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'last_drive_sync'")
    .bind(userId)
    .first<{ value: string }>();
  const since = lastSync?.value ?? "1970-01-01T00:00:00Z";
  const changed = files.filter((f) => (f.modifiedTime ?? "") > since);
  if (dryRun) {
    return h.json({ folderId, total: files.length, changed: changed.length, files: changed });
  }
  let imported = 0;
  const errors: Array<{ file: string; error: string }> = [];
  for (const f of changed) {
    try {
      const res = await googleFetch(env, h, userId, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
      if (!res.ok) throw new Error(`http_${res.status}`);
      const parsed = (await res.json()) as DriveMemoFile;
      await upsertMemoFromDrive(env, userId, parsed, f.id ?? "");
      imported++;
    } catch (e) {
      errors.push({ file: f.name ?? f.id ?? "", error: String(e) });
    }
  }
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (?, 'last_drive_sync', ?, ?)",
  )
    .bind(userId, nowIso(), nowIso())
    .run();
  return h.json({ ok: true, total: files.length, changed: changed.length, imported, errors });
}

/** Drive 전체 가져오기: memo 폴더의 모든 메모 파일을 D1로 복원한다 (마이그레이션 경로). */
async function driveImport(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const folderId = await ensureMemoFolder(env, h, userId);
  if (!folderId) return h.json({ error: "drive_folder_failed" }, 502);
  const files = await listDriveMemoFiles(env, h, userId, folderId);
  if (!files) return h.json({ error: "drive_list_failed" }, 502);
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (dryRun) return h.json({ folderId, total: files.length, files });
  let imported = 0;
  const errors: Array<{ file: string; error: string }> = [];
  for (const f of files) {
    try {
      const res = await googleFetch(env, h, userId, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
      if (!res.ok) throw new Error(`http_${res.status}`);
      const parsed = (await res.json()) as DriveMemoFile;
      await upsertMemoFromDrive(env, userId, parsed, f.id ?? "");
      imported++;
    } catch (e) {
      errors.push({ file: f.name ?? f.id ?? "", error: String(e) });
    }
  }
  return h.json({ ok: true, total: files.length, imported, errors });
}

/** 메모 1개를 Drive memo 폴더 파일로 올린다 (1메모=1파일). */
async function pushMemoToDrive(env: ApiEnv, userId: string, memoId: string, h: ApiHelpers) {
  const memoRes = await getMemo(env, userId, memoId, h);
  if (memoRes.status === 404) return h.json({ error: "not_found" }, 404);
  const memo = (await memoRes.json()) as {
    id: string; title: string; categoryId: string | null; color: string | null;
    pinned: number; driveFileId: string | null; updatedAt: string;
    blocks: Array<{ id: string; type: string; text: string; checked: number; dueDate: string | null }>;
  };
  const folderId = await ensureMemoFolder(env, h, userId);
  if (!folderId) return h.json({ error: "drive_folder_failed" }, 502);
  const payload = JSON.stringify({
    id: memo.id,
    title: memo.title,
    categoryId: memo.categoryId,
    color: memo.color,
    pinned: memo.pinned === 1,
    updatedAt: memo.updatedAt,
    blocks: (memo.blocks ?? []).map((b) => ({
      id: b.id, type: b.type, text: b.text, checked: b.checked === 1, dueDate: b.dueDate,
    })),
  });
  const boundary = "naite-" + uid();
  const metadata = JSON.stringify({
    name: `${memo.id}.json`,
    mimeType: "application/json",
    ...(memo.driveFileId ? {} : { parents: [folderId] }),
  });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n` +
    `--${boundary}--`;
  let res: Response;
  if (memo.driveFileId) {
    res = await googleFetch(
      env, h, userId,
      `https://www.googleapis.com/upload/drive/v3/files/${memo.driveFileId}?uploadType=multipart`,
      { method: "PATCH", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body },
    );
  } else {
    res = await googleFetch(
      env, h, userId,
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body },
    );
  }
  if (!res.ok) return h.json({ error: "drive_upload_failed", status: res.status }, 502);
  const data = (await res.json()) as { id?: string };
  if (data.id) {
    await env.DB.prepare("UPDATE memos SET drive_file_id = ? WHERE id = ?").bind(data.id, memoId).run();
  }
  return h.json({ ok: true, driveFileId: data.id ?? memo.driveFileId });
}

/* ---------------- 첨부파일 (R2) ---------------- */

async function uploadAttachment(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const form = await req.formData().catch(() => null);
  if (!form) return h.json({ error: "multipart_required" }, 400);
  const file = form.get("file");
  const memoId = form.get("memoId");
  if (!(file instanceof File) || typeof memoId !== "string") {
    return h.json({ error: "file_and_memoId_required" }, 400);
  }
  if (file.size > 20 * 1024 * 1024) return h.json({ error: "file_too_large" }, 413);
  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?")
    .bind(memoId, userId)
    .first();
  if (!memo) return h.json({ error: "not_found" }, 404);
  const id = uid();
  const key = `u/${userId}/${id}`;
  await env.ATTACHMENTS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  await env.DB.prepare(
    "INSERT INTO attachments (id, user_id, memo_id, r2_key, mime, size) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, userId, memoId, key, file.type || "", file.size)
    .run();
  return h.json({ id, url: `/api/attachments/${id}` }, 201);
}

async function getAttachment(env: ApiEnv, userId: string, id: string, h: ApiHelpers) {
  const row = await env.DB.prepare(
    "SELECT r2_key AS r2Key, mime FROM attachments WHERE id = ? AND user_id = ?",
  )
    .bind(id, userId)
    .first<{ r2Key: string; mime: string }>();
  if (!row) return h.json({ error: "not_found" }, 404);
  const obj = await env.ATTACHMENTS.get(row.r2Key);
  if (!obj) return h.json({ error: "not_found" }, 404);
  return new Response(obj.body, {
    headers: { "content-type": row.mime || "application/octet-stream", "cache-control": "private, max-age=3600" },
  });
}

/* ---------------- 분석 대시보드·프롬프트 ---------------- */

async function analyticsSummary(env: ApiEnv, userId: string, h: ApiHelpers) {
  const count = async (sql: string) => {
    const r = await env.DB.prepare(sql).bind(userId).first<{ n: number }>();
    return r?.n ?? 0;
  };
  const memoCount = await count("SELECT COUNT(*) AS n FROM memos WHERE user_id = ?");
  const keywordCount = await count("SELECT COUNT(*) AS n FROM keywords WHERE user_id = ?");
  const parentEdges = await count(
    "SELECT COUNT(*) AS n FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE k.user_id = ?",
  );
  const relatedEdges = await count(
    "SELECT COUNT(*) AS n FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE k.user_id = ?",
  );
  const memoKeywordLinks = await count(
    "SELECT COUNT(*) AS n FROM memo_keywords mk JOIN memos m ON m.id = mk.memo_id WHERE m.user_id = ?",
  );
  const peopleCount = await count("SELECT COUNT(*) AS n FROM people WHERE user_id = ?");
  const placeCount = await count("SELECT COUNT(*) AS n FROM places WHERE user_id = ?");
  const { results: central } = await env.DB.prepare(
    `SELECT k.id, k.name, COUNT(*) AS degree FROM (
       SELECT keyword_id AS kid FROM keyword_parents UNION ALL
       SELECT parent_id AS kid FROM keyword_parents UNION ALL
       SELECT keyword_id AS kid FROM keyword_links UNION ALL
       SELECT keyword_id AS kid FROM memo_keywords
     ) d JOIN keywords k ON k.id = d.kid WHERE k.user_id = ?
     GROUP BY k.id, k.name ORDER BY degree DESC LIMIT 10`,
  )
    .bind(userId)
    .all();
  const { results: isolated } = await env.DB.prepare(
    "SELECT m.id, m.title FROM memos m WHERE m.user_id = ? AND NOT EXISTS (SELECT 1 FROM memo_keywords mk WHERE mk.memo_id = m.id) ORDER BY m.updated_at DESC LIMIT 10",
  )
    .bind(userId)
    .all();
  return h.json({
    memoCount,
    keywordCount,
    totalConnections: parentEdges + relatedEdges + memoKeywordLinks,
    parentEdges,
    relatedEdges,
    memoKeywordLinks,
    peopleCount,
    placeCount,
    centralKeywords: central ?? [],
    isolatedMemos: isolated ?? [],
  });
}

const ONTOLOGY_PROMPT_SPEC = `결과는 설명 없이 아래 JSON 형식으로만 답해줘.
{
  "keywords": [
    {"name": "키워드", "parents": ["상위 키워드"], "related": ["관련 키워드"]}
  ],
  "linksToRemove": [
    {"from": "키워드", "to": "키워드", "kind": "parent" | "related"}
  ]
}
parents는 여러 개 가능해 (다대다). 잠긴 관계는 바꾸지 마.`;

/** 분석 프롬프트 생성: 전체 키워드·현재 관계·잠긴 관계를 실어 보낸다. */
async function analyticsPrompt(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const url = new URL(req.url);
  const minLinks = Math.max(parseInt(url.searchParams.get("minLinks") ?? "2", 10) || 2, 1);
  const { results: keywords } = await env.DB.prepare("SELECT id, name FROM keywords WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; name: string }>();
  const { results: parents } = await env.DB.prepare(
    "SELECT kp.keyword_id AS keywordId, kp.parent_id AS parentId, kp.locked FROM keyword_parents kp JOIN keywords k ON k.id = kp.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all<{ keywordId: string; parentId: string; locked: number }>();
  const { results: links } = await env.DB.prepare(
    "SELECT kl.keyword_id AS keywordId, kl.related_id AS relatedId, kl.locked FROM keyword_links kl JOIN keywords k ON k.id = kl.keyword_id WHERE k.user_id = ?",
  )
    .bind(userId)
    .all<{ keywordId: string; relatedId: string; locked: number }>();
  const { results: memoKeywords } = await env.DB.prepare(
    "SELECT k.name AS keyword, m.title AS memoTitle FROM memo_keywords mk JOIN keywords k ON k.id = mk.keyword_id JOIN memos m ON m.id = mk.memo_id WHERE m.user_id = ? ORDER BY k.name, m.updated_at DESC",
  )
    .bind(userId)
    .all<{ keyword: string; memoTitle: string }>();
  const byId = new Map((keywords ?? []).map((k) => [k.id, k.name]));
  const degree = new Map<string, number>();
  for (const p of parents ?? []) {
    degree.set(p.keywordId, (degree.get(p.keywordId) ?? 0) + 1);
    degree.set(p.parentId, (degree.get(p.parentId) ?? 0) + 1);
  }
  for (const l of links ?? []) degree.set(l.keywordId, (degree.get(l.keywordId) ?? 0) + 1);
  const significant = (keywords ?? []).filter((k) => (degree.get(k.id) ?? 0) >= minLinks);
  const memoByKeyword = new Map<string, string[]>();
  for (const mk of memoKeywords ?? []) {
    const arr = memoByKeyword.get(mk.keyword) ?? [];
    if (arr.length < 5) arr.push(mk.memoTitle);
    memoByKeyword.set(mk.keyword, arr);
  }
  const lines: string[] = [];
  lines.push("당신은 지식 온톨로지 분석가입니다. 아래 메모들의 키워드·사람·장소·시간 연결을 분석해주세요.");
  lines.push("");
  lines.push("[유의미 키워드 (연결 " + minLinks + "개 이상)]");
  for (const k of significant) lines.push(`- ${k.name} (연결 ${degree.get(k.id) ?? 0}개)`);
  if (significant.length === 0) {
    lines.push("(유의미 키워드가 아직 없어. 연결이 가장 많은 키워드 위주로 분석해줘.)");
    lines.push(...(keywords ?? []).slice(0, 10).map((k) => `- ${k.name} (연결 ${degree.get(k.id) ?? 0}개)`));
  }
  lines.push("");
  lines.push("[현재 관계]");
  for (const p of parents ?? []) {
    lines.push(`- ${byId.get(p.keywordId)} → 상위: ${byId.get(p.parentId)}${p.locked === 1 ? " (잠김: 바꾸지 마)" : ""}`);
  }
  for (const l of links ?? []) {
    lines.push(`- ${byId.get(l.keywordId)} ↔ 관련: ${byId.get(l.relatedId)}${l.locked === 1 ? " (잠김: 바꾸지 마)" : ""}`);
  }
  lines.push("");
  lines.push("[키워드별 관련 메모]");
  for (const [kw, titles] of memoByKeyword) {
    lines.push(`- ${kw}: ${titles.join(" / ")}`);
  }
  lines.push("");
  lines.push("[분석해줄 것]");
  lines.push("1. 중심 키워드 간의 상위·하위·관련 관계를 정리해줘");
  lines.push("2. 연결이 약한 부분(고립된 메모)과 허브 키워드를 알려줘");
  lines.push("3. 빠진 관계나 새로 만들면 좋을 키워드를 5개 제안해줘");
  lines.push("4. 온톨로지를 한 단계 더 정리한다면 어떤 구조가 좋을지 제안해줘");
  lines.push("");
  lines.push(ONTOLOGY_PROMPT_SPEC);
  return h.json({ prompt: lines.join("\n"), significantKeywords: significant.map((k) => k.name) });
}

/* ---------------- 설정·부트스트랩 ---------------- */

async function getSettings(env: ApiEnv, userId: string, h: ApiHelpers) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE user_id = ?")
    .bind(userId)
    .all<{ key: string; value: string }>();
  const settings: Record<string, string> = {};
  for (const r of results ?? []) settings[r.key] = r.value;
  return h.json({ settings });
}

async function updateSettings(req: Request, env: ApiEnv, userId: string, h: ApiHelpers) {
  const body = await readJson(req);
  const settings = (body.settings ?? body) as Record<string, unknown>;
  const stmts: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== "string") continue;
    stmts.push(
      env.DB.prepare("INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)")
        .bind(userId, key, value, nowIso()),
    );
  }
  if (stmts.length === 0) return h.json({ error: "nothing_to_update" }, 400);
  await env.DB.batch(stmts);
  return h.json({ ok: true });
}

async function bootstrap(env: ApiEnv, userId: string, h: ApiHelpers) {
  await ensureUser(env, userId);
  const user = await env.DB.prepare("SELECT id, email, display_name AS displayName FROM users WHERE id = ?")
    .bind(userId)
    .first();
  const settingsRes = await getSettings(env, userId, h);
  const settings = ((await settingsRes.json()) as { settings: Record<string, string> }).settings;
  const hasRefresh = (await env.TOKENS.get(`refresh:${userId}`)) !== null;
  return h.json({
    user,
    driveConnected: hasRefresh,
    settings,
    memoFolderName: MEMO_FOLDER_NAME,
  });
}

/* ---------------- 라우터 ---------------- */

type Route = {
  method: string;
  pattern: RegExp;
  handler: (req: Request, env: ApiEnv, userId: string, h: ApiHelpers, match: RegExpMatchArray) => Promise<Response>;
};

function route(method: string, pattern: RegExp, handler: Route["handler"]): Route {
  return { method, pattern, handler };
}

const ROUTES: Route[] = [
  route("GET", /^\/api\/bootstrap$/, (req, env, u, h) => bootstrap(env, u, h)),
  route("GET", /^\/api\/settings$/, (req, env, u, h) => getSettings(env, u, h)),
  route("PATCH", /^\/api\/settings$/, (req, env, u, h) => updateSettings(req, env, u, h)),

  route("GET", /^\/api\/categories$/, (req, env, u, h) => listCategories(env, u, h)),
  route("POST", /^\/api\/categories$/, (req, env, u, h) => createCategory(req, env, u, h)),
  route("PATCH", /^\/api\/categories\/([^/]+)$/, (req, env, u, h, m) => updateCategory(req, env, u, decodeURIComponent(m[1]), h)),
  route("DELETE", /^\/api\/categories\/([^/]+)$/, (req, env, u, h, m) => deleteCategory(env, u, decodeURIComponent(m[1]), h)),

  route("GET", /^\/api\/memos$/, (req, env, u, h) => listMemos(req, env, u, h)),
  route("POST", /^\/api\/memos$/, (req, env, u, h) => createMemo(req, env, u, h)),
  route("GET", /^\/api\/memos\/([^/]+)$/, (req, env, u, h, m) => getMemo(env, u, decodeURIComponent(m[1]), h)),
  route("PATCH", /^\/api\/memos\/([^/]+)$/, (req, env, u, h, m) => updateMemo(req, env, u, decodeURIComponent(m[1]), h)),
  route("DELETE", /^\/api\/memos\/([^/]+)$/, (req, env, u, h, m) => deleteMemo(env, u, decodeURIComponent(m[1]), h)),
  route("POST", /^\/api\/memos\/([^/]+)\/blocks$/, (req, env, u, h, m) => addBlock(req, env, u, decodeURIComponent(m[1]), h)),
  route("POST", /^\/api\/memos\/([^/]+)\/extract-keywords$/, (req, env, u, h, m) => extractKeywordsForMemo(env, u, decodeURIComponent(m[1]), h)),
  route("POST", /^\/api\/memos\/([^/]+)\/geo$/, (req, env, u, h, m) => setMemoGeo(req, env, u, decodeURIComponent(m[1]), h)),
  route("PATCH", /^\/api\/blocks\/([^/]+)$/, (req, env, u, h, m) => updateBlock(req, env, u, decodeURIComponent(m[1]), h)),
  route("DELETE", /^\/api\/blocks\/([^/]+)$/, (req, env, u, h, m) => deleteBlock(env, u, decodeURIComponent(m[1]), h)),

  route("GET", /^\/api\/keywords$/, (req, env, u, h) => listKeywords(env, u, h)),
  route("POST", /^\/api\/keywords$/, (req, env, u, h) => createKeyword(req, env, u, h)),
  route("POST", /^\/api\/keywords\/([^/]+)\/parents$/, (req, env, u, h, m) => addParentEdge(req, env, u, decodeURIComponent(m[1]), h)),
  route("DELETE", /^\/api\/keywords\/([^/]+)\/parents\/([^/]+)$/, (req, env, u, h, m) => removeParentEdge(env, u, decodeURIComponent(m[1]), decodeURIComponent(m[2]), h)),
  route("POST", /^\/api\/keywords\/([^/]+)\/related$/, (req, env, u, h, m) => addRelatedLink(req, env, u, decodeURIComponent(m[1]), h)),
  route("DELETE", /^\/api\/keywords\/([^/]+)\/related\/([^/]+)$/, (req, env, u, h, m) => removeRelatedLink(env, u, decodeURIComponent(m[1]), decodeURIComponent(m[2]), h)),

  route("GET", /^\/api\/ontology\/graph$/, (req, env, u, h) => ontologyGraph(env, u, h)),
  route("POST", /^\/api\/ontology\/import\/preview$/, (req, env, u, h) => previewOntologyImport(req, env, u, h)),
  route("POST", /^\/api\/ontology\/import\/apply$/, (req, env, u, h) => applyOntologyImport(req, env, u, h)),
  route("GET", /^\/api\/ontology\/revisions$/, (req, env, u, h) => listOntologyRevisions(env, u, h)),
  route("POST", /^\/api\/ontology\/revisions\/([^/]+)\/undo$/, (req, env, u, h, m) => undoOntologyRevision(env, u, decodeURIComponent(m[1]), h)),

  route("GET", /^\/api\/people$/, (req, env, u, h) => listPeople(env, u, h)),
  route("POST", /^\/api\/people$/, (req, env, u, h) => addPerson(req, env, u, h)),
  route("DELETE", /^\/api\/people\/([^/]+)$/, (req, env, u, h, m) => deletePerson(env, u, decodeURIComponent(m[1]), h)),
  route("GET", /^\/api\/people\/search$/, (req, env, u, h) => searchPeople(req, env, u, h)),

  route("GET", /^\/api\/places$/, (req, env, u, h) => listPlaces(env, u, h)),
  route("POST", /^\/api\/places$/, (req, env, u, h) => addPlace(req, env, u, h)),
  route("DELETE", /^\/api\/places\/([^/]+)$/, (req, env, u, h, m) => deletePlace(env, u, decodeURIComponent(m[1]), h)),
  route("GET", /^\/api\/places\/search$/, (req, env, u, h) => searchPlaces(req, env, u, h)),

  route("GET", /^\/api\/locations$/, (req, env, u, h) => listLocations(env, u, h)),

  route("POST", /^\/api\/calendar\/events$/, (req, env, u, h) => createCalendarEvent(req, env, u, h)),
  route("GET", /^\/api\/calendar\/agenda$/, (req, env, u, h) => calendarAgenda(req, env, u, h)),

  route("GET", /^\/api\/tasks$/, (req, env, u, h) => listTasks(env, u, h)),
  route("POST", /^\/api\/tasks\/sync$/, (req, env, u, h) => syncTask(req, env, u, h)),

  route("GET", /^\/api\/drive\/status$/, (req, env, u, h) => driveStatus(env, u, h)),
  route("POST", /^\/api\/drive\/sync$/, (req, env, u, h) => driveSync(req, env, u, h)),
  route("POST", /^\/api\/drive\/import$/, (req, env, u, h) => driveImport(req, env, u, h)),
  route("POST", /^\/api\/drive\/memos\/([^/]+)\/push$/, (req, env, u, h, m) => pushMemoToDrive(env, u, decodeURIComponent(m[1]), h)),

  route("POST", /^\/api\/attachments\/upload$/, (req, env, u, h) => uploadAttachment(req, env, u, h)),
  route("GET", /^\/api\/attachments\/([^/]+)$/, (req, env, u, h, m) => getAttachment(env, u, decodeURIComponent(m[1]), h)),

  route("GET", /^\/api\/analytics\/summary$/, (req, env, u, h) => analyticsSummary(env, u, h)),
  route("GET", /^\/api\/analytics\/prompt$/, (req, env, u, h) => analyticsPrompt(req, env, u, h)),
];

/** index.ts에서 호출한다. /api/auth/*는 여기로 오지 않는다 (그록 소유). */
export async function handleApi(
  req: Request,
  env: ApiEnv,
  url: URL,
  h: ApiHelpers,
): Promise<Response> {
  const userOrRes = await requireUser(req, env, h);
  if (typeof userOrRes !== "string") return withCors(userOrRes, req);
  const userId = userOrRes;
  for (const r of ROUTES) {
    if (r.method !== req.method) continue;
    const match = url.pathname.match(r.pattern);
    if (!match) continue;
    try {
      const res = await r.handler(req, env, userId, h, match);
      return withCors(res, req);
    } catch (e) {
      console.error("api error", r.method, url.pathname, e);
      return withCors(h.json({ error: "internal_error" }, 500), req);
    }
  }
  return withCors(h.json({ error: "not_found" }, 404), req);
}

/* ---------------- 크론 동기화 진입점 (sync.ts에서 호출) ---------------- */

/**
 * 한 사용자에 대한 백그라운드 동기화 1회분.
 * Drive 증분 가져오기 + Google Tasks 상태 가져와서 로컬 체크 상태 맞추기.
 * 실패해도 예외를 밖으로 던지지 않고 결과로 반환한다 (한 사용자가 망가져도
 * 다른 사용자는 계속 동기화해야 한다).
 */
export async function cronSyncUser(
  env: ApiEnv,
  h: ApiHelpers,
  userId: string,
): Promise<{ driveImported: number; tasksPulled: number; errors: string[] }> {
  const result = { driveImported: 0, tasksPulled: 0, errors: [] as string[] };
  // Drive 증분 동기화
  try {
    const folderId = await findMemoFolder(env, h, userId);
    if (folderId) {
      const files = await listDriveMemoFiles(env, h, userId, folderId);
      const lastSync = await env.DB.prepare(
        "SELECT value FROM settings WHERE user_id = ? AND key = 'last_drive_sync'",
      )
        .bind(userId)
        .first<{ value: string }>();
      const since = lastSync?.value ?? "1970-01-01T00:00:00Z";
      for (const f of files ?? []) {
        if ((f.modifiedTime ?? "") <= since) continue;
        try {
          const res = await googleFetch(env, h, userId, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
          if (!res.ok) throw new Error(`http_${res.status}`);
          const parsed = (await res.json()) as DriveMemoFile;
          await upsertMemoFromDrive(env, userId, parsed, f.id ?? "");
          result.driveImported++;
        } catch (e) {
          result.errors.push(`drive:${f.name ?? f.id}: ${String(e)}`);
        }
      }
      await env.DB.prepare(
        "INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (?, 'last_drive_sync', ?, ?)",
      )
        .bind(userId, nowIso(), nowIso())
        .run();
    }
  } catch (e) {
    result.errors.push(`drive: ${String(e)}`);
  }
  // Tasks 가져오기: Google 할일 완료 상태를 로컬 todo 블록에 반영
  try {
    const listId = await getTaskListId(env, h, userId);
    if (listId) {
      const res = await googleFetch(
        env, h, userId,
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&maxResults=100`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{ id?: string; status?: string }>;
        };
        for (const t of data.items ?? []) {
          if (!t.id) continue;
          const link = await env.DB.prepare("SELECT block_id AS blockId FROM task_links WHERE google_task_id = ?")
            .bind(t.id)
            .first<{ blockId: string }>();
          if (!link) continue;
          const checked = t.status === "completed" ? 1 : 0;
          await env.DB.prepare("UPDATE blocks SET checked = ? WHERE id = ?").bind(checked, link.blockId).run();
          result.tasksPulled++;
        }
      }
    }
  } catch (e) {
    result.errors.push(`tasks: ${String(e)}`);
  }
  return result;
}
