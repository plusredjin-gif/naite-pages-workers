/**
 * 나이테 Pages-only — 브라우저 로컬 저장소 (local-store.ts)
 *
 * Worker+D1이 없어졌으므로 메모·카테고리·키워드·온톨로지·사람·장소·설정은
 * 브라우저 localStorage에 저장한다. Drive `memo` 폴더는 "진실의 원본" 중
 * 하나로 유지된다 (1메모=1파일 JSON). 로컬 저장소는 Drive와 수동 동기화로
 * 맞춘다 — 자동·백그라운드 동기화는 Pages-only에서 안 된다.
 *
 * 저장 형태: 키 `naite.local.v1` 하나에 전체 상태를 JSON으로 저장한다.
 * (단일 사용자·개인용 앱 전제. 멀티탭 동시 편집은 지원하지 않는다.)
 *
 * 주의:
 *  - localStorage는 같은 오리진의 모든 스크립트가 읽을 수 있다. 토큰은
 *    여기에 절대 두지 않는다 (토큰은 sessionStorage — token-store.ts 참조).
 *  - 브라우저 데이터를 지우면 로컬 메모가 사라진다. Drive에 push한 메모는
 *    Drive에서 다시 가져올 수 있다 (api.drive.importAll).
 *  - 이 파일의 규칙 기반 로직(키워드 추출·순환 거부·온톨로지 미리보기/적용/
 *    되돌리기·분석 프롬프트)은 worker/src/api.ts의 동일 로직을 브라우저로
 *    옮긴 것이다. 동작이 같아야 한다.
 */

export type BlockType = "paragraph" | "todo" | "photo" | "voice" | "schedule";

export type Block = {
  id: string;
  position: number;
  type: BlockType;
  text: string;
  checked: number;
  attachmentId: string | null;
  dueDate: string | null;
};

export type MemoRecord = {
  id: string;
  title: string;
  categoryId: string | null;
  color: string | null;
  pinned: number;
  driveFileId: string | null;
  createdAt: string;
  updatedAt: string;
  blocks: Block[];
};

export type CategoryRecord = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KeywordRecord = { id: string; name: string; createdAt: string };
export type ParentEdge = { keywordId: string; parentId: string; locked: number };
export type RelatedEdge = { keywordId: string; relatedId: string; locked: number };
export type MemoKeywordLink = { memoId: string; keywordId: string };
export type PersonRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  googleResourceName: string | null;
};
export type PlaceRecord = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};
export type LocationRecord = { id: string; name: string; lat: number | null; lng: number | null };
export type MemoPersonLink = { memoId: string; personId: string };
export type MemoPlaceLink = { memoId: string; placeId: string };
export type MemoLocationLink = { memoId: string; locationId: string };
export type MemoEventRecord = {
  memoId: string;
  googleEventId: string | null;
  startAt: string;
  endAt: string;
  allDay: number;
};
export type TaskLink = { blockId: string; googleTaskId: string; taskListId: string };
export type AttachmentRecord = {
  id: string;
  memoId: string;
  driveFileId: string;
  url: string;
  mime: string;
  size: number;
};
export type OntologyRevision = {
  id: string;
  changeSummary: string;
  undone: number;
  createdAt: string;
  snapshotJson: string;
};

export type LocalState = {
  version: 1;
  memos: MemoRecord[];
  categories: CategoryRecord[];
  keywords: KeywordRecord[];
  keywordParents: ParentEdge[];
  keywordLinks: RelatedEdge[];
  memoKeywords: MemoKeywordLink[];
  people: PersonRecord[];
  places: PlaceRecord[];
  locations: LocationRecord[];
  memoPeople: MemoPersonLink[];
  memoPlaces: MemoPlaceLink[];
  memoLocations: MemoLocationLink[];
  memoEvents: MemoEventRecord[];
  taskLinks: TaskLink[];
  attachments: AttachmentRecord[];
  ontologyRevisions: OntologyRevision[];
  settings: Record<string, string>;
};

const STORAGE_KEY = "naite.local.v1";

export function emptyState(): LocalState {
  return {
    version: 1,
    memos: [],
    categories: [],
    keywords: [],
    keywordParents: [],
    keywordLinks: [],
    memoKeywords: [],
    people: [],
    places: [],
    locations: [],
    memoPeople: [],
    memoPlaces: [],
    memoLocations: [],
    memoEvents: [],
    taskLinks: [],
    attachments: [],
    ontologyRevisions: [],
    settings: {},
  };
}

