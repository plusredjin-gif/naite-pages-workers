/**
 * 나이테 Pages-only — 프론트엔드 API (브라우저 직접 호출)
 *
 * Pages-only 전환 (2026-11-09 jin 결정): Worker(api.naite.plustree.net)가
 * 없어졌으므로 이 모듈이 Worker를 부르지 않는다. 대신
 *  - 메모·카테고리·키워드·온톨로지·사람·장소·설정: 브라우저 로컬 저장소
 *    (local-store.ts, localStorage) 에서 계산·저장한다.
 *  - Drive·Calendar·Tasks·People·Geocoding: 브라우저에서 Google API를
 *    직접 부른다 (google-client.ts, access_token은 AuthProvider가 공급).
 *  - Drive `memo` 폴더는 "진실의 원본" 중 하나로 유지된다 (1메모=1파일 JSON).
 *    로컬 ↔ Drive 맞춤은 수동 동기화(api.drive.sync / importAll / pushMemo)로만
 *    한다. 자동·백그라운드 동기화는 Pages-only에서 안 된다.
 *
 * 인증: 이 파일은 토큰을 발급·갱신하지 않는다. Google API 호출에 필요한
 * access_token은 AuthProvider(그록 소유 로그인)가 공급한다.
 * `configureApiTokenProvider()`로 AuthProvider의 토큰 공급자를 연결하고,
 * 연결 전에는 sessionStorage에 저장된 토큰(token-store.ts)을 쓴다.
 * 토큰이 없거나 만료되면 UNAUTHORIZED / TOKEN_EXPIRED_RELOGIN_REQUIRED
 * 에러를 던지고, 프론트엔드는 AuthProvider.login()으로 보낸다.
 *
 * 외부 인터페이스는 이전 Worker 클라이언트와 같은 모양을 유지한다
 * (api.memos.list, api.blocks.update 등). 화면 코드는 이 모듈 뒤에서
 * 그대로 동작한다. 달라진 점은 docs/API_MAPPING.md 참조.
 *
 * 설정: Vite 기준 VITE_GOOGLE_MAPS_API_KEY (장소 검색·역지오코딩용, 없으면 미지원).
 * API_BASE_URL(VITE_API_BASE_URL)은 Pages-only에서 쓰지 않는다.
 */

import {
  GoogleApiError,
  TOKEN_EXPIRED_CODE,
  UNAUTHORIZED_CODE,
  calendarCreateEvent,
  calendarListAgenda,
  driveDownloadJson,
  driveEnsureMemoFolder,
  driveFindMemoFolder,
  driveListMemoFiles,
  driveUploadAttachment,
  driveUploadMemoJson,
  geocodeSearch,
  peopleSearchContacts,
  reverseGeocode,
  tasksCreateOrPatch,
  tasksGetOrCreateListId,
  tasksList,
  fetchGoogleUserinfo,
  sessionTokenProvider,
  type TokenProvider,
} from "./google-client";
import {
  analyticsPrompt,
  analyticsSummary,
  applyOntologyImport,
  emptyState,
  extractKeywords,
  getOrCreateKeywordId,
  loadState,
  memoToDriveFile,
  nowIso,
  parseOntologyJson,
  previewOntologyImport,
  saveState,
  undoOntologyRevision,
  upsertMemoFromDrive,
  uid,
  wouldCycle,
  type Block as LocalBlock,
  type DriveMemoFile,
  type LocalState,
  type MemoRecord,
} from "./local-store";

export { GoogleApiError, TOKEN_EXPIRED_CODE, UNAUTHORIZED_CODE };

/* ---------------- 토큰 공급자 연결 (그록 AuthProvider가 호출) ---------------- */

let tokenProvider: TokenProvider = sessionTokenProvider;

/** AuthProvider(그록 소유)가 자신의 토큰 공급자를 연결한다. */
export function configureApiTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/* ---------------- 타입 (이전 Worker 클라이언트와 동일) ---------------- */

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

export type Block = LocalBlock;

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

/** Pages-only 미지원 기능임을 알리는 에러. */
export class UnsupportedInPagesOnlyError extends Error {
  constructor(feature: string) {
    super(`unsupported_in_pages_only: ${feature}`);
    this.name = "UnsupportedInPagesOnlyError";
  }
}

/* ---------------- 공용 헬퍼 ---------------- */

/** 로컬 상태를 읽어 바꾸고 저장하는 래퍼. */
function mutate<T>(fn: (state: LocalState) => T): T {
  const state = loadState();
  const result = fn(state);
  saveState(state);
  return result;
}

function memoToPreview(m: MemoRecord): MemoPreview {
  const first = [...m.blocks].sort((a, b) => a.position - b.position)[0];
  return {
    id: m.id,
    title: m.title,
    categoryId: m.categoryId,
    color: m.color,
    pinned: m.pinned,
    driveFileId: m.driveFileId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    preview: first?.text ?? null,
  };
}

