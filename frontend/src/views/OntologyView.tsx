/**
 * 나이테 Pages-only — 온톨로지 뷰
 *
 * 키워드 하나가 여러 상위·여러 관련을 가질 수 있는 다대다 그래프.
 * api.ontology.graph()로 전체 그래프를 그리고, 신장 포리스트
 * (루트=상위가 없는 키워드에서 BFS) 배치 + 나머지 간선은 점선으로 표시한다.
 * 키워드 관리(생성·이름 변경·삭제·상위/관련·잠금)는 api.keywords.* 로 한다.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type OntologyGraph } from "../api";
import { Teapot } from "../components/Logo";
import "./OntologyView.css";

type NodeKind = "keyword" | "person" | "place" | "location";
type GNode = { id: string; rawId: string; label: string; kind: NodeKind };
type GEdge = { from: string; to: string; kind: "parent" | "related"; locked: number };
type MemoItem = { id: string; title: string };

const NODE_W = 150;
const NODE_H = 36;
const COL_W = 190;
const ROW_H = 52;

const KIND_LABEL: Record<NodeKind, string> = {
  keyword: "키워드",
  person: "사람",
  place: "장소",
  location: "위치",
};

const KIND_FILL: Record<NodeKind, string> = {
  keyword: "#ffffff",
  person: "#e8f0fe",
  place: "#e8f5e9",
  location: "#f3e8fd",
};

const KIND_STROKE: Record<NodeKind, string> = {
  keyword: "#b98a4e",
  person: "#5a7ab8",
  place: "#5a8a5a",
  location: "#8a5ab8",
};

function isTokenExpired(e: unknown): boolean {
  return (e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED";
}

export function OntologyView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
}) {
  const { onOpen, setNotice } = props;
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [kwNames, setKwNames] = useState<Array<{ id: string; name: string }>>([]);
  const [kwParents, setKwParents] = useState<Array<{ keywordId: string; parentId: string; locked: number }>>([]);
  const [kwLinks, setKwLinks] = useState<Array<{ keywordId: string; relatedId: string; locked: number }>>([]);
  const [entityMemos, setEntityMemos] = useState<Record<string, MemoItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showKind, setShowKind] = useState<Record<NodeKind, boolean>>({
    keyword: true,
    person: true,
    place: true,
    location: true,
  });
  const [showRel, setShowRel] = useState<{ parent: boolean; related: boolean }>({
    parent: true,
    related: true,
  });
  const [centerId, setCenterId] = useState("");
  const [depth, setDepth] = useState<1 | 2>(1);

  const [selected, setSelected] = useState<GNode | null>(null);
  const [selectedMemos, setSelectedMemos] = useState<MemoItem[] | null>(null);
  const [memosLoading, setMemosLoading] = useState(false);
  const [memosError, setMemosError] = useState<string | null>(null);

  // 키워드 관리
  const [manageId, setManageId] = useState("");
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [addParentId, setAddParentId] = useState("");
  const [addRelatedId, setAddRelatedId] = useState("");
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageBusy, setManageBusy] = useState(false);

  const loadGraphData = useCallback(async () => {
    const [g, kw] = await Promise.all([api.ontology.graph(), api.keywords.list()]);
    setGraph(g);
    setKwNames(kw.keywords);
    setKwParents(kw.parents);
    setKwLinks(kw.links);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadGraphData();
      // 사람·장소·위치 노드의 메모 연결은 최근 메모 50개의 상세에서 모은다.
      try {
        const list = await api.memos.list({ limit: 50 });
        const details = await Promise.all(list.memos.map((m) => api.memos.get(m.id).catch(() => null)));
        const map: Record<string, MemoItem[]> = {};
        const push = (key: string, memo: MemoItem) => {
          const arr = map[key] ?? [];
          if (!arr.some((x) => x.id === memo.id)) arr.push(memo);
          map[key] = arr;
        };
        for (const d of details) {
          if (!d) continue;
          const memo = { id: d.id, title: d.title || "(제목 없음)" };
          for (const p of d.people) push(`person:${p.id}`, memo);
          for (const p of d.places) push(`place:${p.id}`, memo);
          for (const p of d.locations) push(`location:${p.id}`, memo);
        }
        setEntityMemos(map);
      } catch {
        // 사람·장소·위치 메모 연결을 못 모으면 키워드 메모 보기만 동작한다.
        setEntityMemos({});
      }
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setError(`온톨로지를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [loadGraphData, setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- 그래프 노드·간선 구성 ----
  const allNodes: GNode[] = graph
    ? [
        ...graph.keywords.map((k) => ({ id: `keyword:${k.id}`, rawId: k.id, label: k.name, kind: "keyword" as NodeKind })),
        ...graph.people.map((p) => ({ id: `person:${p.id}`, rawId: p.id, label: p.name, kind: "person" as NodeKind })),
        ...graph.places.map((p) => ({ id: `place:${p.id}`, rawId: p.id, label: p.name, kind: "place" as NodeKind })),
        ...graph.locations.map((p) => ({ id: `location:${p.id}`, rawId: p.id, label: p.name, kind: "location" as NodeKind })),
      ]
    : [];
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const allEdges: GEdge[] = graph
    ? [
        ...graph.parentEdges.map((e) => ({ from: `keyword:${e.fromId}`, to: `keyword:${e.toId}`, kind: "parent" as const, locked: e.locked })),
        ...dedupeRelated(graph.relatedEdges.map((e) => ({ from: `keyword:${e.fromId}`, to: `keyword:${e.toId}`, kind: "related" as const, locked: e.locked }))),
      ]
    : [];

  const typeFiltered = allNodes.filter((n) => showKind[n.kind]);
  const typeFilteredIds = new Set(typeFiltered.map((n) => n.id));
  const relFilteredEdges = allEdges.filter(
    (e) =>
      (e.kind === "parent" ? showRel.parent : showRel.related) &&
      typeFilteredIds.has(e.from) &&
      typeFilteredIds.has(e.to),
  );

  // 중심 노드 + N단계 이웃만 보기
  let visibleNodes = typeFiltered;
  let visibleEdges = relFilteredEdges;
  if (centerId && nodeById.has(centerId)) {
    const adjacency = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
      adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
    };
    for (const e of relFilteredEdges) link(e.from, e.to);
    const near = new Set<string>([centerId]);
    let frontier = [centerId];
    for (let d = 0; d < depth; d += 1) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of adjacency.get(cur) ?? []) {
          if (!near.has(nb)) {
            near.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    visibleNodes = typeFiltered.filter((n) => near.has(n.id));
    visibleEdges = relFilteredEdges.filter((e) => near.has(e.from) && near.has(e.to));
  }

  const layout = layoutGraph(visibleNodes, visibleEdges);
  const posById = layout.pos;

  // ---- 노드 클릭: 메모 보기 ----
  async function handleSelectNode(node: GNode) {
    setSelected(node);
    setSelectedMemos(null);
    setMemosError(null);
    setMemosLoading(true);
    try {
      if (node.kind === "keyword") {
        const memoIds = (graph?.memoKeywords ?? [])
          .filter((l) => l.keywordId === node.rawId)
          .map((l) => l.memoId)
          .slice(0, 20);
        const details = await Promise.all(memoIds.map((id) => api.memos.get(id).catch(() => null)));
        setSelectedMemos(
          details.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => ({ id: d.id, title: d.title || "(제목 없음)" })),
        );
      } else {
        setSelectedMemos((entityMemos[node.id] ?? []).slice(0, 20));
      }
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setMemosError(`메모를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setMemosLoading(false);
    }
  }

  // ---- 키워드 관리 ----
  async function runManage(fn: () => Promise<void>) {
    setManageError(null);
    setManageBusy(true);
    try {
      await fn();
      await loadGraphData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "cycle_rejected") {
        setManageError("순환 관계가 되어 추가할 수 없습니다. 상위를 거꾸로 걸면 안 됩니다.");
      } else if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setManageError(`키워드 관리 실패: ${msg}`);
      }
    } finally {
      setManageBusy(false);
    }
  }

  const manageKeyword = kwNames.find((k) => k.id === manageId) ?? null;
  const manageParents = kwParents.filter((e) => e.keywordId === manageId);
  const manageRelated = kwLinks.filter((e) => e.keywordId === manageId);
  const otherKeywords = kwNames.filter((k) => k.id !== manageId);

  if (loading) {
    return (
      <div>
        <h2>온톨로지</h2>
        <p className="meta">불러오는 중…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2>온톨로지</h2>
        <p className="notice">{error}</p>
        <button onClick={() => void load()}>다시 불러오기</button>
      </div>
    );
  }

  if (!graph || allNodes.length === 0) {
    return (
      <div>
        <h2>온톨로지</h2>
        <div className="empty-state">
          <Teapot />
          <p>아직 키워드가 없습니다. 아래에서 키워드를 만들면 이곳에 그래프가 그려집니다.</p>
        </div>
        <div id="keyword-manage">
      <KeywordManageCard
          kwNames={kwNames}
          manageId={manageId}
          setManageId={setManageId}
          newName={newName}
          setNewName={setNewName}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          addParentId={addParentId}
          setAddParentId={setAddParentId}
          addRelatedId={addRelatedId}
          setAddRelatedId={setAddRelatedId}
          manageError={manageError}
          manageBusy={manageBusy}
          manageKeyword={manageKeyword}
          manageParents={manageParents}
          manageRelated={manageRelated}
          otherKeywords={otherKeywords}
          runManage={runManage}
          onPickKeyword={(id, name) => {
            setManageId(id);
            setRenameValue(name);
          }}
        />
      </div>
      </div>
    );
  }

  const selectedParents = selected && selected.kind === "keyword"
    ? kwParents.filter((e) => e.keywordId === selected.rawId)
    : [];
  const selectedRelated = selected && selected.kind === "keyword"
    ? kwLinks.filter((e) => e.keywordId === selected.rawId)
    : [];

  return (
    <div>
      <h2>온톨로지</h2>
      <p className="meta">
        키워드 {graph.keywords.length}개 · 상위 {graph.parentEdges.length}개 · 관련 {graph.relatedEdges.length}개 · 사람{" "}
        {graph.people.length}명 · 장소 {graph.places.length}개 · 위치 {graph.locations.length}개
      </p>

      <div className="chip-row" role="group" aria-label="종류 필터">
        {(Object.keys(KIND_LABEL) as NodeKind[]).map((kind) => (
          <button
            key={kind}
            className={`chip${showKind[kind] ? " active" : ""}`}
            onClick={() => setShowKind((prev) => ({ ...prev, [kind]: !prev[kind] }))}
            aria-pressed={showKind[kind]}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
        <button
          className={`chip${showRel.parent ? " active" : ""}`}
          onClick={() => setShowRel((prev) => ({ ...prev, parent: !prev.parent }))}
          aria-pressed={showRel.parent}
        >
          상위 관계
        </button>
        <button
          className={`chip${showRel.related ? " active" : ""}`}
          onClick={() => setShowRel((prev) => ({ ...prev, related: !prev.related }))}
          aria-pressed={showRel.related}
        >
          관련 관계
        </button>
      </div>

      <div className="toolbar">
        <select
          value={centerId}
          onChange={(e) => setCenterId(e.target.value)}
          aria-label="중심 노드 선택"
        >
          <option value="">중심 노드 선택 (전체 보기)</option>
          {(Object.keys(KIND_LABEL) as NodeKind[]).map((kind) => {
            const group = allNodes.filter((n) => n.kind === kind);
            if (group.length === 0) return null;
            return (
              <optgroup key={kind} label={KIND_LABEL[kind]}>
                {group.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value === "2" ? 2 : 1)}
          disabled={!centerId}
          aria-label="이웃 깊이"
        >
          <option value={1}>1단계 이웃</option>
          <option value={2}>2단계 이웃</option>
        </select>
        {centerId ? <button onClick={() => setCenterId("")}>전체 보기</button> : null}
      </div>

      <div className="graph-wrap">
        <svg width={layout.width} height={layout.height} role="img" aria-label="온톨로지 그래프">
          {visibleEdges.map((e, i) => {
            const a = posById.get(e.from);
            const b = posById.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const isTree = layout.treeKeys.has(`${e.from}|${e.to}`);
            const dashed = e.kind === "related" || !isTree;
            return (
              <g key={`edge-${i}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={e.kind === "parent" ? "#8a7a5a" : "#7a9a6a"}
                  strokeWidth={isTree ? 2 : 1.5}
                  strokeDasharray={dashed ? "5 3" : undefined}
                />
                {e.locked === 1 ? (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize={11} textAnchor="middle">
                    🔒
                  </text>
                ) : null}
              </g>
            );
          })}
          {visibleNodes.map((n) => {
            const p = posById.get(n.id);
            if (!p) return null;
            const isSelected = selected?.id === n.id;
            const isCenter = centerId === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                onClick={() => void handleSelectNode(n)}
                style={{ cursor: "pointer" }}
                role="button"
                aria-label={`${KIND_LABEL[n.kind]} ${n.label}`}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={KIND_FILL[n.kind]}
                  stroke={isSelected || isCenter ? "#c2571b" : KIND_STROKE[n.kind]}
                  strokeWidth={isSelected || isCenter ? 3 : 1.5}
                />
                <text x={10} y={23} fontSize={13} fill="#222">
                  {n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="meta">
        실선은 신장 포리스트(상위 관계) 간선, 점선은 나머지 상위·관련 간선입니다. 🔒는 잠긴 간선입니다.
        노드를 누르면 아래에 연결된 메모가 나옵니다.
      </p>

      {selected ? (
        <div className="card">
          <h3>
            {KIND_LABEL[selected.kind]}: {selected.label}
          </h3>
          {selected.kind === "keyword" ? (
            <>
              <p className="meta">
                상위:{" "}
                {selectedParents.length > 0
                  ? selectedParents
                      .map((e) => kwNames.find((k) => k.id === e.parentId)?.name ?? e.parentId)
                      .join(", ")
                  : "없음"}
                {" · "}관련:{" "}
                {selectedRelated.length > 0
                  ? selectedRelated
                      .map((e) => kwNames.find((k) => k.id === e.relatedId)?.name ?? e.relatedId)
                      .join(", ")
                  : "없음"}
              </p>
            </>
          ) : (
            <p className="meta">메모 연결은 최근 메모 50개 기준으로 찾습니다.</p>
          )}
          <h4>이 노드의 메모 보기</h4>
          {memosLoading ? <p className="meta">메모를 불러오는 중…</p> : null}
          {memosError ? <p className="notice">{memosError}</p> : null}
          {!memosLoading && selectedMemos ? (
            selectedMemos.length === 0 ? (
              <p className="meta">연결된 메모가 없습니다.</p>
            ) : (
              <ul className="memo-list">
                {selectedMemos.map((m) => (
                  <li key={m.id}>
                    <button className="memo-item" onClick={() => onOpen(m.id)}>
                      <span className="memo-title">{m.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {selectedMemos && selectedMemos.length >= 20 ? (
            <p className="meta">최대 20개까지만 표시합니다.</p>
          ) : null}
        </div>
      ) : null}

      <div id="keyword-manage">
      <KeywordManageCard
        kwNames={kwNames}
        manageId={manageId}
        setManageId={setManageId}
        newName={newName}
        setNewName={setNewName}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        addParentId={addParentId}
        setAddParentId={setAddParentId}
        addRelatedId={addRelatedId}
        setAddRelatedId={setAddRelatedId}
        manageError={manageError}
        manageBusy={manageBusy}
        manageKeyword={manageKeyword}
        manageParents={manageParents}
        manageRelated={manageRelated}
        otherKeywords={otherKeywords}
        runManage={runManage}
        onPickKeyword={(id, name) => {
          setManageId(id);
          setRenameValue(name);
        }}
      />
      </div>
    </div>
  );
}

/** 관련 간선은 양방향으로 저장되므로 한 방향만 남긴다. */
function dedupeRelated(edges: GEdge[]): GEdge[] {
  const seen = new Set<string>();
  const out: GEdge[] = [];
  for (const e of edges) {
    const key = [e.from, e.to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * 신장 포리스트 배치: 루트(상위가 없는 키워드)에서 상위→하위 BFS로 깊이를
 * 정하고, 같은 깊이끼리 한 열에 놓는다. 사람·장소·위치는 종류별 열로 뒤에 둔다.
 */
function layoutGraph(
  nodes: GNode[],
  edges: GEdge[],
): { pos: Map<string, { x: number; y: number }>; width: number; height: number; treeKeys: Set<string> } {
  const pos = new Map<string, { x: number; y: number }>();
  const treeKeys = new Set<string>();
  const kwNodes = nodes.filter((n) => n.kind === "keyword");
  const parentEdges = edges.filter((e) => e.kind === "parent");
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set(parentEdges.map((e) => e.from));
  for (const e of parentEdges) {
    childrenOf.set(e.to, [...(childrenOf.get(e.to) ?? []), e.from]);
  }
  const kwIds = new Set(kwNodes.map((n) => n.id));
  const depth = new Map<string, number>();
  let maxDepth = -1;
  const bfs = (rootId: string, startDepth: number) => {
    const queue: Array<{ id: string; d: number }> = [{ id: rootId, d: startDepth }];
    depth.set(rootId, startDepth);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      maxDepth = Math.max(maxDepth, cur.d);
      for (const child of childrenOf.get(cur.id) ?? []) {
        if (!depth.has(child) && kwIds.has(child)) {
          depth.set(child, cur.d + 1);
          treeKeys.add(`${child}|${cur.id}`);
          queue.push({ id: child, d: cur.d + 1 });
        }
      }
    }
  };
  for (const n of kwNodes) if (!hasParent.has(n.id)) bfs(n.id, 0);
  for (const n of kwNodes) if (!depth.has(n.id)) bfs(n.id, maxDepth + 1);

  const columns: GNode[][] = [];
  const byDepth = new Map<number, GNode[]>();
  for (const n of kwNodes) {
    const d = depth.get(n.id) ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), n]);
  }
  for (let d = 0; d <= Math.max(0, maxDepth); d += 1) {
    const col = (byDepth.get(d) ?? []).sort((a, b) => a.label.localeCompare(b.label, "ko"));
    columns.push(col);
  }
  const entityKinds: NodeKind[] = ["person", "place", "location"];
  for (const kind of entityKinds) {
    const col = nodes.filter((n) => n.kind === kind).sort((a, b) => a.label.localeCompare(b.label, "ko"));
    if (col.length > 0) columns.push(col);
  }
  let maxRows = 0;
  columns.forEach((col, ci) => {
    maxRows = Math.max(maxRows, col.length);
    col.forEach((n, ri) => {
      pos.set(n.id, { x: ci * COL_W + 16, y: ri * ROW_H + 16 });
    });
  });
  const width = Math.max(1, columns.length) * COL_W + NODE_W + 32;
  const height = Math.max(1, maxRows) * ROW_H + 48;
  return { pos, width, height, treeKeys };
}