export function loadState(): LocalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as LocalState;
    if (parsed.version !== 1 || !Array.isArray(parsed.memos)) return emptyState();
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

export function saveState(state: LocalState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/* ---------------- 키워드 자동 추출 (규칙 기반 — worker/api.ts와 동일) ---------------- */

const KEYWORD_STOPWORDS = new Set([
  "이", "그", "저", "것", "수", "등", "및", "또", "더", "잘", "좀", "것이다",
  "있다", "없다", "하다", "되다", "이다", "가다", "오다", "보다", "이다.",
  "the", "and", "for", "with", "this", "that", "from", "into",
]);

export function extractKeywords(text: string): string[] {
  const found = new Map<string, number>();
  for (const m of text.matchAll(/#([^\s#.,!?()[\]{}"']+)/g)) {
    const tag = m[1].trim();
    if (tag.length >= 2) found.set(tag, (found.get(tag) ?? 0) + 10);
  }
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

export function getOrCreateKeywordId(state: LocalState, name: string): string {
  const existing = state.keywords.find((k) => k.name === name);
  if (existing) return existing.id;
  const id = uid();
  state.keywords.push({ id, name, createdAt: nowIso() });
  return id;
}

/** 간선 추가 시 순환을 거부한다 (A가 B의 상위인데 B를 A의 상위로 거는 경우). */
export function wouldCycle(state: LocalState, keywordId: string, parentId: string): boolean {
  const seen = new Set<string>();
  let frontier = [parentId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const cur of frontier) {
      if (cur === keywordId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of state.keywordParents) {
        if (e.keywordId === cur) next.push(e.parentId);
      }
    }
    frontier = next;
  }
  return false;
}

/* ---------------- 온톨로지 JSON 왕복 (worker/api.ts와 동일 규칙) ---------------- */

export type OntologyImportInput = {
  keywords?: Array<{ name: string; parents?: string[]; parent?: string; related?: string[] }>;
  linksToRemove?: Array<{ from: string; to: string; kind?: "parent" | "related" }>;
};

export function parseOntologyJson(raw: string): OntologyImportInput | null {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as OntologyImportInput;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keywords)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type OntologyPreview = {
  ok: boolean;
  newKeywords: string[];
  parentChanges: Array<{ keyword: string; parent: string }>;
  linksAdded: Array<{ from: string; to: string }>;
  linksToRemove: Array<{ from: string; to: string; kind?: string }>;
  skippedLocked: Array<{ keyword: string; parent?: string; related?: string }>;
};

export function previewOntologyImport(state: LocalState, input: OntologyImportInput): OntologyPreview {
  const byName = new Map(state.keywords.map((k) => [k.name, k.id]));
  const lockedParentSet = new Set(
    state.keywordParents.filter((e) => e.locked === 1).map((e) => `${e.keywordId}|${e.parentId}`),
  );
  const lockedLinkSet = new Set(
    state.keywordLinks.filter((e) => e.locked === 1).map((e) => `${e.keywordId}|${e.relatedId}`),
  );
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
  return { ok: true, newKeywords, parentChanges, linksAdded, linksToRemove: removals, skippedLocked };
}

export function applyOntologyImport(
  state: LocalState,
  input: OntologyImportInput,
): { revisionId: string; applied: Record<string, unknown> } {
  // 1) 적용 전 스냅샷 저장 (되돌리기용)
  const revisionId = uid();
  const snapshot = JSON.stringify({
    keywords: state.keywords,
    parents: state.keywordParents,
    links: state.keywordLinks,
  });
  const preview = previewOntologyImport(state, input);
  state.ontologyRevisions.unshift({
    id: revisionId,
    changeSummary: JSON.stringify({
      newKeywords: preview.newKeywords.length,
      parentChanges: preview.parentChanges.length,
      linksAdded: preview.linksAdded.length,
      linksRemoved: preview.linksToRemove.length,
    }),
    undone: 0,
    createdAt: nowIso(),
    snapshotJson: snapshot,
  });

  // 2) 새 키워드 생성
  for (const name of preview.newKeywords) {
    getOrCreateKeywordId(state, name);
  }
  const byName = new Map(state.keywords.map((k) => [k.name, k.id]));

  // 3) 변경 적용 (잠긴 간선은 건드리지 않음)
  for (const c of preview.parentChanges) {
    const kid = byName.get(c.keyword);
    const pid = byName.get(c.parent);
    if (!kid || !pid || kid === pid) continue;
    if (wouldCycle(state, kid, pid)) continue;
    const existing = state.keywordParents.find((e) => e.keywordId === kid && e.parentId === pid);
    if (existing) existing.locked = 0;
    else state.keywordParents.push({ keywordId: kid, parentId: pid, locked: 0 });
  }
  for (const l of preview.linksAdded) {
    const from = byName.get(l.from);
    const to = byName.get(l.to);
    if (!from || !to || from === to) continue;
    for (const [a, b] of [[from, to], [to, from]] as const) {
      const existing = state.keywordLinks.find((e) => e.keywordId === a && e.relatedId === b);
      if (existing) existing.locked = 0;
      else state.keywordLinks.push({ keywordId: a, relatedId: b, locked: 0 });
    }
  }
  for (const l of preview.linksToRemove) {
    const from = byName.get(l.from);
    const to = byName.get(l.to);
    if (!from || !to) continue;
    if (l.kind === "parent") {
      state.keywordParents = state.keywordParents.filter(
        (e) => !(e.keywordId === from && e.parentId === to && e.locked === 0),
      );
    } else {
      state.keywordLinks = state.keywordLinks.filter(
        (e) => !((e.keywordId === from && e.relatedId === to) || (e.keywordId === to && e.relatedId === from)) || e.locked === 1,
      );
    }
  }
  return {
    revisionId,
    applied: {
      newKeywords: preview.newKeywords,
      parentChanges: preview.parentChanges.length,
      linksAdded: preview.linksAdded.length,
      linksRemoved: preview.linksToRemove.length,
    },
  };
}

/** 되돌리기: 스냅샷으로 키워드·간선을 복원한다. 이미 되돌린 리비전은 다시 못 되돌린다. */
export function undoOntologyRevision(state: LocalState, revisionId: string): { ok: boolean; error?: string } {
  const rev = state.ontologyRevisions.find((r) => r.id === revisionId);
  if (!rev) return { ok: false, error: "not_found" };
  if (rev.undone === 1) return { ok: false, error: "already_undone" };
  const snap = JSON.parse(rev.snapshotJson) as {
    keywords: KeywordRecord[];
    parents: ParentEdge[];
    links: RelatedEdge[];
  };
  state.keywords = snap.keywords;
  state.keywordParents = snap.parents;
  state.keywordLinks = snap.links;
  rev.undone = 1;
  return { ok: true };
}

/* ---------------- 분석 대시보드·프롬프트 (worker/api.ts와 동일 규칙) ---------------- */

export const ONTOLOGY_PROMPT_SPEC = `결과는 설명 없이 아래 JSON 형식으로만 답해줘.
{
  "keywords": [
    {"name": "키워드", "parents": ["상위 키워드"], "related": ["관련 키워드"]}
  ],
  "linksToRemove": [
    {"from": "키워드", "to": "키워드", "kind": "parent" | "related"}
  ]
}
parents는 여러 개 가능해 (다대다). 잠긴 관계는 바꾸지 마.`;

export function analyticsSummary(state: LocalState): {
  memoCount: number;
  keywordCount: number;
  totalConnections: number;
  parentEdges: number;
  relatedEdges: number;
  memoKeywordLinks: number;
  peopleCount: number;
  placeCount: number;
  centralKeywords: Array<{ id: string; name: string; degree: number }>;
  isolatedMemos: Array<{ id: string; title: string }>;
} {
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const e of state.keywordParents) { bump(e.keywordId); bump(e.parentId); }
  for (const e of state.keywordLinks) bump(e.keywordId);
  for (const l of state.memoKeywords) bump(l.keywordId);
  const centralKeywords = state.keywords
    .map((k) => ({ id: k.id, name: k.name, degree: degree.get(k.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);
  const linkedMemoIds = new Set(state.memoKeywords.map((l) => l.memoId));
  const isolatedMemos = state.memos
    .filter((m) => !linkedMemoIds.has(m.id))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 10)
    .map((m) => ({ id: m.id, title: m.title }));
  return {
    memoCount: state.memos.length,
    keywordCount: state.keywords.length,
    totalConnections: state.keywordParents.length + state.keywordLinks.length + state.memoKeywords.length,
    parentEdges: state.keywordParents.length,
    relatedEdges: state.keywordLinks.length,
    memoKeywordLinks: state.memoKeywords.length,
    peopleCount: state.people.length,
    placeCount: state.places.length,
    centralKeywords,
    isolatedMemos,
  };
}

export function analyticsPrompt(state: LocalState, minLinks = 2): { prompt: string; significantKeywords: string[] } {
  const byId = new Map(state.keywords.map((k) => [k.id, k.name]));
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const p of state.keywordParents) { bump(p.keywordId); bump(p.parentId); }
  for (const l of state.keywordLinks) bump(l.keywordId);
  const significant = state.keywords.filter((k) => (degree.get(k.id) ?? 0) >= minLinks);
  const memoByKeyword = new Map<string, string[]>();
  for (const mk of state.memoKeywords) {
    const kw = byId.get(mk.keywordId);
    const memo = state.memos.find((m) => m.id === mk.memoId);
    if (!kw || !memo) continue;
    const arr = memoByKeyword.get(kw) ?? [];
    if (arr.length < 5) arr.push(memo.title);
    memoByKeyword.set(kw, arr);
  }
  const lines: string[] = [];
  lines.push("당신은 지식 온톨로지 분석가입니다. 아래 메모들의 키워드·사람·장소·시간 연결을 분석해주세요.");
  lines.push("");
  lines.push("[유의미 키워드 (연결 " + minLinks + "개 이상)]");
  for (const k of significant) lines.push(`- ${k.name} (연결 ${degree.get(k.id) ?? 0}개)`);
  if (significant.length === 0) {
    lines.push("(유의미 키워드가 아직 없어. 연결이 가장 많은 키워드 위주로 분석해줘.)");
    lines.push(...state.keywords.slice(0, 10).map((k) => `- ${k.name} (연결 ${degree.get(k.id) ?? 0}개)`));
  }
  lines.push("");
  lines.push("[현재 관계]");
  for (const p of state.keywordParents) {
    lines.push(`- ${byId.get(p.keywordId)} → 상위: ${byId.get(p.parentId)}${p.locked === 1 ? " (잠김: 바꾸지 마)" : ""}`);
  }
  for (const l of state.keywordLinks) {
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
  return { prompt: lines.join("\n"), significantKeywords: significant.map((k) => k.name) };
}

/* ---------------- Drive 파일 형식 (1메모=1파일 JSON) ---------------- */

export type DriveMemoFile = {
  id: string;
  title: string;
  categoryId?: string | null;
  color?: string | null;
  pinned?: boolean;
  updatedAt?: string;
  blocks?: Array<{ id?: string; type?: string; text?: string; checked?: boolean; dueDate?: string | null }>;
};

/** Drive 파일 1개를 로컬 상태에 멱등으로 반영한다 (drive_file_id 기준). */
export function upsertMemoFromDrive(state: LocalState, file: DriveMemoFile, driveFileId: string): string {
  const existing = state.memos.find((m) => m.id === file.id || m.driveFileId === driveFileId);
  const memoId = existing?.id ?? file.id ?? uid();
  const ts = nowIso();
  const blocks: Block[] = (file.blocks ?? []).map((b, i) => ({
    id: b.id ?? uid(),
    position: i,
    type: (["paragraph", "todo", "photo", "voice", "schedule"].includes(b.type ?? "") ? b.type! : "paragraph") as BlockType,
    text: b.text ?? "",
    checked: b.checked ? 1 : 0,
    attachmentId: null,
    dueDate: b.dueDate ?? null,
  }));
  if (existing) {
    existing.title = file.title ?? "";
    existing.categoryId = file.categoryId ?? null;
    existing.color = file.color ?? null;
    existing.pinned = file.pinned ? 1 : 0;
    existing.driveFileId = driveFileId;
    existing.updatedAt = file.updatedAt ?? ts;
    existing.blocks = blocks;
  } else {
    state.memos.push({
      id: memoId,
      title: file.title ?? "",
      categoryId: file.categoryId ?? null,
      color: file.color ?? null,
      pinned: file.pinned ? 1 : 0,
      driveFileId,
      createdAt: ts,
      updatedAt: file.updatedAt ?? ts,
      blocks,
    });
  }
  return memoId;
}

/** 로컬 메모 1개를 Drive 파일 형식으로 직렬화한다. */
export function memoToDriveFile(memo: MemoRecord): DriveMemoFile {
  return {
    id: memo.id,
    title: memo.title,
    categoryId: memo.categoryId,
    color: memo.color,
    pinned: memo.pinned === 1,
    updatedAt: memo.updatedAt,
    blocks: [...memo.blocks]
      .sort((a, b) => a.position - b.position)
      .map((b) => ({ id: b.id, type: b.type, text: b.text, checked: b.checked === 1, dueDate: b.dueDate })),
  };
}
