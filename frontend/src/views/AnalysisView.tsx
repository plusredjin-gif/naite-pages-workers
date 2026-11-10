/**
 * 나이테 Pages-only — 분석 대시보드 뷰
 *
 * 요약 카드(연결 수·중심 키워드·고립 메모), 키워드 관계도, 사람·장소·위치·시간
 * 관계도, AI 프롬프트 생성·복사, "AI 결과로 관계 다시 만들기"(JSON 미리보기·적용·
 * 적용 기록·되돌리기). 데이터는 api.analytics.* 와 api.ontology.* 에서만 가져온다.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type AnalyticsSummary, type OntologyGraph } from "../api";
import { Teapot } from "../components/Logo";
import "./AnalysisView.css";

type Preview = Awaited<ReturnType<typeof api.ontology.previewImport>>;
type Revision = Awaited<ReturnType<typeof api.ontology.revisions>>["revisions"][number];

type RelNode = {
  id: string;
  label: string;
  kind: "keyword" | "person" | "place" | "location" | "date";
  col: number;
};

const NODE_W = 150;
const NODE_H = 36;
const COL_W = 190;
const ROW_H = 52;

const REL_FILL: Record<RelNode["kind"], string> = {
  keyword: "#ffffff",
  person: "#e8f0fe",
  place: "#e8f5e9",
  location: "#f3e8fd",
  date: "#fdf0e3",
};

const REL_STROKE: Record<RelNode["kind"], string> = {
  keyword: "#b98a4e",
  person: "#5a7ab8",
  place: "#5a8a5a",
  location: "#8a5ab8",
  date: "#b8763a",
};

function isTokenExpired(e: unknown): boolean {
  return (e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED";
}

export function AnalysisView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
}) {
  const { onOpen, setNotice } = props;
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [entityNodes, setEntityNodes] = useState<RelNode[]>([]);
  const [entityEdges, setEntityEdges] = useState<Array<{ from: string; to: string }>>([]);
  const [entityBasis, setEntityBasis] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState<string | null>(null);
  const [significant, setSignificant] = useState<string[]>([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [jsonInput, setJsonInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [s, g, revs] = await Promise.all([
      api.analytics.summary(),
      api.ontology.graph(),
      api.ontology.revisions(),
    ]);
    setSummary(s);
    setGraph(g);
    setRevisions(revs.revisions);
  }, []);

  const loadEntityGraph = useCallback(async () => {
    // 사람·장소·위치·시간 관계도: 최근 메모 30개의 상세에서
    // 같은 메모에 함께 나온 항목끼리 간선을 긋는다.
    try {
      const list = await api.memos.list({ limit: 30 });
      const details = await Promise.all(list.memos.map((m) => api.memos.get(m.id).catch(() => null)));
      const nodes = new Map<string, RelNode>();
      const edgeKeys = new Set<string>();
      const edges: Array<{ from: string; to: string }> = [];
      const addNode = (id: string, label: string, kind: RelNode["kind"], col: number) => {
        if (!nodes.has(id)) nodes.set(id, { id, label, kind, col });
      };
      const addEdge = (a: string, b: string) => {
        if (a === b) return;
        const key = [a, b].sort().join("|");
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push({ from: a, to: b });
      };
      for (const d of details) {
        if (!d) continue;
        const kws = d.keywords.map((k) => `keyword:${k.id}`);
        const persons = d.people.map((p) => `person:${p.id}`);
        const places = d.places.map((p) => `place:${p.id}`);
        const locs = d.locations.map((p) => `location:${p.id}`);
        for (const k of d.keywords) addNode(`keyword:${k.id}`, k.name, "keyword", 0);
        for (const p of d.people) addNode(`person:${p.id}`, p.name, "person", 1);
        for (const p of d.places) addNode(`place:${p.id}`, p.name, "place", 2);
        for (const p of d.locations) addNode(`location:${p.id}`, p.name, "location", 3);
        const entities = [...persons, ...places, ...locs];
        for (const e of entities) for (const k of kws) addEdge(e, k);
        for (let i = 0; i < entities.length; i += 1) {
          for (let j = i + 1; j < entities.length; j += 1) addEdge(entities[i], entities[j]);
        }
        if (d.event?.startAt) {
          const date = d.event.startAt.slice(0, 10);
          const dateId = `date:${date}`;
          addNode(dateId, date, "date", 4);
          for (const e of [...entities, ...kws]) addEdge(e, dateId);
        }
      }
      setEntityNodes([...nodes.values()]);
      setEntityEdges(edges);
      setEntityBasis(`최근 메모 ${details.filter(Boolean).length}개 기준`);
    } catch {
      setEntityNodes([]);
      setEntityEdges([]);
      setEntityBasis("");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadData(), loadEntityGraph()]);
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setError(`분석을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [loadData, loadEntityGraph, setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMakePrompt() {
    setPromptLoading(true);
    setCopied(false);
    try {
      const result = await api.analytics.prompt(2);
      setPrompt(result.prompt);
      setSignificant(result.significantKeywords);
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`프롬프트를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setPromptLoading(false);
    }
  }

  async function handleCopyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      // 클립보드 API가 막히면 textarea 붙여넣기 방식으로 폴백한다.
      try {
        const ta = document.createElement("textarea");
        ta.value = prompt;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
      } catch {
        setNotice("복사에 실패했습니다. 프롬프트를 직접 드래그해 복사해주세요.");
      }
    }
  }

  async function handlePreview() {
    if (!jsonInput.trim()) {
      setPreviewError("AI가 준 JSON을 붙여넣어 주세요.");
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setApplyMsg(null);
    try {
      const result = await api.ontology.previewImport(jsonInput);
      setPreview(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(
        msg === "invalid_json"
          ? "JSON 형식이 아닙니다. AI 답변을 그대로(설명 없이 JSON만) 붙여넣어 주세요."
          : `미리보기를 만들지 못했습니다: ${msg}`,
      );
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!jsonInput.trim() || !preview) return;
    setApplying(true);
    setApplyMsg(null);
    try {
      const result = await api.ontology.applyImport(jsonInput);
      setApplyMsg("적용했습니다. 적용 기록에서 되돌릴 수 있습니다.");
      setPreview(null);
      void result;
      await loadData();
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setPreviewError(`적용하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setApplying(false);
    }
  }

  async function handleUndo(revisionId: string) {
    setUndoingId(revisionId);
    try {
      await api.ontology.undoRevision(revisionId);
      await loadData();
      setApplyMsg("되돌렸습니다.");
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`되돌리지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setUndoingId(null);
    }
  }

  if (loading) {
    return (
      <div>
        <h2>분석</h2>
        <p className="meta">불러오는 중…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2>분석</h2>
        <p className="notice">{error}</p>
        <button onClick={() => void load()}>다시 불러오기</button>
      </div>
    );
  }

  if (!summary || !graph) {
    return (
      <div>
        <h2>분석</h2>
        <p className="meta">분석할 데이터가 없습니다.</p>
      </div>
    );
  }

  const centralTop = summary.centralKeywords.slice(0, 5);
  const maxDegree = centralTop.length > 0 ? Math.max(...centralTop.map((k) => k.degree), 1) : 1;
  const connectedMemoCount = summary.memoCount - summary.isolatedMemos.length;
  const kwLayout = layoutKeywordGraph(graph);
  const entityLayout = layoutColumns(entityNodes);

  return (
    <div>
      <h2>분석</h2>
      {summary.memoCount === 0 && summary.keywordCount === 0 ? (
        <div className="empty-state">
          <Teapot />
          <p>아직 메모도 키워드도 없습니다. 메모를 만들고 키워드를 연결하면 분석이 쌓입니다.</p>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-num">{summary.totalConnections}</div>
          <div className="meta">전체 연결 수</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">{connectedMemoCount}</div>
          <div className="meta">연결된 메모 수 (전체 {summary.memoCount}개)</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">{summary.keywordCount}</div>
          <div className="meta">키워드 수</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">
            {summary.parentEdges} / {summary.relatedEdges}
          </div>
          <div className="meta">상위 간선 / 관련 간선</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">{summary.memoKeywordLinks}</div>
          <div className="meta">메모–키워드 연결</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">
            {summary.peopleCount} / {summary.placeCount}
          </div>
          <div className="meta">사람 / 장소</div>
        </div>
      </div>

      <div className="card">
        <h3>중심 키워드 상위 5개</h3>
        {centralTop.length === 0 ? (
          <p className="meta">아직 키워드가 없습니다.</p>
        ) : (
          <ul className="bar-list">
            {centralTop.map((k) => (
              <li key={k.id}>
                <span className="bar-label">{k.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.round((k.degree / maxDegree) * 100)}%` }} />
                </span>
                <span className="bar-value">{k.degree}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>고립된 메모 ({summary.isolatedMemos.length}개)</h3>
        {summary.isolatedMemos.length === 0 ? (
          <p className="meta">키워드가 없는 메모가 없습니다. 모든 메모가 연결돼 있습니다.</p>
        ) : (
          <>
            <ul className="memo-list">
              {summary.isolatedMemos.map((m) => (
                <li key={m.id}>
                  <button className="memo-item" onClick={() => onOpen(m.id)}>
                    <span className="memo-title">{m.title || "(제목 없음)"}</span>
                    <span className="memo-preview">키워드 없음 — 눌러서 키워드를 달아보세요.</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="meta">최근 고립 메모 최대 10개까지만 표시합니다.</p>
          </>
        )}
      </div>

      <div className="card">
        <h3>키워드 관계도</h3>
        {kwLayout.nodes.length === 0 ? (
          <p className="meta">키워드가 없어 관계도를 그릴 수 없습니다.</p>
        ) : (
          <>
            <div className="graph-wrap">
              <svg width={kwLayout.width} height={kwLayout.height} role="img" aria-label="키워드 관계도">
                {kwLayout.edges.map((e, i) => {
                  const a = kwLayout.pos.get(e.from);
                  const b = kwLayout.pos.get(e.to);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`kw-edge-${i}`}
                      x1={a.x + NODE_W}
                      y1={a.y + NODE_H / 2}
                      x2={b.x}
                      y2={b.y + NODE_H / 2}
                      stroke={e.kind === "parent" ? "#8a7a5a" : "#7a9a6a"}
                      strokeWidth={e.tree ? 2 : 1.5}
                      strokeDasharray={e.kind === "related" || !e.tree ? "5 3" : undefined}
                    />
                  );
                })}
                {kwLayout.nodes.map((n) => {
                  const p = kwLayout.pos.get(n.id);
                  if (!p) return null;
                  return (
                    <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
                      <rect width={NODE_W} height={NODE_H} rx={8} fill="#fff" stroke="#b98a4e" strokeWidth={1.5} />
                      <text x={10} y={23} fontSize={13} fill="#222">
                        {n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <p className="meta">실선은 신장 포리스트 간선, 점선은 나머지 상위·관련 간선입니다.</p>
          </>
        )}
      </div>

      <div className="card">
        <h3>사람·장소·위치·시간 관계도</h3>
        {entityNodes.length === 0 ? (
          <p className="meta">사람·장소·위치·일정이 연결된 메모가 아직 없습니다.</p>
        ) : (
          <>
            <p className="meta">
              {entityBasis} — 같은 메모에 함께 나온 항목끼리 연결했습니다. 왼쪽부터 키워드·사람·장소·위치·날짜입니다.
            </p>
            <div className="graph-wrap">
              <svg width={entityLayout.width} height={entityLayout.height} role="img" aria-label="사람 장소 위치 시간 관계도">
                {entityEdges.map((e, i) => {
                  const a = entityLayout.pos.get(e.from);
                  const b = entityLayout.pos.get(e.to);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`ent-edge-${i}`}
                      x1={a.x + NODE_W}
                      y1={a.y + NODE_H / 2}
                      x2={b.x}
                      y2={b.y + NODE_H / 2}
                      stroke="#9a9a9a"
                      strokeWidth={1}
                    />
                  );
                })}
                {entityNodes.map((n) => {
                  const p = entityLayout.pos.get(n.id);
                  if (!p) return null;
                  return (
                    <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={8}
                        fill={REL_FILL[n.kind]}
                        stroke={REL_STROKE[n.kind]}
                        strokeWidth={1.5}
                      />
                      <text x={10} y={23} fontSize={13} fill="#222">
                        {n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>AI 프롬프트 생성</h3>
        <p className="meta">연결이 2개 이상인 유의미 키워드를 중심으로 AI에 보낼 분석 프롬프트를 만듭니다.</p>
        <div className="toolbar">
          <button onClick={() => void handleMakePrompt()} disabled={promptLoading}>
            {promptLoading ? "만드는 중…" : "프롬프트 만들기"}
          </button>
          <button onClick={() => void handleCopyPrompt()} disabled={!prompt}>
            복사
          </button>
          {copied ? <span className="meta">복사됐습니다</span> : null}
        </div>
        {significant.length > 0 ? <p className="meta">유의미 키워드: {significant.join(", ")}</p> : null}
        {prompt ? <pre className="prompt-box">{prompt}</pre> : <p className="meta">아직 프롬프트가 없습니다.</p>}
      </div>

      <div className="card">
        <h3>AI 결과로 관계 다시 만들기</h3>
        <p className="meta">
          위 프롬프트를 AI에 붙여넣고 받은 JSON을 아래에 붙여넣으세요. 미리보기에서 바뀔 내용을 확인한 뒤 적용합니다. 🔒
          잠긴 관계는 건드리지 않습니다.
        </p>
        <textarea
          className="json-input"
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder='{"keywords": [{"name": "키워드", "parents": ["상위 키워드"], "related": ["관련 키워드"]}], "linksToRemove": []}'
          rows={8}
          aria-label="AI 결과 JSON 붙여넣기"
        />
        <div className="toolbar">
          <button onClick={() => void handlePreview()} disabled={previewLoading}>
            {previewLoading ? "미리보는 중…" : "미리보기"}
          </button>
          <button onClick={() => void handleApply()} disabled={!preview || applying}>
            {applying ? "적용 중…" : "확인 후 적용"}
          </button>
        </div>
        {previewError ? <p className="notice">{previewError}</p> : null}
        {applyMsg ? <p className="meta">{applyMsg}</p> : null}
        {preview ? (
          <div>
            <h4>미리보기</h4>
            <dl className="kv">
              <dt>새 키워드</dt>
              <dd>{preview.newKeywords.length > 0 ? preview.newKeywords.join(", ") : "없음"}</dd>
              <dt>상위 변경</dt>
              <dd>
                {preview.parentChanges.length > 0
                  ? preview.parentChanges.map((c) => `${c.keyword} ← ${c.parent}`).join(", ")
                  : "없음"}
              </dd>
              <dt>관련 추가</dt>
              <dd>
                {preview.linksAdded.length > 0
                  ? preview.linksAdded.map((l) => `${l.from} ↔ ${l.to}`).join(", ")
                  : "없음"}
              </dd>
              <dt>제거할 연결</dt>
              <dd>
                {preview.linksToRemove.length > 0
                  ? preview.linksToRemove.map((l) => `${l.from} – ${l.to}${l.kind ? ` (${l.kind})` : ""}`).join(", ")
                  : "없음"}
              </dd>
              <dt>잠긴 관계 건너뜀</dt>
              <dd>
                {preview.skippedLocked.length > 0
                  ? preview.skippedLocked
                      .map((s) => `${s.keyword}${s.parent ? ` ← ${s.parent}` : ""}${s.related ? ` ↔ ${s.related}` : ""}`)
                      .join(", ")
                  : "없음"}
              </dd>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>적용 기록</h3>
        {revisions.length === 0 ? (
          <p className="meta">아직 적용 기록이 없습니다.</p>
        ) : (
          <ul className="memo-list">
            {revisions.map((r) => (
              <li key={r.id}>
                <div className="memo-item">
                  <span className="memo-title">{formatRevisionSummary(r.changeSummary)}</span>
                  <span className="memo-date">
                    {new Date(r.createdAt).toLocaleString("ko-KR")}
                    {r.undone === 1 ? " · 되돌림" : ""}
                  </span>
                  <span>
                    <button disabled={r.undone === 1 || undoingId === r.id} onClick={() => void handleUndo(r.id)}>
                      {undoingId === r.id ? "되돌리는 중…" : "되돌리기"}
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 적용 기록 요약(JSON 문자열)을 읽기 쉽게 바꾼다. */
function formatRevisionSummary(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      newKeywords?: number;
      parentChanges?: number;
      linksAdded?: number;
      linksRemoved?: number;
    };
    return `새 키워드 ${parsed.newKeywords ?? 0}개 · 상위 변경 ${parsed.parentChanges ?? 0}개 · 관련 추가 ${parsed.linksAdded ?? 0}개 · 제거 ${parsed.linksRemoved ?? 0}개`;
  } catch {
    return raw;
  }
}

