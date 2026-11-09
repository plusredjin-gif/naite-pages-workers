/**
 * 나이테 정적 프론트엔드 — Worker API 클라이언트 (타입 포함)
 *
 * Pages에 올릴 정적 클라이언트가 이 모듈로 Worker(api.naite.plustree.net)를 부른다.
 * 인증은 이 파일에서 하지 않는다. 세션 쿠키(naite_session)는 브라우저가 자동으로
 * 보내며, 로그인 UI·플로우는 그록 소유(auth-seam.ts의 AuthProvider 참조).
 * 401이 오면 프론트엔드는 AuthProvider.login()으로 보내면 된다.
 *
 * 설정: Vite 기준 VITE_API_BASE_URL (기본값 https://api.naite.plustree.net).
 * 테스트 모드에서는 OAuth 연결 없이 이 클라이언트를 쓸 수 없다 — 세션이 없으면
 * 401이 온다. 테스트용 가짜 세션은 auth-seam.ts의 개발용 mock만 쓴다.
 */

export const API_BASE_URL =
  // @ts-expect-error Vite 환경에서만 존재
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  "https://api.naite.plustree.net";

export type MemoPreview = {
  id: string;
  title: string;
  categoryId: string | null;
  color: string | null;
  pinned: number;
  driveFileId: string | null;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
};

export type Block = {
  id: string;
  position: number;
  type: "paragraph" | "todo" | "photo" | "voice" | "schedule";
  text: string;
  checked: number;
  attachmentId: string | null;
  dueDate: string | null;
};

export type MemoDetail = Omit<MemoPreview, "preview"> & {
  blocks: Block[];
  keywords: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string; email: string | null }>;
  places: Array<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null }>;
  locations: Array<{ id: string; name: string; lat: number | null; lng: number | null }>;
  event: { googleEventId: string | null; startAt: string; endAt: string; allDay: number } | null;
};

export type Category = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OntologyGraph = {
  keywords: Array<{ id: string; name: string }>;
  parentEdges: Array<{ fromId: string; toId: string; locked: number; kind: string }>;
  relatedEdges: Array<{ fromId: string; toId: string; locked: number; kind: string }>;
  memoKeywords: Array<{ memoId: string; keywordId: string }>;
  people: Array<{ id: string; name: string }>;
  places: Array<{ id: string; name: string; lat: number | null; lng: number | null }>;
  locations: Array<{ id: string; name: string; lat: number | null; lng: number | null }>;
};

