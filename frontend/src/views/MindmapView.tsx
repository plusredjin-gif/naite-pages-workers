/**
 * 나이테 Pages-only — 마인드맵 뷰
 *
 * 처음엔 카테고리 노드만 보여주고, 노드를 누르면 하위 카테고리·메모 노드를
 * 펼친다. 메모가 10개 넘으면 "메모 N개" 묶음 노드로 묶고, 묶음을 누르면
 * 개별 메모 노드(최대 30개)로 펼친다. 데이터는 api.categories.list와
 * api.memos.list에서만 가져온다 (목업·가짜 데이터 없음).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Category, type MemoPreview } from "../api";
import { Teapot } from "../components/Logo";
import { LineIcon } from "../components/LineIcon";
import "./MindmapView.css";

type MmNode = {
  id: string;
  label: string;
  kind: "category" | "memo" | "bundle";
  depth: number;
  parentId: string | null;
  categoryId: string | null;
  memoId: string | null;
  count: number;
  hasChildren: boolean;
};

const NODE_W = 200;
const NODE_H = 40;
const COL_W = 230;
const ROW_H = 64;
const MEMO_INLINE_LIMIT = 10;
const BUNDLE_EXPAND_LIMIT = 30;
const MEMO_LOAD_LIMIT = 100;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function isTokenExpired(e: unknown): boolean {
  return (e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED";
}

export function MindmapView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
}) {
  const { onOpen, setNotice } = props;
  const [roots, setRoots] = useState<MmNode[]>([]);
  const [byId, setById] = useState<Map<string, MmNode>>(new Map());
  const [childrenOf, setChildrenOf] = useState<Map<string, MmNode[]>>(new Map());
  const [fullOrder, setFullOrder] = useState<MmNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalMemos, setTotalMemos] = useState(0);
  const [overLimitNote, setOverLimitNote] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showMinimap, setShowMinimap] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const nodeRefs = useRef<Map<string, SVGGElement | null>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, memos] = await Promise.all([
        api.categories.list(),
        api.memos.list({ limit: MEMO_LOAD_LIMIT }),
      ]);
      setTotalMemos(memos.total);
      if (memos.total > MEMO_LOAD_LIMIT) {
        setOverLimitNote(`메모가 ${memos.total}개로 많아 최근 ${MEMO_LOAD_LIMIT}개까지만 마인드맵에 표시합니다.`);
      } else {
        setOverLimitNote(null);
      }
      const built = buildTree(cats.categories, memos.memos);
      setRoots(built.roots);
      setById(built.byId);
      setChildrenOf(built.children);
      setFullOrder(built.fullOrder);
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setError(`마인드맵을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightId) return;
    const el = nodeRefs.current.get(highlightId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [highlightId, expanded]);

  /** 펼친 노드만 따라가며 화면에 보일 노드 목록(DFS 순서)을 만든다. */
  const visible: Array<{ node: MmNode; x: number; y: number }> = [];
  {
    let row = 0;
    const walk = (node: MmNode) => {
      visible.push({ node, x: node.depth * COL_W + 16, y: row * ROW_H + 24 });
      row += 1;
      if (expanded.has(node.id)) {
        for (const child of childrenOf.get(node.id) ?? []) walk(child);
      }
    };
    for (const r of roots) walk(r);
  }

  const maxDepth = visible.reduce((acc, v) => Math.max(acc, v.node.depth), 0);
  const svgW = (maxDepth + 1) * COL_W + NODE_W + 32;
  const svgH = Math.max(visible.length * ROW_H + 48, 120);
  const posById = new Map(visible.map((v) => [v.node.id, v]));
  const showMinimapOption = visible.length >= 10 || svgW > 800 || svgH > 600;

  function toggleNode(node: MmNode) {
    if (node.kind === "memo") {
      if (node.memoId) onOpen(node.memoId);
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function handleSearch() {
    const q = search.trim().toLowerCase();
    if (!q) {
      setSearchMsg("검색어를 입력하세요.");
      return;
    }
    const found = fullOrder.find((n) => n.label.toLowerCase().includes(q));
    if (!found) {
      setSearchMsg(`"${search.trim()}"에 맞는 노드가 없습니다.`);
      setHighlightId(null);
      return;
    }
    setSearchMsg(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur: MmNode | undefined = found;
      while (cur && cur.parentId) {
        next.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
      return next;
    });
    setHighlightId(found.id);
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  }

  function handleCenter() {
    setZoom(1);
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ left: Math.max(0, (el.scrollWidth - el.clientWidth) / 2), top: 0, behavior: "smooth" });
    }
  }

  if (loading) {
    return (
      <div>
        <h2>마인드맵</h2>
        <p className="meta">불러오는 중…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2>마인드맵</h2>
        <p className="notice">{error}</p>
        <button onClick={() => void load()}>다시 불러오기</button>
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div>
        <h2>마인드맵</h2>
        <div className="empty-state">
          <Teapot />
          <p>아직 카테고리도 메모도 없습니다. 메모를 만들면 이곳에 마인드맵으로 펼쳐집니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>마인드맵</h2>
      <div className="graph-tools">
        <button onClick={handleZoomOut} aria-label="축소">−</button>
        <span className="meta">{Math.round(zoom * 100)}%</span>
        <button onClick={handleZoomIn} aria-label="확대">+</button>
        <button onClick={() => setZoom(1)}>100%</button>
        <button onClick={handleCenter}>가운데</button>
        {showMinimapOption ? (
          <button onClick={() => setShowMinimap((v) => !v)} aria-pressed={showMinimap}>
            미니맵 {showMinimap ? "끄기" : "켜기"}
          </button>
        ) : null}
        <input
          type="search"
          placeholder="노드 검색 (카테고리·메모)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
        />
        <button onClick={handleSearch}>검색</button>
      </div>
      {searchMsg ? <p className="meta">{searchMsg}</p> : null}
      {overLimitNote ? <p className="meta">{overLimitNote}</p> : null}
      <p className="meta">
        메모 {totalMemos}개 · 노드를 누르면 펼치고, 메모 노드를 누르면 편집기가 열립니다.
      </p>
      <div className="graph-wrap" ref={scrollRef}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: svgW, height: svgH }}>
          <svg width={svgW} height={svgH} role="tree" aria-label="메모 마인드맵">
            {visible.map(({ node }) => {
              if (!node.parentId) return null;
              const parent = posById.get(node.parentId);
              const child = posById.get(node.id);
              if (!parent || !child) return null;
              const x1 = parent.x + NODE_W;
              const y1 = parent.y + NODE_H / 2;
              const x2 = child.x;
              const y2 = child.y + NODE_H / 2;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={`edge-${node.id}`}
                  d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                  fill="none"
                  stroke="#c9c2b0"
                  strokeWidth={1.5}
                />
              );
            })}
            {visible.map(({ node, x, y }) => {
              const isHighlight = highlightId === node.id;
              const fill = node.kind === "memo" ? "#fdf6e3" : node.kind === "bundle" ? "#f0ede4" : "#ffffff";
              const stroke = isHighlight ? "#c2571b" : node.kind === "bundle" ? "#8a8a8a" : "#b98a4e";
              const expandMark = node.hasChildren ? (expanded.has(node.id) ? "▾ " : "▸ ") : "";
              const iconName = node.kind === "memo" ? "pen" : node.kind === "bundle" ? "folder" : "tag";
              return (
                <g
                  key={node.id}
                  ref={(el) => {
                    nodeRefs.current.set(node.id, el);
                  }}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => toggleNode(node)}
                  style={{ cursor: "pointer" }}
                  role="treeitem"
                  aria-label={node.label}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isHighlight ? 3 : 1.5}
                    strokeDasharray={node.kind === "bundle" ? "5 3" : undefined}
                  />
                  <g transform="translate(10, 9)">
                    <LineIcon name={iconName} size={14} />
                  </g>
                  <text x={30} y={24} fontSize={13} fill="#222">
                    {truncate(`${expandMark}${node.label}`, 18)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {showMinimapOption && showMinimap ? (
        <div className="card">
          <h3>미니맵</h3>
          <p className="meta">전체 구조 ({visible.length}개 노드) — 주황색 테두리가 검색으로 찾은 노드입니다.</p>
          <svg
            width="100%"
            height={140}
            viewBox={`0 0 ${svgW} ${svgH}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="마인드맵 미니맵"
          >
            {visible.map(({ node }) => {
              if (!node.parentId) return null;
              const parent = posById.get(node.parentId);
              const child = posById.get(node.id);
              if (!parent || !child) return null;
              return (
                <line
                  key={`mm-edge-${node.id}`}
                  x1={parent.x + NODE_W / 2}
                  y1={parent.y + NODE_H / 2}
                  x2={child.x + NODE_W / 2}
                  y2={child.y + NODE_H / 2}
                  stroke="#d8d2c2"
                  strokeWidth={2}
                />
              );
            })}
            {visible.map(({ node, x, y }) => (
              <rect
                key={`mm-${node.id}`}
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={node.kind === "memo" ? "#e8dcc0" : "#cbb98a"}
                stroke={highlightId === node.id ? "#c2571b" : "none"}
                strokeWidth={6}
              />
            ))}
          </svg>
        </div>
      ) : null}
    </div>
  );
}

/** 카테고리·메모 목록을 노드 트리로 만든다 (접힌 노드까지 전부). */
function buildTree(
  categories: Category[],
  memos: MemoPreview[],
): {
  roots: MmNode[];
  byId: Map<string, MmNode>;
  children: Map<string, MmNode[]>;
  fullOrder: MmNode[];
} {
  const byId = new Map<string, MmNode>();
  const children = new Map<string, MmNode[]>();
  const fullOrder: MmNode[] = [];
  const memosByCat = new Map<string | null, MemoPreview[]>();
  for (const m of memos) {
    const key = m.categoryId ?? null;
    const arr = memosByCat.get(key) ?? [];
    arr.push(m);
    memosByCat.set(key, arr);
  }
  const catsByParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId ?? null;
    const arr = catsByParent.get(key) ?? [];
    arr.push(c);
    catsByParent.set(key, arr);
  }
  for (const arr of catsByParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  for (const arr of memosByCat.values()) arr.sort((a, b) => (a.title || "(제목 없음)").localeCompare(b.title || "(제목 없음)", "ko"));

  const register = (node: MmNode) => {
    byId.set(node.id, node);
    fullOrder.push(node);
  };

  /** 카테고리 노드 하나의 자식(하위 카테고리 + 메모/묶음)을 만든다. */
  const buildChildren = (catKey: string | null, nodeId: string, depth: number): MmNode[] => {
    const list: MmNode[] = [];
    for (const sub of catsByParent.get(catKey) ?? []) {
      const subNode: MmNode = {
        id: `cat:${sub.id}`,
        label: sub.name,
        kind: "category",
        depth: depth + 1,
        parentId: nodeId,
        categoryId: sub.id,
        memoId: null,
        count: 0,
        hasChildren: true,
      };
      register(subNode);
      list.push(subNode);
      children.set(subNode.id, buildChildren(sub.id, subNode.id, depth + 1));
    }
    const catMemos = memosByCat.get(catKey) ?? [];
    if (catMemos.length > 0 && catMemos.length <= MEMO_INLINE_LIMIT) {
      for (const m of catMemos) {
        const memoNode: MmNode = {
          id: `memo:${m.id}`,
          label: m.title || "(제목 없음)",
          kind: "memo",
          depth: depth + 1,
          parentId: nodeId,
          categoryId: catKey,
          memoId: m.id,
          count: 0,
          hasChildren: false,
        };
        register(memoNode);
        list.push(memoNode);
      }
    } else if (catMemos.length > MEMO_INLINE_LIMIT) {
      const bundleId = `bundle:${catKey ?? "uncat"}`;
      const bundle: MmNode = {
        id: bundleId,
        label: `메모 ${catMemos.length}개`,
        kind: "bundle",
        depth: depth + 1,
        parentId: nodeId,
        categoryId: catKey,
        memoId: null,
        count: catMemos.length,
        hasChildren: true,
      };
      register(bundle);
      list.push(bundle);
      const shown = catMemos.slice(0, BUNDLE_EXPAND_LIMIT);
      children.set(
        bundleId,
        shown.map((m) => {
          const memoNode: MmNode = {
            id: `memo:${m.id}`,
            label: m.title || "(제목 없음)",
            kind: "memo",
            depth: depth + 2,
            parentId: bundleId,
            categoryId: catKey,
            memoId: m.id,
            count: 0,
            hasChildren: false,
          };
          register(memoNode);
          return memoNode;
        }),
      );
      if (catMemos.length > BUNDLE_EXPAND_LIMIT) {
        // 남은 메모는 안내 문구로 알린다 (노드로 만들지 않음).
        bundle.label = `메모 ${catMemos.length}개 (먼저 ${BUNDLE_EXPAND_LIMIT}개만 표시)`;
      }
    }
    return list;
  };

  const roots: MmNode[] = [];
  for (const top of catsByParent.get(null) ?? []) {
    const node: MmNode = {
      id: `cat:${top.id}`,
      label: top.name,
      kind: "category",
      depth: 0,
      parentId: null,
      categoryId: top.id,
      memoId: null,
      count: 0,
      hasChildren: true,
    };
    register(node);
    roots.push(node);
    children.set(node.id, buildChildren(top.id, node.id, 0));
  }
  const uncatMemos = memosByCat.get(null) ?? [];
  if (uncatMemos.length > 0) {
    const node: MmNode = {
      id: "cat:uncat",
      label: "미분류",
      kind: "category",
      depth: 0,
      parentId: null,
      categoryId: null,
      memoId: null,
      count: 0,
      hasChildren: true,
    };
    register(node);
    roots.push(node);
    children.set(node.id, buildChildren(null, node.id, 0));
  }
  return { roots, byId, children, fullOrder };
}