function memoToDetail(state: LocalState, m: MemoRecord): MemoDetail {
  const keywords = state.memoKeywords
    .filter((l) => l.memoId === m.id)
    .map((l) => state.keywords.find((k) => k.id === l.keywordId))
    .filter((k): k is { id: string; name: string; createdAt: string } => !!k)
    .map((k) => ({ id: k.id, name: k.name }));
  const people = state.memoPeople
    .filter((l) => l.memoId === m.id)
    .map((l) => state.people.find((p) => p.id === l.personId))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.name, email: p.email }));
  const places = state.memoPlaces
    .filter((l) => l.memoId === m.id)
    .map((l) => state.places.find((p) => p.id === l.placeId))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng }));
  const locations = state.memoLocations
    .filter((l) => l.memoId === m.id)
    .map((l) => state.locations.find((p) => p.id === l.locationId))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng }));
  const ev = state.memoEvents.find((e) => e.memoId === m.id) ?? null;
  return {
    id: m.id,
    title: m.title,
    categoryId: m.categoryId,
    color: m.color,
    pinned: m.pinned,
    driveFileId: m.driveFileId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    blocks: [...m.blocks].sort((a, b) => a.position - b.position),
    keywords,
    people,
    places,
    locations,
    event: ev
      ? { googleEventId: ev.googleEventId, startAt: ev.startAt, endAt: ev.endAt, allDay: ev.allDay }
      : null,
  };
}

const MAPS_API_KEY: string | null =
  // @ts-expect-error Vite 환경에서만 존재
  (typeof import.meta !== "undefined" && (import.meta.env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined)) || null;

/* ---------------- API ---------------- */