/** 키워드 그래프를 신장 포리스트(BFS) 열 배치로 그릴 좌표. */
function layoutKeywordGraph(graph: OntologyGraph): {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; kind: "parent" | "related"; tree: boolean }>;
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const nodes = graph.keywords.map((k) => ({ id: `keyword:${k.id}`, label: k.name }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const parentEdges = graph.parentEdges.map((e) => ({ from: `keyword:${e.fromId}`, to: `keyword:${e.toId}` }));
  const relatedRaw = graph.relatedEdges.map((e) => ({ from: `keyword:${e.fromId}`, to: `keyword:${e.toId}` }));
  const seenRel = new Set<string>();
  const relatedEdges: Array<{ from: string; to: string }> = [];
  for (const e of relatedRaw) {
    const key = [e.from, e.to].sort().join("|");
    if (seenRel.has(key)) continue;
    seenRel.add(key);
    relatedEdges.push(e);
  }
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set(parentEdges.map((e) => e.from));
  for (const e of parentEdges) {
    childrenOf.set(e.to, [...(childrenOf.get(e.to) ?? []), e.from]);
  }
  const depth = new Map<string, number>();
  const treeKeys = new Set<string>();
  let maxDepth = -1;
  const bfs = (rootId: string, startDepth: number) => {
    const queue: Array<{ id: string; d: number }> = [{ id: rootId, d: startDepth }];
    depth.set(rootId, startDepth);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      maxDepth = Math.max(maxDepth, cur.d);
      for (const child of childrenOf.get(cur.id) ?? []) {
        if (!depth.has(child) && nodeIds.has(child)) {
          depth.set(child, cur.d + 1);
          treeKeys.add(`${child}|${cur.id}`);
          queue.push({ id: child, d: cur.d + 1 });
        }
      }
    }
  };
  for (const n of nodes) if (!hasParent.has(n.id)) bfs(n.id, 0);
  for (const n of nodes) if (!depth.has(n.id)) bfs(n.id, maxDepth + 1);

  const byDepth = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), n]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  const colCount = Math.max(0, maxDepth) + 1;
  for (let d = 0; d < colCount; d += 1) {
    const col = (byDepth.get(d) ?? []).sort((a, b) => a.label.localeCompare(b.label, "ko"));
    maxRows = Math.max(maxRows, col.length);
    col.forEach((n, ri) => pos.set(n.id, { x: d * COL_W + 16, y: ri * ROW_H + 16 }));
  }
  const edges: Array<{ from: string; to: string; kind: "parent" | "related"; tree: boolean }> = [
    ...parentEdges.map((e) => ({ ...e, kind: "parent" as const, tree: treeKeys.has(`${e.from}|${e.to}`) })),
    ...relatedEdges.map((e) => ({ ...e, kind: "related" as const, tree: false })),
  ];
  return {
    nodes,
    edges,
    pos,
    width: Math.max(1, colCount) * COL_W + NODE_W + 32,
    height: Math.max(1, maxRows) * ROW_H + 48,
  };
}

/** 종류별 열 배치 (사람·장소·위치·시간 관계도용). */
function layoutColumns(nodes: RelNode[]): {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const pos = new Map<string, { x: number; y: number }>();
  const byCol = new Map<number, RelNode[]>();
  for (const n of nodes) {
    byCol.set(n.col, [...(byCol.get(n.col) ?? []), n]);
  }
  let maxRows = 0;
  let maxCol = -1;
  for (const [col, list] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
    maxCol = Math.max(maxCol, col);
    const sorted = [...list].sort((a, b) => a.label.localeCompare(b.label, "ko"));
    maxRows = Math.max(maxRows, sorted.length);
    sorted.forEach((n, ri) => pos.set(n.id, { x: col * COL_W + 16, y: ri * ROW_H + 16 }));
  }
  return {
    pos,
    width: Math.max(1, maxCol + 1) * COL_W + NODE_W + 32,
    height: Math.max(1, maxRows) * ROW_H + 48,
  };
}
