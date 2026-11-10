/**
 * 나이테 Pages-only — 아웃라인 보기
 *
 * 기능: 카테고리 트리(하위 포함)를 접힌 상태로 보여주고, 누르면 펼친다.
 * 펼친 카테고리의 메모는 api.memos.list({categoryId, limit: 20, offset})으로
 * 20개씩, "메모 더 보기: N개 남음" 버튼으로 이어서 불러온다. 미분류 메모
 * 섹션도 있다. 검색창에 입력하면 api.memos.list({search})로 찾아 해당
 * 메모가 있는 경로만 펼쳐서 보여준다.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type Category, type MemoPreview } from "../api";
import { Teapot } from "../components/Logo";
import { LineIcon, RoundIcon, categoryIconFor } from "../components/LineIcon";
import "./OutlineView.css";

const PAGE_SIZE = 20;
const SEARCH_LIMIT = 100;
const UNCATEGORIZED_PAGE = 100;

type CatMemoState = {
  memos: MemoPreview[];
  total: number;
  loaded: boolean;
  loading: boolean;
};

function emptyCatMemo(): CatMemoState {
  return { memos: [], total: 0, loaded: false, loading: false };
}

/** parentId → 자식 목록. */
function buildChildren(cats: Category[]): Map<string | null, Category[]> {
  const map = new Map<string | null, Category[]>();
  for (const c of cats) {
    const key = c.parentId ?? null;
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return map;
}

/** 해당 카테고리부터 루트까지의 조상 id 목록 (자기 자신 포함). */
function ancestorChain(cats: Category[], id: string): string[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const chain: string[] = [];
  let cur: Category | undefined = byId.get(id);
  while (cur) {
    chain.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

export function OutlineView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
}) {
  const { onOpen, setNotice } = props;
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [catMemos, setCatMemos] = useState<Record<string, CatMemoState>>({});
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<MemoPreview[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);

  // 미분류 섹션
  const [uncExpanded, setUncExpanded] = useState(false);
  const [uncMemos, setUncMemos] = useState<MemoPreview[]>([]);
  const [uncOffset, setUncOffset] = useState(0);
  const [uncDone, setUncDone] = useState(false);
  const [uncLoading, setUncLoading] = useState(false);

  const searching = search.trim() !== "";

  const handleApiError = useCallback(
    (e: unknown, fallback: string) => {
      if ((e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED") {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setError(`${fallback}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [setNotice],
  );

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.categories.list();
      setCategories(res.categories);
    } catch (e) {
      handleApiError(e, "카테고리를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [handleApiError]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  /** 카테고리 메모를 offset부터 불러와 이어붙인다. */
  const loadCategoryMemos = useCallback(
    async (categoryId: string, offset: number) => {
      setCatMemos((prev) => ({
        ...prev,
        [categoryId]: { ...(prev[categoryId] ?? emptyCatMemo()), loading: true },
      }));
      try {
        const res = await api.memos.list({ categoryId, limit: PAGE_SIZE, offset });
        setCatMemos((prev) => {
          const prevEntry = prev[categoryId] ?? emptyCatMemo();
          return {
            ...prev,
            [categoryId]: {
              memos: offset === 0 ? res.memos : [...prevEntry.memos, ...res.memos],
              total: res.total,
              loaded: true,
              loading: false,
            },
          };
        });
      } catch (e) {
        setCatMemos((prev) => ({
          ...prev,
          [categoryId]: { ...(prev[categoryId] ?? emptyCatMemo()), loading: false },
        }));
        handleApiError(e, "메모를 불러오지 못했습니다");
      }
    },
    [handleApiError],
  );

  /** 미분류 메모를 100개씩 훑어 categoryId가 null인 것만 모은다. */
  const loadUncategorized = useCallback(async () => {
    setUncLoading(true);
    try {
      const res = await api.memos.list({ limit: UNCATEGORIZED_PAGE, offset: uncOffset });
      setUncMemos((prev) => [
        ...prev,
        ...res.memos.filter((m) => m.categoryId === null),
      ]);
      const nextOffset = uncOffset + UNCATEGORIZED_PAGE;
      setUncOffset(nextOffset);
      setUncDone(nextOffset >= res.total);
    } catch (e) {
      handleApiError(e, "미분류 메모를 불러오지 못했습니다");
    } finally {
      setUncLoading(false);
    }
  }, [uncOffset, handleApiError]);

  // 검색: 입력이 멈추면 api.memos.list({search})로 찾고, 매치가 있는 경로만 펼친다.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      setSearchTotal(0);
      setExpanded(new Set());
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      api
        .memos.list({ search: q, limit: SEARCH_LIMIT })
        .then((res) => {
          setSearchResults(res.memos);
          setSearchTotal(res.total);
          const visible = new Set<string>();
          for (const m of res.memos) {
            if (m.categoryId) {
              for (const id of ancestorChain(categories, m.categoryId)) visible.add(id);
            }
          }
          setExpanded(visible);
          setUncExpanded(res.memos.some((m) => m.categoryId === null));
        })
        .catch((e: unknown) => {
          if ((e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED") {
            setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
          } else {
            setError(`검색하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
          }
        })
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, categories, setNotice]);

  function toggleCategory(cat: Category) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat.id)) {
        next.delete(cat.id);
      } else {
        next.add(cat.id);
        const entry = catMemos[cat.id];
        if (!entry?.loaded && !entry?.loading) {
          void loadCategoryMemos(cat.id, 0);
        }
      }
      return next;
    });
  }

  function toggleUncategorized() {
    setUncExpanded((prev) => {
      if (!prev && uncMemos.length === 0 && !uncDone) {
        void loadUncategorized();
      }
      return !prev;
    });
  }

  const childrenMap = buildChildren(categories);
  const roots = childrenMap.get(null) ?? [];

  // 검색 모드: 검색 결과만 카테고리별로 묶는다.
  const searchByCategory = new Map<string | null, MemoPreview[]>();
  if (searchResults) {
    for (const m of searchResults) {
      const key = m.categoryId ?? null;
      const arr = searchByCategory.get(key) ?? [];
      arr.push(m);
      searchByCategory.set(key, arr);
    }
  }
  const searchVisible = new Set<string>();
  if (searchResults) {
    for (const m of searchResults) {
      if (m.categoryId) {
        for (const id of ancestorChain(categories, m.categoryId)) searchVisible.add(id);
      }
    }
  }

  function renderMemoList(memos: MemoPreview[]): ReactNode {
    return (
      <ul className="memo-list outline-memo-list">
        {memos.map((m) => (
          <li key={m.id}>
            <button className="memo-item" onClick={() => onOpen(m.id)}>
              <span className="memo-title">
                {m.pinned === 1 ? (
                  <span className="pin-mark" title="고정됨">
                    <LineIcon name="pin" size={13} />
                  </span>
                ) : null}
                {m.title || "(제목 없음)"}
              </span>
              <span className="memo-preview">{m.preview ?? ""}</span>
              <span className="memo-date">
                {new Date(m.updatedAt).toLocaleDateString("ko-KR")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  function renderCategory(cat: Category, depth: number): ReactNode {
    // 검색 모드에서는 매치가 있는 경로의 카테고리만 보여준다.
    if (searching && !searchVisible.has(cat.id)) return null;
    const isOpen = expanded.has(cat.id);
    const children = childrenMap.get(cat.id) ?? [];
    const entry = catMemos[cat.id];
    const searchMemos = searchResults ? searchByCategory.get(cat.id) ?? [] : null;
    const memos = searching ? searchMemos ?? [] : entry?.memos ?? [];
    const remaining = searching ? 0 : (entry?.total ?? 0) - memos.length;
    return (
      <div key={cat.id} className="outline-node" style={{ marginLeft: depth * 16 }}>
        <button
          type="button"
          className="outline-toggle"
          onClick={() => {
            if (!searching) toggleCategory(cat);
          }}
          aria-expanded={isOpen}
        >
          <span className="outline-arrow">{isOpen ? "▾" : "▸"}</span>
          <span className="cat-dot" style={{ backgroundColor: cat.color ?? "#cccccc" }} />
          <RoundIcon name={categoryIconFor(cat.icon)} />
          <span className="outline-cat-name">{cat.name}</span>
        </button>
        {isOpen ? (
          <div className="outline-body">
            {!searching && entry?.loading && memos.length === 0 ? (
              <p className="meta">불러오는 중…</p>
            ) : null}
            {!searching && entry?.loaded && memos.length === 0 && children.length === 0 ? (
              <p className="meta">메모가 없습니다.</p>
            ) : null}
            {memos.length > 0 ? renderMemoList(memos) : null}
            {!searching && remaining > 0 ? (
              <button
                type="button"
                className="outline-more"
                disabled={entry?.loading}
                onClick={() => void loadCategoryMemos(cat.id, memos.length)}
              >
                메모 더 보기: {remaining}개 남음
              </button>
            ) : null}
            {children.map((ch) => renderCategory(ch, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  const uncSearchMemos = searchResults
    ? searchByCategory.get(null) ?? []
    : null;
  const showUncategorized =
    !searching || (uncSearchMemos !== null && uncSearchMemos.length > 0);

  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="메모 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="메모 검색"
        />
      </div>
      {error ? <p className="notice">{error}</p> : null}
      {loading ? <p className="meta">불러오는 중…</p> : null}
      {searchLoading ? <p className="meta">검색 중…</p> : null}
      {searching && searchResults !== null && !searchLoading ? (
        <p className="meta">
          검색 결과 {searchTotal}개
          {searchTotal > SEARCH_LIMIT ? ` (최대 ${SEARCH_LIMIT}개까지 표시)` : ""}
        </p>
      ) : null}
      {!loading && !searching && categories.length === 0 && !error ? (
        <div className="empty-state">
          <Teapot expression="cheer" />
          <p>카테고리가 없습니다. 카테고리를 만들어 메모를 정리해보세요.</p>
        </div>
      ) : null}
      {searching && searchResults !== null && searchResults.length === 0 && !searchLoading ? (
        <div className="empty-state">
          <Teapot expression="cheer" />
          <p>“{search.trim()}”에 맞는 메모가 없습니다.</p>
        </div>
      ) : null}
      <div className="outline-tree">
        {roots.map((c) => renderCategory(c, 0))}
      </div>
      {showUncategorized ? (
        <div className="outline-node outline-uncategorized">
          <button
            type="button"
            className="outline-toggle"
            onClick={() => {
              if (!searching) toggleUncategorized();
            }}
            aria-expanded={uncExpanded}
          >
            <span className="outline-arrow">{uncExpanded ? "▾" : "▸"}</span>
            <RoundIcon name="inbox" />
            <span className="outline-cat-name">미분류</span>
          </button>
          {uncExpanded ? (
            <div className="outline-body">
              {searching ? (
                renderMemoList(uncSearchMemos ?? [])
              ) : (
                <>
                  {uncLoading && uncMemos.length === 0 ? (
                    <p className="meta">불러오는 중…</p>
                  ) : null}
                  {!uncLoading && uncMemos.length === 0 ? (
                    <p className="meta">미분류 메모가 없습니다.</p>
                  ) : null}
                  {uncMemos.length > 0 ? renderMemoList(uncMemos) : null}
                  {!uncDone && uncMemos.length > 0 ? (
                    <button
                      type="button"
                      className="outline-more"
                      disabled={uncLoading}
                      onClick={() => void loadUncategorized()}
                    >
                      미분류 메모 더 보기
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