/** 키워드 관리 카드 (생성·이름 변경·삭제·상위·관련·잠금). */
function KeywordManageCard(props: {
  kwNames: Array<{ id: string; name: string }>;
  manageId: string;
  setManageId: (id: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  addParentId: string;
  setAddParentId: (id: string) => void;
  addRelatedId: string;
  setAddRelatedId: (id: string) => void;
  manageError: string | null;
  manageBusy: boolean;
  manageKeyword: { id: string; name: string } | null;
  manageParents: Array<{ keywordId: string; parentId: string; locked: number }>;
  manageRelated: Array<{ keywordId: string; relatedId: string; locked: number }>;
  otherKeywords: Array<{ id: string; name: string }>;
  runManage: (fn: () => Promise<void>) => Promise<void>;
  onPickKeyword: (id: string, name: string) => void;
}) {
  const {
    kwNames,
    manageId,
    setManageId,
    newName,
    setNewName,
    renameValue,
    setRenameValue,
    addParentId,
    setAddParentId,
    addRelatedId,
    setAddRelatedId,
    manageError,
    manageBusy,
    manageKeyword,
    manageParents,
    manageRelated,
    otherKeywords,
    runManage,
    onPickKeyword,
  } = props;

  const nameOf = (id: string) => kwNames.find((k) => k.id === id)?.name ?? id;

  return (
    <div className="card">
      <h3>키워드 관리</h3>
      <div className="toolbar">
        <input
          type="text"
          placeholder="새 키워드 이름"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              void runManage(async () => {
                await api.keywords.create(newName.trim());
                setNewName("");
              });
            }
          }}
        />
        <button
          disabled={!newName.trim() || manageBusy}
          onClick={() =>
            void runManage(async () => {
              await api.keywords.create(newName.trim());
              setNewName("");
            })
          }
        >
          키워드 만들기
        </button>
      </div>

      <div className="chip-row">
        {kwNames.map((k) => (
          <button
            key={k.id}
            className={`chip${manageId === k.id ? " active" : ""}`}
            onClick={() => onPickKeyword(k.id, k.name)}
          >
            {k.name}
          </button>
        ))}
        {kwNames.length === 0 ? <span className="meta">키워드가 없습니다.</span> : null}
      </div>

      {manageKeyword ? (
        <div>
          <div className="toolbar">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label="키워드 이름 변경"
            />
            <button
              disabled={!renameValue.trim() || renameValue.trim() === manageKeyword.name || manageBusy}
              onClick={() =>
                void runManage(async () => {
                  await api.keywords.rename(manageKeyword.id, renameValue.trim());
                })
              }
            >
              이름 변경
            </button>
            <button
              disabled={manageBusy}
              onClick={() => {
                if (window.confirm(`키워드 "${manageKeyword.name}"을(를) 삭제할까요? 상위·관련·메모 태그도 함께 지워집니다.`)) {
                  void runManage(async () => {
                    await api.keywords.remove(manageKeyword.id);
                    setManageId("");
                    setRenameValue("");
                  });
                }
              }}
            >
              삭제
            </button>
          </div>

          <h4>상위 키워드 (여러 개 가능)</h4>
          <div className="chip-row">
            {manageParents.map((e) => (
              <span key={`${e.keywordId}|${e.parentId}`} className="chip">
                {nameOf(e.parentId)}{" "}
                <button
                  className="lock-mark"
                  title={e.locked === 1 ? "잠김 — AI 가져오기가 건드리지 않음" : "잠기지 않음"}
                  onClick={() =>
                    void runManage(async () => {
                      await api.keywords.addParent(e.keywordId, e.parentId, e.locked === 0);
                    })
                  }
                  aria-label={`${nameOf(e.parentId)} 상위 잠금 토글`}
                >
                  {e.locked === 1 ? "🔒" : "🔓"}
                </button>
                <button
                  onClick={() =>
                    void runManage(async () => {
                      await api.keywords.removeParent(e.keywordId, e.parentId);
                    })
                  }
                  aria-label={`${nameOf(e.parentId)} 상위 빼기`}
                >
                  ✕
                </button>
              </span>
            ))}
            {manageParents.length === 0 ? <span className="meta">상위 없음</span> : null}
          </div>
          <div className="toolbar">
            <select value={addParentId} onChange={(e) => setAddParentId(e.target.value)} aria-label="상위로 걸 키워드">
              <option value="">상위로 걸 키워드 선택</option>
              {otherKeywords.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <button
              disabled={!addParentId || manageBusy}
              onClick={() =>
                void runManage(async () => {
                  await api.keywords.addParent(manageKeyword.id, addParentId, false);
                  setAddParentId("");
                })
              }
            >
              상위 걸기
            </button>
          </div>

          <h4>관련 키워드</h4>
          <div className="chip-row">
            {manageRelated.map((e) => (
              <span key={`${e.keywordId}|${e.relatedId}`} className="chip">
                {nameOf(e.relatedId)}{" "}
                <button
                  className="lock-mark"
                  title={e.locked === 1 ? "잠김 — AI 가져오기가 건드리지 않음" : "잠기지 않음"}
                  onClick={() =>
                    void runManage(async () => {
                      await api.keywords.addRelated(e.keywordId, e.relatedId, e.locked === 0);
                    })
                  }
                  aria-label={`${nameOf(e.relatedId)} 관련 잠금 토글`}
                >
                  {e.locked === 1 ? "🔒" : "🔓"}
                </button>
                <button
                  onClick={() =>
                    void runManage(async () => {
                      await api.keywords.removeRelated(e.keywordId, e.relatedId);
                    })
                  }
                  aria-label={`${nameOf(e.relatedId)} 관련 빼기`}
                >
                  ✕
                </button>
              </span>
            ))}
            {manageRelated.length === 0 ? <span className="meta">관련 없음</span> : null}
          </div>
          <div className="toolbar">
            <select value={addRelatedId} onChange={(e) => setAddRelatedId(e.target.value)} aria-label="관련으로 걸 키워드">
              <option value="">관련으로 걸 키워드 선택</option>
              {otherKeywords.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <button
              disabled={!addRelatedId || manageBusy}
              onClick={() =>
                void runManage(async () => {
                  await api.keywords.addRelated(manageKeyword.id, addRelatedId, false);
                  setAddRelatedId("");
                })
              }
            >
              관련 추가
            </button>
          </div>
          <p className="meta">
            <span className="lock-mark">🔒</span> 잠긴 간선은 AI 가져오기가 건드리지 않습니다. 자물쇠를 눌러 잠그거나 풀 수
            있습니다.
          </p>
        </div>
      ) : (
        <p className="meta">관리할 키워드를 위 칩에서 골라주세요.</p>
      )}
      {manageError ? <p className="notice">{manageError}</p> : null}
      {manageBusy ? <p className="meta">처리 중…</p> : null}
    </div>
  );
}