export type AnalyticsSummary = {
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
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include", // 세션 쿠키(naite_session) 자동 전송
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    const err = new Error("unauthorized") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `api_error_${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  bootstrap: () => call<{
    user: { id: string; email: string | null; displayName: string | null } | null;
    driveConnected: boolean;
    settings: Record<string, string>;
    memoFolderName: string;
  }>("/api/bootstrap"),

  settings: {
    get: () => call<{ settings: Record<string, string> }>("/api/settings"),
    update: (settings: Record<string, string>) =>
      call<{ ok: boolean }>("/api/settings", { method: "PATCH", body: JSON.stringify({ settings }) }),
  },

  categories: {
    list: () => call<{ categories: Category[] }>("/api/categories"),
    create: (data: { name: string; color?: string; icon?: string; parentId?: string | null }) =>
      call<{ id: string }>("/api/categories", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Category>) =>
      call<{ ok: boolean }>(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => call<{ ok: boolean }>(`/api/categories/${id}`, { method: "DELETE" }),
  },

  memos: {
    list: (params?: { categoryId?: string; search?: string; from?: string; to?: string; sort?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) q.set(k, String(v));
      const suffix = q.toString() ? `?${q.toString()}` : "";
      return call<{ memos: MemoPreview[]; total: number; limit: number; offset: number }>(`/api/memos${suffix}`);
    },
    create: (data: { title?: string; categoryId?: string | null; color?: string; pinned?: boolean }) =>
      call<{ id: string }>("/api/memos", { method: "POST", body: JSON.stringify(data) }),
    get: (id: string) => call<MemoDetail>(`/api/memos/${id}`),
    update: (id: string, data: Partial<{ title: string; categoryId: string | null; color: string; pinned: boolean }>) =>
      call<{ ok: boolean }>(`/api/memos/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => call<{ ok: boolean }>(`/api/memos/${id}`, { method: "DELETE" }),
    addBlock: (memoId: string, data: { type: Block["type"]; text?: string; checked?: boolean; dueDate?: string | null }) =>
      call<{ id: string }>(`/api/memos/${memoId}/blocks`, { method: "POST", body: JSON.stringify(data) }),
    extractKeywords: (memoId: string) =>
      call<{ keywords: string[] }>(`/api/memos/${memoId}/extract-keywords`, { method: "POST", body: "{}" }),
    setGeo: (memoId: string, data: { lat: number; lng: number; name?: string }) =>
      call<{ ok: boolean; locationId: string; name: string }>(`/api/memos/${memoId}/geo`, { method: "POST", body: JSON.stringify(data) }),
  },

  blocks: {
    update: (id: string, data: Partial<Block>) =>
      call<{ ok: boolean }>(`/api/blocks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => call<{ ok: boolean }>(`/api/blocks/${id}`, { method: "DELETE" }),
  },

  keywords: {
    list: () =>
      call<{
        keywords: Array<{ id: string; name: string; createdAt: string }>;
        parents: Array<{ keywordId: string; parentId: string; locked: number }>;
        links: Array<{ keywordId: string; relatedId: string; locked: number }>;
      }>("/api/keywords"),
    create: (name: string) => call<{ id: string }>("/api/keywords", { method: "POST", body: JSON.stringify({ name }) }),
    addParent: (keywordId: string, parentId: string, locked = false) =>
      call<{ ok: boolean }>(`/api/keywords/${keywordId}/parents`, { method: "POST", body: JSON.stringify({ parentId, locked }) }),
    removeParent: (keywordId: string, parentId: string) =>
      call<{ ok: boolean; wasLocked: boolean }>(`/api/keywords/${keywordId}/parents/${parentId}`, { method: "DELETE" }),
    addRelated: (keywordId: string, relatedId: string, locked = false) =>
      call<{ ok: boolean }>(`/api/keywords/${keywordId}/related`, { method: "POST", body: JSON.stringify({ relatedId, locked }) }),
    removeRelated: (keywordId: string, relatedId: string) =>
      call<{ ok: boolean; wasLocked: boolean }>(`/api/keywords/${keywordId}/related/${relatedId}`, { method: "DELETE" }),
  },

  ontology: {
    graph: () => call<OntologyGraph>("/api/ontology/graph"),
    previewImport: (json: string) =>
      call<{
        ok: boolean;
        newKeywords: string[];
        parentChanges: Array<{ keyword: string; parent: string }>;
        linksAdded: Array<{ from: string; to: string }>;
        linksToRemove: Array<{ from: string; to: string; kind?: string }>;
        skippedLocked: Array<{ keyword: string; parent?: string; related?: string }>;
      }>("/api/ontology/import/preview", { method: "POST", body: JSON.stringify({ json }) }),
    applyImport: (json: string) =>
      call<{ ok: boolean; revisionId: string; applied: Record<string, unknown> }>("/api/ontology/import/apply", {
        method: "POST",
        body: JSON.stringify({ json }),
      }),
    revisions: () =>
      call<{ revisions: Array<{ id: string; changeSummary: string; undone: number; createdAt: string }> }>(
        "/api/ontology/revisions",
      ),
    undoRevision: (revisionId: string) =>
      call<{ ok: boolean }>(`/api/ontology/revisions/${revisionId}/undo`, { method: "POST", body: "{}" }),
  },

  people: {
    list: () =>
      call<{ people: Array<{ id: string; name: string; email: string | null; phone: string | null; googleResourceName: string | null; memoCount: number }> }>(
        "/api/people",
      ),
    create: (data: { name: string; email?: string; phone?: string; googleResourceName?: string }) =>
      call<{ id: string }>("/api/people", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) => call<{ ok: boolean }>(`/api/people/${id}`, { method: "DELETE" }),
    search: (q: string) =>
      call<{ candidates: Array<{ googleResourceName: string; name: string; email: string; phone: string }> }>(
        `/api/people/search?q=${encodeURIComponent(q)}`,
      ),
  },

  places: {
    list: () =>
      call<{ places: Array<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null; memoCount: number }> }>(
        "/api/places",
      ),
    create: (data: { name: string; address?: string; lat?: number | null; lng?: number | null }) =>
      call<{ id: string }>("/api/places", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) => call<{ ok: boolean }>(`/api/places/${id}`, { method: "DELETE" }),
    search: (q: string) =>
      call<{ candidates: Array<{ name: string; address: string; lat: number | null; lng: number | null; partialMatch: boolean }>; status: string }>(
        `/api/places/search?q=${encodeURIComponent(q)}`,
      ),
  },

  locations: {
    list: () =>
      call<{ locations: Array<{ id: string; name: string; lat: number | null; lng: number | null; memoCount: number }> }>(
        "/api/locations",
      ),
  },

  calendar: {
    createEvent: (data: { memoId?: string; title: string; start: string; end?: string; allDay?: boolean; description?: string }) =>
      call<{ ok: boolean; googleEventId: string | null }>("/api/calendar/events", { method: "POST", body: JSON.stringify(data) }),
    agenda: (days = 30) =>
      call<{ events: Array<{ googleEventId: string; title: string; start: string; end: string; memoId: string | null }> }>(
        `/api/calendar/agenda?days=${days}`,
      ),
  },

  tasks: {
    list: () =>
      call<{ tasks: Array<{ googleTaskId: string; title: string; completed: boolean; due: string | null; parent: string | null; blockId: string | null }>; taskListId: string }>(
        "/api/tasks",
      ),
    sync: (blockId: string) =>
      call<{ ok: boolean; googleTaskId: string | null }>("/api/tasks/sync", { method: "POST", body: JSON.stringify({ blockId }) }),
  },

  drive: {
    status: () =>
      call<{ memoFolderExists: boolean; memoFolderId: string | null; syncedMemoCount: number; lastSyncAt: string | null }>(
        "/api/drive/status",
      ),
    sync: (dryRun = false) =>
      call<{ ok?: boolean; folderId?: string; total: number; changed: number; imported?: number; errors?: Array<{ file: string; error: string }>; files?: unknown[] }>(
        `/api/drive/sync${dryRun ? "?dryRun=1" : ""}`,
        { method: "POST", body: "{}" },
      ),
    importAll: (dryRun = false) =>
      call<{ ok?: boolean; folderId?: string; total: number; imported?: number; errors?: Array<{ file: string; error: string }>; files?: unknown[] }>(
        `/api/drive/import${dryRun ? "?dryRun=1" : ""}`,
        { method: "POST", body: "{}" },
      ),
    pushMemo: (memoId: string) =>
      call<{ ok: boolean; driveFileId: string | null }>(`/api/drive/memos/${memoId}/push`, { method: "POST", body: "{}" }),
  },

  attachments: {
    upload: async (memoId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("memoId", memoId);
      const res = await fetch(`${API_BASE_URL}/api/attachments/upload`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (res.status === 401) throw Object.assign(new Error("unauthorized"), { code: "UNAUTHORIZED" });
      if (!res.ok) throw new Error(`upload_failed_${res.status}`);
      return (await res.json()) as { id: string; url: string };
    },
  },

  analytics: {
    summary: () => call<AnalyticsSummary>("/api/analytics/summary"),
    prompt: (minLinks = 2) =>
      call<{ prompt: string; significantKeywords: string[] }>(`/api/analytics/prompt?minLinks=${minLinks}`),
  },
};
