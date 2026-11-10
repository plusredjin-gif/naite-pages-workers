/**
 * 나이테 Pages-only — 격자 카드 보기
 *
 * 기능: 제목·미리보기·날짜·카테고리 색 점·고정 표시의 카드 격자.
 * 기간 필터(전체/오늘/최근 7일/최근 30일/올해) + 정렬(최근 수정순/오래된순)
 * + 30개씩 페이지네이션. 데이터는 api.memos.list (브라우저 로컬 저장소).
 */

import { useCallback, useEffect, useState } from "react";
import { api, type Category, type MemoPreview } from "../api";
import { Teapot } from "../components/Logo";
import "./GridView.css";

type PeriodKey = "all" | "today" | "7d" | "30d" | "year";
type SortKey = "recent" | "oldest";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "year", label: "올해" },
];

const LIMIT = 30;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** 기간 선택을 api.memos.list용 from/to ISO 날짜로 바꾼다 (수정일 기준). */
function periodRange(period: PeriodKey): { from?: string; to?: string } {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "7d":
      return { from: startOfDay(addDays(now, -6)).toISOString(), to: endOfDay(now).toISOString() };
    case "30d":
      return { from: startOfDay(addDays(now, -29)).toISOString(), to: endOfDay(now).toISOString() };
    case "year":
      return {
        from: new Date(now.getFullYear(), 0, 1).toISOString(),
        to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999).toISOString(),
      };
    case "all":
    default:
      return {};
  }
}

export function GridView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
  /** 상단 검색창과 공유하는 검색어 (원본: 로고 옆 검색창). */
  search: string;
}) {
  const { onOpen, setNotice, search } = props;
  const [memos, setMemos] = useState<MemoPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 카테고리 칩 필터 (원본: 전체·고정됨·미분류·카테고리 아이콘 칩). */
  const [catFilter, setCatFilter] = useState<"all" | "pinned" | "none" | string>("all");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = periodRange(period);
      const [list, cats] = await Promise.all([
        api.memos.list({
          ...range,
          categoryId:
            catFilter === "all" || catFilter === "pinned"
              ? undefined
              : catFilter === "none"
                ? "__none__"
                : catFilter,
          pinned: catFilter === "pinned" ? true : undefined,
          search: search || undefined,
          sort: sort === "oldest" ? "oldest" : undefined,
          limit: LIMIT,
          offset,
        }),
        api.categories.list(),
      ]);
      setMemos(list.memos);
      setTotal(list.total);
      setCategories(cats.categories);
    } catch (e) {
      if ((e as { code?: string }).code === "TOKEN_EXPIRED_RELOGIN_REQUIRED") {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [period, sort, offset, catFilter, search, setNotice]);

  async function handleDriveImport() {
    setImporting(true);
    try {
      const result = await api.drive.importAll(false);
      setNotice(
        `Drive에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (전체 ${result.total ?? 0}개)` +
          (result.errors && result.errors.length > 0 ? ` (오류 ${result.errors.length}개)` : ""),
      );
      await load();
    } catch (e) {
      setNotice(`Drive 가져오기 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  // 상단 검색어가 바뀌면 첫 페이지부터 다시 불러온다.
  useEffect(() => {
    setOffset(0);
  }, [search]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "전체";
  const setFilter = (value: "all" | "pinned" | "none" | string) => {
    setCatFilter(value);
    setOffset(0);
  };

  return (
    <div>
      <div className="chip-row cat-chips" role="group" aria-label="카테고리">
        <button
          type="button"
          className={`chip${catFilter === "all" ? " active" : ""}`}
          onClick={() => setFilter("all")}
        >
          <span aria-hidden>▦</span>
          <span className="chip-label">전체</span>
        </button>
        <button
          type="button"
          className={`chip${catFilter === "pinned" ? " active" : ""}`}
          onClick={() => setFilter("pinned")}
        >
          <span aria-hidden>📌</span>
          <span className="chip-label">고정됨</span>
        </button>
        <button
          type="button"
          className={`chip${catFilter === "none" ? " active" : ""}`}
          onClick={() => setFilter("none")}
        >
          <span aria-hidden>📂</span>
          <span className="chip-label">미분류</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip${catFilter === c.id ? " active" : ""}`}
            onClick={() => setFilter(c.id)}
          >
            <span aria-hidden>{c.icon ?? "📁"}</span>
            <span className="chip-label">{c.name}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value as PeriodKey);
            setOffset(0);
          }}
          aria-label="기간"
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as SortKey);
            setOffset(0);
          }}
          aria-label="정렬"
        >
          <option value="recent">최근 수정순</option>
          <option value="oldest">오래된순</option>
        </select>
      </div>
      <p className="meta">
        메모 {total}개 · {periodLabel}
        {sort === "oldest" ? " · 오래된순" : " · 최근 수정순"}
      </p>
      {error ? <p className="notice">{error}</p> : null}
      {loading ? <p className="meta">불러오는 중…</p> : null}
      {!loading && memos.length === 0 && !error ? (
        <div className="empty-state">
          <Teapot expression="cheer" />
          <div>
            <p>이 기간에 메모가 없습니다. 새 메모를 만들어보세요.</p>
            <p className="meta">원본 앱 메모가 Drive에 있으면 가져올 수 있습니다.</p>
            <button type="button" onClick={() => void handleDriveImport()} disabled={importing}>
              {importing ? "가져오는 중…" : "Drive에서 가져오기"}
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid-cards">
        {memos.map((m) => {
          const cat = m.categoryId ? categoryById.get(m.categoryId) : undefined;
          const dotColor = cat?.color ?? m.color ?? "#cccccc";
          return (
            <button key={m.id} className="memo-card" onClick={() => onOpen(m.id)}>
              <span className="memo-title">
                {m.pinned === 1 ? <span className="pin-mark" title="고정됨">📌 </span> : null}
                {m.title || "(제목 없음)"}
              </span>
              <span className="memo-preview">{m.preview ?? ""}</span>
              <span className="memo-card-foot">
                <span className="cat-dot" style={{ backgroundColor: dotColor }} />
                <span className="memo-card-cat">{cat ? cat.name : "미분류"}</span>
                <span className="memo-date">
                  {new Date(m.updatedAt).toLocaleDateString("ko-KR")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="pager">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          이전
        </button>
        <span>
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
        </span>
        <button
          disabled={offset + LIMIT >= total}
          onClick={() => setOffset(offset + LIMIT)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