export const api = {
  /** 부트스트랩: 로컬 설정 + (토큰이 있으면) Google userinfo로 사용자 확인. */
  bootstrap: async () => {
    const state = loadState();
    let user: { id: string; email: string | null; displayName: string | null } | null = null;
    let driveConnected = false;
    try {
      const token = await tokenProvider.getAccessToken();
      if (token) {
        const me = await fetchGoogleUserinfo(tokenProvider);
        user = { id: me.sub, email: me.email ?? null, displayName: me.name ?? null };
        driveConnected = true;
      }
    } catch {
      // 토큰이 없거나 userinfo가 실패하면 비로그인 상태로 둔다.
      user = null;
      driveConnected = false;
    }
    return { user, driveConnected, settings: state.settings, memoFolderName: "memo" };
  },

  settings: {
    get: async () => ({ settings: loadState().settings }),
    update: async (settings: Record<string, string>) => {
      mutate((state) => {
        for (const [k, v] of Object.entries(settings)) state.settings[k] = v;
      });
      return { ok: true };
    },
  },

  categories: {
    list: async () => {
      const state = loadState();
      return { categories: state.categories as Category[] };
    },
    create: async (data: { name: string; color?: string; icon?: string; parentId?: string | null }) => {
      if (!data.name.trim()) throw new Error("name_required");
      const id = uid();
      const ts = nowIso();
      mutate((state) => {
        state.categories.push({
          id,
          name: data.name.trim(),
          color: data.color ?? null,
          icon: data.icon ?? null,
          parentId: data.parentId ?? null,
          createdAt: ts,
          updatedAt: ts,
        });
      });
      return { id };
    },
    update: async (id: string, data: Partial<Category>) => {
      const found = mutate((state) => {
        const c = state.categories.find((x) => x.id === id);
        if (!c) return false;
        if (data.name !== undefined) c.name = data.name;
        if (data.color !== undefined) c.color = data.color;
        if (data.icon !== undefined) c.icon = data.icon;
        if (data.parentId !== undefined) c.parentId = data.parentId;
        c.updatedAt = nowIso();
        return true;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    remove: async (id: string) => {
      mutate((state) => {
        // 하위 카테고리와 메모는 미분류로 푼다 (삭제 시 데이터 소실 방지).
        for (const c of state.categories) if (c.parentId === id) c.parentId = null;
        for (const m of state.memos) if (m.categoryId === id) m.categoryId = null;
        state.categories = state.categories.filter((c) => c.id !== id);
      });
      return { ok: true };
    },
  },

  memos: {
    list: async (params?: { categoryId?: string; search?: string; from?: string; to?: string; sort?: string; limit?: number; offset?: number; pinned?: boolean }) => {
      const state = loadState();
      let memos = [...state.memos];
      if (params?.categoryId === "__none__") {
        // 미분류만: 카테고리가 없는 메모.
        memos = memos.filter((m) => m.categoryId === null);
      } else if (params?.categoryId) {
        memos = memos.filter((m) => m.categoryId === params.categoryId);
      }
      if (params?.pinned) memos = memos.filter((m) => m.pinned === 1);
      if (params?.search) {
        const q = params.search.trim();
        memos = memos.filter(
          (m) => m.title.includes(q) || m.blocks.some((b) => b.text.includes(q)),
        );
      }
      if (params?.from) memos = memos.filter((m) => m.updatedAt >= (params.from as string));
      if (params?.to) memos = memos.filter((m) => m.updatedAt <= (params.to as string));
      const sortAsc = params?.sort === "oldest";
      memos.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return sortAsc
          ? a.updatedAt < b.updatedAt ? -1 : 1
          : a.updatedAt < b.updatedAt ? 1 : -1;
      });
      const total = memos.length;
      const limit = Math.min(Math.max(params?.limit ?? 30, 1), 100);
      const offset = Math.max(params?.offset ?? 0, 0);
      return { memos: memos.slice(offset, offset + limit).map(memoToPreview), total, limit, offset };
    },
    create: async (data: { title?: string; categoryId?: string | null; color?: string; pinned?: boolean }) => {
      const id = uid();
      const ts = nowIso();
      mutate((state) => {
        state.memos.push({
          id,
          title: data.title ?? "",
          categoryId: data.categoryId ?? null,
          color: data.color ?? null,
          pinned: data.pinned ? 1 : 0,
          driveFileId: null,
          createdAt: ts,
          updatedAt: ts,
          // 새 메모는 제목 밑에 빈 단락 블록을 기본으로 깐다 (memoaeb 스펙).
          blocks: [{ id: uid(), position: 0, type: "paragraph", text: "", checked: 0, attachmentId: null, dueDate: null }],
        });
      });
      return { id };
    },
    get: async (id: string) => {
      const state = loadState();
      const m = state.memos.find((x) => x.id === id);
      if (!m) throw new Error("not_found");
      return memoToDetail(state, m);
    },
    update: async (id: string, data: Partial<{ title: string; categoryId: string | null; color: string; pinned: boolean }>) => {
      const found = mutate((state) => {
        const m = state.memos.find((x) => x.id === id);
        if (!m) return false;
        if (data.title !== undefined) m.title = data.title;
        if (data.categoryId !== undefined) m.categoryId = data.categoryId;
        if (data.color !== undefined) m.color = data.color;
        if (data.pinned !== undefined) m.pinned = data.pinned ? 1 : 0;
        m.updatedAt = nowIso();
        return true;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    remove: async (id: string) => {
      const found = mutate((state) => {
        const before = state.memos.length;
        state.memos = state.memos.filter((m) => m.id !== id);
        state.memoKeywords = state.memoKeywords.filter((l) => l.memoId !== id);
        state.memoPeople = state.memoPeople.filter((l) => l.memoId !== id);
        state.memoPlaces = state.memoPlaces.filter((l) => l.memoId !== id);
        state.memoLocations = state.memoLocations.filter((l) => l.memoId !== id);
        state.memoEvents = state.memoEvents.filter((e) => e.memoId !== id);
        return state.memos.length !== before;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    addBlock: async (memoId: string, data: { type: Block["type"]; text?: string; checked?: boolean; dueDate?: string | null }) => {
      const id = uid();
      const ok = mutate((state) => {
        const m = state.memos.find((x) => x.id === memoId);
        if (!m) return false;
        const type = ["paragraph", "todo", "photo", "voice", "schedule"].includes(data.type) ? data.type : "paragraph";
        const maxPos = m.blocks.reduce((acc, b) => Math.max(acc, b.position), -1);
        m.blocks.push({
          id,
          position: maxPos + 1,
          type,
          text: data.text ?? "",
          checked: data.checked ? 1 : 0,
          attachmentId: null,
          dueDate: data.dueDate ?? null,
        });
        m.updatedAt = nowIso();
        return true;
      });
      if (!ok) throw new Error("not_found");
      return { id };
    },
    extractKeywords: async (memoId: string) => {
      const keywords = mutate((state) => {
        const m = state.memos.find((x) => x.id === memoId);
        if (!m) throw new Error("not_found");
        const text = [m.title, ...m.blocks.filter((b) => b.type === "paragraph" || b.type === "todo").map((b) => b.text)].join("\n");
        const names = extractKeywords(text);
        for (const name of names) {
          const kid = getOrCreateKeywordId(state, name);
          if (!state.memoKeywords.some((l) => l.memoId === memoId && l.keywordId === kid)) {
            state.memoKeywords.push({ memoId, keywordId: kid });
          }
        }
        return names;
      });
      return { keywords };
    },
    setGeo: async (memoId: string, data: { lat: number; lng: number; name?: string }) => {
      if (typeof data.lat !== "number" || typeof data.lng !== "number") throw new Error("lat_lng_required");
      let name = data.name ?? "";
      if (!name) {
        // Maps 키가 없으면 역지오코딩 없이 좌표만 저장한다.
        name = (await reverseGeocode(MAPS_API_KEY, data.lat, data.lng)) ?? `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
      }
      const result = mutate((state) => {
        const m = state.memos.find((x) => x.id === memoId);
        if (!m) throw new Error("not_found");
        let loc = state.locations.find((l) => l.name === name);
        if (!loc) {
          loc = { id: uid(), name, lat: data.lat, lng: data.lng };
          state.locations.push(loc);
        }
        if (!state.memoLocations.some((l) => l.memoId === memoId && l.locationId === loc.id)) {
          state.memoLocations.push({ memoId, locationId: loc.id });
        }
        return { locationId: loc.id, name };
      });
      return { ok: true, ...result };
    },
    /** 메모의 위치 메타데이터·온톨로지 위치 연결을 지운다 (위치 노드 자체는 남는다). */
    clearGeo: async (memoId: string) => {
      mutate((state) => {
        state.memoLocations = state.memoLocations.filter((l) => l.memoId !== memoId);
      });
      return { ok: true };
    },
    /** 메모에 사람을 연결·해제한다. */
    linkPerson: async (memoId: string, personId: string) => {
      mutate((state) => {
        if (!state.memos.some((m) => m.id === memoId) || !state.people.some((p) => p.id === personId)) {
          throw new Error("not_found");
        }
        if (!state.memoPeople.some((l) => l.memoId === memoId && l.personId === personId)) {
          state.memoPeople.push({ memoId, personId });
        }
      });
      return { ok: true };
    },
    unlinkPerson: async (memoId: string, personId: string) => {
      mutate((state) => {
        state.memoPeople = state.memoPeople.filter((l) => !(l.memoId === memoId && l.personId === personId));
      });
      return { ok: true };
    },
    /** 메모에 장소를 연결·해제한다. */
    linkPlace: async (memoId: string, placeId: string) => {
      mutate((state) => {
        if (!state.memos.some((m) => m.id === memoId) || !state.places.some((p) => p.id === placeId)) {
          throw new Error("not_found");
        }
        if (!state.memoPlaces.some((l) => l.memoId === memoId && l.placeId === placeId)) {
          state.memoPlaces.push({ memoId, placeId });
        }
      });
      return { ok: true };
    },
    unlinkPlace: async (memoId: string, placeId: string) => {
      mutate((state) => {
        state.memoPlaces = state.memoPlaces.filter((l) => !(l.memoId === memoId && l.placeId === placeId));
      });
      return { ok: true };
    },
    /** 메모에 키워드를 직접 추가·제거한다 (자동 추출과 별개). */
    addKeyword: async (memoId: string, name: string) => {
      if (!name.trim()) throw new Error("name_required");
      const id = mutate((state) => {
        if (!state.memos.some((m) => m.id === memoId)) throw new Error("not_found");
        const kid = getOrCreateKeywordId(state, name.trim());
        if (!state.memoKeywords.some((l) => l.memoId === memoId && l.keywordId === kid)) {
          state.memoKeywords.push({ memoId, keywordId: kid });
        }
        return kid;
      });
      return { id };
    },
    removeKeyword: async (memoId: string, keywordId: string) => {
      mutate((state) => {
        state.memoKeywords = state.memoKeywords.filter((l) => !(l.memoId === memoId && l.keywordId === keywordId));
      });
      return { ok: true };
    },
    /**
     * 마크다운·HTML 가져오기: 붙여넣은 텍스트를 블록으로 바꿔 메모 끝에 추가한다.
     * `- [ ]`/`- [x]`는 체크리스트, `#` 제목·일반 줄은 단락, 빈 줄은 건너뛴다.
     * HTML은 태그를 벗기고 줄 단위로 나눈 뒤 같은 규칙으로 처리한다.
     */
    importText: async (memoId: string, text: string, format: "markdown" | "html") => {
      if (!text.trim()) throw new Error("empty_text");
      const plain =
        format === "html"
          ? text
              .replace(/<(br|p|div|li|h[1-6])[^>]*>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
          : text;
      const lines = plain.split("\n").map((l) => l.trim()).filter(Boolean);
      let added = 0;
      mutate((state) => {
        const m = state.memos.find((x) => x.id === memoId);
        if (!m) throw new Error("not_found");
        let pos = m.blocks.reduce((acc, b) => Math.max(acc, b.position), -1);
        for (const line of lines) {
          const todo = line.match(/^[-*]\s*\[( |x|X)\]\s*(.*)$/);
          if (todo) {
            pos += 1;
            m.blocks.push({ id: uid(), position: pos, type: "todo", text: todo[2], checked: todo[1].toLowerCase() === "x" ? 1 : 0, attachmentId: null, dueDate: null });
          } else {
            const heading = line.match(/^#{1,6}\s+(.*)$/);
            pos += 1;
            m.blocks.push({ id: uid(), position: pos, type: "paragraph", text: heading ? heading[1] : line.replace(/^[-*]\s+/, ""), checked: 0, attachmentId: null, dueDate: null });
          }
          added += 1;
        }
        m.updatedAt = nowIso();
      });
      return { ok: true, added };
    },
  },

  blocks: {
    update: async (id: string, data: Partial<Block>) => {
      const found = mutate((state) => {
        for (const m of state.memos) {
          const b = m.blocks.find((x) => x.id === id);
          if (!b) continue;
          if (data.text !== undefined) b.text = data.text;
          if (data.checked !== undefined) b.checked = data.checked ? 1 : 0;
          if (data.position !== undefined) b.position = data.position;
          if (data.dueDate !== undefined) b.dueDate = data.dueDate;
          if (data.attachmentId !== undefined) b.attachmentId = data.attachmentId;
          m.updatedAt = nowIso();
          return true;
        }
        return false;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    remove: async (id: string) => {
      const found = mutate((state) => {
        for (const m of state.memos) {
          const before = m.blocks.length;
          m.blocks = m.blocks.filter((b) => b.id !== id);
          if (m.blocks.length !== before) {
            m.updatedAt = nowIso();
            return true;
          }
        }
        return false;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
  },

  keywords: {
    list: async () => {
      const state = loadState();
      return {
        keywords: state.keywords.map((k) => ({ id: k.id, name: k.name, createdAt: k.createdAt })),
        parents: state.keywordParents.map((e) => ({ keywordId: e.keywordId, parentId: e.parentId, locked: e.locked })),
        links: state.keywordLinks.map((e) => ({ keywordId: e.keywordId, relatedId: e.relatedId, locked: e.locked })),
      };
    },
    create: async (name: string) => {
      if (!name.trim()) throw new Error("name_required");
      const id = mutate((state) => getOrCreateKeywordId(state, name.trim()));
      return { id };
    },
    /** 키워드 이름 변경. */
    rename: async (id: string, name: string) => {
      if (!name.trim()) throw new Error("name_required");
      const found = mutate((state) => {
        const k = state.keywords.find((x) => x.id === id);
        if (!k) return false;
        k.name = name.trim();
        return true;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    /** 키워드 노드 삭제. 상위 간선·관련 링크·메모 태그도 함께 지운다 (메모 본문은 유지). */
    remove: async (id: string) => {
      const found = mutate((state) => {
        if (!state.keywords.some((k) => k.id === id)) return false;
        state.keywords = state.keywords.filter((k) => k.id !== id);
        state.keywordParents = state.keywordParents.filter((e) => e.keywordId !== id && e.parentId !== id);
        state.keywordLinks = state.keywordLinks.filter((e) => e.keywordId !== id && e.relatedId !== id);
        state.memoKeywords = state.memoKeywords.filter((l) => l.keywordId !== id);
        return true;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    addParent: async (keywordId: string, parentId: string, locked = false) => {
      const ok = mutate((state) => {
        if (keywordId === parentId) throw new Error("self_parent");
        if (!state.keywords.some((k) => k.id === keywordId) || !state.keywords.some((k) => k.id === parentId)) {
          throw new Error("not_found");
        }
        if (wouldCycle(state, keywordId, parentId)) throw new Error("cycle_rejected");
        const existing = state.keywordParents.find((e) => e.keywordId === keywordId && e.parentId === parentId);
        if (existing) existing.locked = locked ? 1 : 0;
        else state.keywordParents.push({ keywordId, parentId, locked: locked ? 1 : 0 });
        return true;
      });
      void ok;
      return { ok: true };
    },
    removeParent: async (keywordId: string, parentId: string) => {
      const wasLocked = mutate((state) => {
        const edge = state.keywordParents.find((e) => e.keywordId === keywordId && e.parentId === parentId);
        if (!edge) throw new Error("not_found");
        state.keywordParents = state.keywordParents.filter((e) => !(e.keywordId === keywordId && e.parentId === parentId));
        return edge.locked === 1;
      });
      return { ok: true, wasLocked };
    },
    addRelated: async (keywordId: string, relatedId: string, locked = false) => {
      mutate((state) => {
        if (keywordId === relatedId) throw new Error("self_link");
        if (!state.keywords.some((k) => k.id === keywordId) || !state.keywords.some((k) => k.id === relatedId)) {
          throw new Error("not_found");
        }
        for (const [a, b] of [[keywordId, relatedId], [relatedId, keywordId]] as const) {
          const existing = state.keywordLinks.find((e) => e.keywordId === a && e.relatedId === b);
          if (existing) existing.locked = locked ? 1 : 0;
          else state.keywordLinks.push({ keywordId: a, relatedId: b, locked: locked ? 1 : 0 });
        }
      });
      return { ok: true };
    },
    removeRelated: async (keywordId: string, relatedId: string) => {
      const wasLocked = mutate((state) => {
        const link = state.keywordLinks.find((e) => e.keywordId === keywordId && e.relatedId === relatedId);
        if (!link) throw new Error("not_found");
        state.keywordLinks = state.keywordLinks.filter(
          (e) => !((e.keywordId === keywordId && e.relatedId === relatedId) || (e.keywordId === relatedId && e.relatedId === keywordId)),
        );
        return link.locked === 1;
      });
      return { ok: true, wasLocked };
    },
  },

  ontology: {
    graph: async () => {
      const state = loadState();
      const graph: OntologyGraph = {
        keywords: state.keywords.map((k) => ({ id: k.id, name: k.name })),
        parentEdges: state.keywordParents.map((e) => ({ fromId: e.keywordId, toId: e.parentId, locked: e.locked, kind: "parent" })),
        relatedEdges: state.keywordLinks.map((e) => ({ fromId: e.keywordId, toId: e.relatedId, locked: e.locked, kind: "related" })),
        memoKeywords: state.memoKeywords.map((l) => ({ memoId: l.memoId, keywordId: l.keywordId })),
        people: state.people.map((p) => ({ id: p.id, name: p.name })),
        places: state.places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
        locations: state.locations.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
      };
      return graph;
    },
    previewImport: async (json: string) => {
      const input = parseOntologyJson(json);
      if (!input) throw new Error("invalid_json");
      return previewOntologyImport(loadState(), input);
    },
    applyImport: async (json: string) => {
      const input = parseOntologyJson(json);
      if (!input) throw new Error("invalid_json");
      const result = mutate((state) => applyOntologyImport(state, input));
      return { ok: true, revisionId: result.revisionId, applied: result.applied };
    },
    revisions: async () => {
      const state = loadState();
      return {
        revisions: state.ontologyRevisions.slice(0, 20).map((r) => ({
          id: r.id,
          changeSummary: r.changeSummary,
          undone: r.undone,
          createdAt: r.createdAt,
        })),
      };
    },
    undoRevision: async (revisionId: string) => {
      const result = mutate((state) => undoOntologyRevision(state, revisionId));
      if (!result.ok) throw new Error(result.error ?? "undo_failed");
      return { ok: true };
    },
  },

  people: {
    list: async () => {
      const state = loadState();
      return {
        people: state.people.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          googleResourceName: p.googleResourceName,
          memoCount: state.memoPeople.filter((l) => l.personId === p.id).length,
        })),
      };
    },
    create: async (data: { name: string; email?: string; phone?: string; googleResourceName?: string }) => {
      if (!data.name.trim()) throw new Error("name_required");
      const id = uid();
      mutate((state) => {
        state.people.push({
          id,
          name: data.name.trim(),
          email: data.email ?? null,
          phone: data.phone ?? null,
          googleResourceName: data.googleResourceName ?? null,
        });
      });
      return { id };
    },
    remove: async (id: string) => {
      const found = mutate((state) => {
        const before = state.people.length;
        state.people = state.people.filter((p) => p.id !== id);
        state.memoPeople = state.memoPeople.filter((l) => l.personId !== id);
        return state.people.length !== before;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    search: async (q: string) => {
      if (!q.trim()) throw new Error("query_required");
      const candidates = await peopleSearchContacts(tokenProvider, q.trim());
      return { candidates };
    },
  },

  places: {
    list: async () => {
      const state = loadState();
      return {
        places: state.places.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          memoCount: state.memoPlaces.filter((l) => l.placeId === p.id).length,
        })),
      };
    },
    create: async (data: { name: string; address?: string; lat?: number | null; lng?: number | null }) => {
      if (!data.name.trim()) throw new Error("name_required");
      const id = uid();
      mutate((state) => {
        state.places.push({
          id,
          name: data.name.trim(),
          address: data.address ?? null,
          lat: typeof data.lat === "number" ? data.lat : null,
          lng: typeof data.lng === "number" ? data.lng : null,
        });
      });
      return { id };
    },
    remove: async (id: string) => {
      const found = mutate((state) => {
        const before = state.places.length;
        state.places = state.places.filter((p) => p.id !== id);
        state.memoPlaces = state.memoPlaces.filter((l) => l.placeId !== id);
        return state.places.length !== before;
      });
      if (!found) throw new Error("not_found");
      return { ok: true };
    },
    search: async (q: string) => {
      if (!q.trim()) throw new Error("query_required");
      // Maps 키가 없으면 장소 검색은 미지원 — 에러 대신 빈 결과+상태를 반환한다.
      const candidates = await geocodeSearch(MAPS_API_KEY, q.trim());
      if (candidates === null) {
        return { candidates: [], status: "MAPS_KEY_NOT_CONFIGURED" };
      }
      return { candidates, status: "OK" };
    },
  },

  locations: {
    list: async () => {
      const state = loadState();
      return {
        locations: state.locations.map((l) => ({
          id: l.id,
          name: l.name,
          lat: l.lat,
          lng: l.lng,
          memoCount: state.memoLocations.filter((x) => x.locationId === l.id).length,
        })),
      };
    },
  },

  calendar: {
    createEvent: async (data: { memoId?: string; title: string; start: string; end?: string; allDay?: boolean; description?: string }) => {
      if (!data.title.trim() || !data.start) throw new Error("title_and_start_required");
      const googleEventId = await calendarCreateEvent(tokenProvider, {
        summary: data.title,
        description: data.description ?? "",
        start: data.start,
        end: data.end ?? data.start,
        allDay: data.allDay === true,
      });
      if (data.memoId) {
        mutate((state) => {
          const existing = state.memoEvents.find((e) => e.memoId === data.memoId);
          const rec = {
            memoId: data.memoId as string,
            googleEventId,
            startAt: data.start,
            endAt: data.end ?? data.start,
            allDay: data.allDay === true ? 1 : 0,
          };
          if (existing) Object.assign(existing, rec);
          else state.memoEvents.push(rec);
        });
      }
      return { ok: true, googleEventId };
    },
    agenda: async (days = 30) => {
      const items = await calendarListAgenda(tokenProvider, days);
      const state = loadState();
      const memoByEvent = new Map(state.memoEvents.map((e) => [e.googleEventId, e.memoId]));
      return {
        events: items.map((e) => ({
          googleEventId: e.id ?? "",
          title: e.summary ?? "",
          start: e.start?.dateTime ?? e.start?.date ?? "",
          end: e.end?.dateTime ?? e.end?.date ?? "",
          memoId: e.id ? memoByEvent.get(e.id) ?? null : null,
        })),
      };
    },
  },

  tasks: {
    list: async () => {
      const listId = await tasksGetOrCreateListId(tokenProvider);
      if (!listId) throw new Error("tasks_list_failed");
      const items = await tasksList(tokenProvider, listId);
      const state = loadState();
      const blockByTask = new Map(state.taskLinks.map((l) => [l.googleTaskId, l.blockId]));
      return {
        tasks: items.map((t) => ({
          googleTaskId: t.id ?? "",
          title: t.title ?? "",
          completed: t.status === "completed",
          due: t.due ?? null,
          parent: t.parent ?? null,
          blockId: t.id ? blockByTask.get(t.id) ?? null : null,
        })),
        taskListId: listId,
      };
    },
    sync: async (blockId: string) => {
      const block = loadState().memos
        .flatMap((m) => m.blocks.map((b) => ({ block: b, memoId: m.id })))
        .find((x) => x.block.id === blockId && x.block.type === "todo");
      if (!block) throw new Error("not_found");
      const listId = await tasksGetOrCreateListId(tokenProvider);
      if (!listId) throw new Error("tasks_list_failed");
      const existing = loadState().taskLinks.find((l) => l.blockId === blockId);
      const taskBody: { title: string; status: string; notes?: string; due?: string } = {
        title: block.block.text,
        status: block.block.checked === 1 ? "completed" : "needsAction",
        notes: `naite:block:${blockId}`,
      };
      if (block.block.dueDate) taskBody.due = new Date(block.block.dueDate).toISOString();
      let taskId: string | null = null;
      try {
        taskId = await tasksCreateOrPatch(tokenProvider, listId, taskBody, existing?.googleTaskId ?? null);
      } catch (e) {
        // 삭제된 할일을 PATCH하려다 실패하면 새로 만든다.
        if (existing) {
          taskId = await tasksCreateOrPatch(tokenProvider, listId, taskBody, null);
        } else {
          throw e;
        }
      }
      if (taskId) {
        mutate((state) => {
          const link = state.taskLinks.find((l) => l.blockId === blockId);
          if (link) {
            link.googleTaskId = taskId as string;
            link.taskListId = listId;
          } else {
            state.taskLinks.push({ blockId, googleTaskId: taskId as string, taskListId: listId });
          }
        });
      }
      return { ok: true, googleTaskId: taskId };
    },
  },

  drive: {
    status: async () => {
      const state = loadState();
      let folderId: string | null = null;
      try {
        folderId = await driveFindMemoFolder(tokenProvider);
      } catch {
        folderId = null; // 토큰이 없으면 폴더 확인 불가 — 로컬 수만 반환한다.
      }
      return {
        memoFolderExists: folderId !== null,
        memoFolderId: folderId,
        syncedMemoCount: state.memos.filter((m) => m.driveFileId !== null).length,
        lastSyncAt: state.settings.last_drive_sync ?? null,
      };
    },
    /** 수동 동기화: Drive에서 바뀐 파일만 가져온다. dryRun이면 목록만 반환한다. 자동 동기화는 없다. */
    sync: async (dryRun = false) => {
      const folderId = await driveEnsureMemoFolder(tokenProvider);
      if (!folderId) throw new Error("drive_folder_failed");
      const files = await driveListMemoFiles(tokenProvider, folderId);
      const state = loadState();
      const since = state.settings.last_drive_sync ?? "1970-01-01T00:00:00Z";
      const changed = files.filter((f) => (f.modifiedTime ?? "") > since);
      if (dryRun) {
        return { folderId, total: files.length, changed: changed.length, files: changed };
      }
      let imported = 0;
      const errors: Array<{ file: string; error: string }> = [];
      for (const f of changed) {
        try {
          const parsed = await driveDownloadJson<DriveMemoFile>(tokenProvider, f.id);
          mutate((s) => {
            upsertMemoFromDrive(s, parsed, f.id);
          });
          imported++;
        } catch (e) {
          errors.push({ file: f.name ?? f.id ?? "", error: String(e) });
        }
      }
      mutate((s) => {
        s.settings.last_drive_sync = nowIso();
      });
      return { ok: true, folderId, total: files.length, changed: changed.length, imported, errors };
    },
    /** 전체 가져오기: memo 폴더의 모든 메모 파일을 로컬로 복원한다 (마이그레이션 경로). */
    importAll: async (dryRun = false) => {
      const folderId = await driveEnsureMemoFolder(tokenProvider);
      if (!folderId) throw new Error("drive_folder_failed");
      const files = await driveListMemoFiles(tokenProvider, folderId);
      if (dryRun) return { folderId, total: files.length, files };
      let imported = 0;
      const errors: Array<{ file: string; error: string }> = [];
      for (const f of files) {
        try {
          const parsed = await driveDownloadJson<DriveMemoFile>(tokenProvider, f.id);
          mutate((s) => {
            upsertMemoFromDrive(s, parsed, f.id);
          });
          imported++;
        } catch (e) {
          errors.push({ file: f.name ?? f.id ?? "", error: String(e) });
        }
      }
      return { ok: true, folderId, total: files.length, imported, errors };
    },
    /** 메모 1개를 Drive memo 폴더 파일로 올린다 (1메모=1파일). 수동 저장이다. */
    pushMemo: async (memoId: string) => {
      const state = loadState();
      const memo = state.memos.find((m) => m.id === memoId);
      if (!memo) throw new Error("not_found");
      const folderId = await driveEnsureMemoFolder(tokenProvider);
      if (!folderId) throw new Error("drive_folder_failed");
      const driveFileId = await driveUploadMemoJson(
        tokenProvider,
        folderId,
        `${memo.id}.json`,
        JSON.stringify(memoToDriveFile(memo)),
        memo.driveFileId,
      );
      if (driveFileId) {
        mutate((s) => {
          const m = s.memos.find((x) => x.id === memoId);
          if (m) m.driveFileId = driveFileId;
        });
      }
      return { ok: true, driveFileId };
    },
  },

  attachments: {
    /**
     * 첨부 업로드: R2 대신 Drive memo 폴더에 올린다. 반환 url은 Drive 보기 링크다.
     * 오프라인·토큰 없음 상태에서는 올릴 수 없다.
     */
    upload: async (memoId: string, file: File) => {
      const memo = loadState().memos.find((m) => m.id === memoId);
      if (!memo) throw new Error("not_found");
      const folderId = await driveEnsureMemoFolder(tokenProvider);
      if (!folderId) throw new Error("drive_folder_failed");
      const uploaded = await driveUploadAttachment(tokenProvider, folderId, file);
      const id = uid();
      mutate((state) => {
        state.attachments.push({
          id,
          memoId,
          driveFileId: uploaded.id,
          url: uploaded.webViewLink,
          mime: file.type || "",
          size: file.size,
        });
      });
      return { id, url: uploaded.webViewLink };
    },

    /** 첨부 1건 조회: 사진·음성 블록이 다시 열릴 때 Drive 링크를 보여주기 위해. */
    get: async (id: string) => {
      const att = loadState().attachments.find((a) => a.id === id);
      if (!att) throw new Error("not_found");
      return { id: att.id, url: att.url, mime: att.mime, size: att.size };
    },
  },

  analytics: {
    summary: async (): Promise<AnalyticsSummary> => analyticsSummary(loadState()),
    prompt: async (minLinks = 2) => analyticsPrompt(loadState(), minLinks),
  },

  /**
   * Pages-only에서 지원하지 않는 것들. 호출하면 UnsupportedInPagesOnlyError를 던진다.
   *  - 백그라운드 동기화 (크론): 브라우저가 닫히면 동작하지 않는다. 수동 동기화(drive.sync)를 쓴다.
   *  - 실시간 알림/푸시: 서버가 없어 보낼 주체가 없다.
   *  - 서버 측 AI 온톨로지 계산: 키워드 추출·그래프 계산·왕복 미리보기/적용은
   *    브라우저 로컬에서 규칙 기반으로 처리한다 (위 ontology.* 참조).
   *    AI 분석 자체는 analytics.prompt로 만든 프롬프트를 사용자가 직접
   *    AI에 붙여넣는 왕복 방식이다.
   */
  unsupported: {
    backgroundSync: (): never => {
      throw new UnsupportedInPagesOnlyError("백그라운드 동기화(크론) — 수동 동기화(drive.sync)를 사용하세요.");
    },
    realtimeNotifications: (): never => {
      throw new UnsupportedInPagesOnlyError("실시간 알림/푸시 — Pages-only에서 서버가 없어 지원하지 않습니다.");
    },
  },
};

export type ApiClient = typeof api;

/** 개발용: 로컬 저장소를 통째로 비운다. (기존 사용자 데이터가 있을 때 함부로 쓰지 않는다.) */
export function resetLocalStoreForDevelopment(): void {
  localStorage.setItem("naite.local.v1", JSON.stringify(emptyState()));
}
