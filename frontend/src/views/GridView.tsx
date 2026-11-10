/**
 * 나이테 Pages-only — 격자 카드 보기 (원본 memoaeb 레이아웃 기준)
 *
 * 원본 구조: 제목 줄("전체 메모" + 전체 기간·최근 수정순)과 보기 전환 pill 줄은
 * App 셸에서 그린다. 이 화면은 카드 격자만 그린다. 필터(사이드바 보기·카테고리·
 * 키워드 섹션), 기간, 정렬은 props로 받는다. 필터가 "전체"면 고정된 메모를
 * "고정됨" 섹션으로, 나머지를 "메모" 섹션으로 나눠 보여준다 (원본과 동일).
 * 데이터는 api.memos.list (브라우저 로컬 저장소).
 */

import { useCallback, useEffect, useState } from "react";
import { api, type Category, type MemoPreview } from "../api";
import { Teapot } from "../components/Logo";
import {
  PERIODS,
  filterToListParams,
  periodRange,
  type MemoFilter,
  type PeriodKey,
  type SortKey,
} from "./memoFilters";
import "./GridView.css";

const LIMIT = 30;

export function GridView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
  /** 상단 검색창과 공유하는 검색어 (원본: 로고 옆 검색창). */
  search: string;
  /** 사이드바에서 고른 필터 (보기·카테고리·키워드). */
  filter: MemoFilter;
  /** 제목 줄의 기간 선택 (App 셸). */
  period: PeriodKey;
  /** 제목 줄의 정렬 선택 (App 셸). */
  sort: SortKey;
}) {
  const { onOpen, setNotice, search, filter, period, sort } = props;
  const [memos, setMemos] = useState<MemoPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = periodRange(period);
      const [list, cats] = await Promise.all([
        api.memos.list({
          ...range,
          ...filterToListParams(filter),
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
  }, [period, sort, offset, filter, search, setNotice]);

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

  // 검색어·필터·기간·정렬이 바뀌면 첫 페이지부터 다시 불러온다.
  useEffect(() => {
    setOffset(0);
  }, [search, filter, period, sort]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "전체 기간";
  const sortLabel = sort === "oldest" ? "오래된순" : "최근 수정순";
  /** 원본: "전체" 필터일 때만 고정됨/메모 섹션을 나눈다. */
  const showSections = filter.kind === "all";
  const pinned = showSections ? memos.filter((m) => m.pinned === 1) : [];
  const rest = showSections ? memos.filter((m) => m.pinned !== 1) : memos;

  function renderCard(m: MemoPreview) {
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
  }

  return (
    <div>
      <p className="meta">
        메모 {total}개 · {periodLabel} · {sortLabel}
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
      {showSections && pinned.length > 0 ? (
        <>
          <h2 className="memo-section">고정됨</h2>
          <div className="grid-cards">{pinned.map(renderCard)}</div>
        </>
      ) : null}
      {showSections ? <h2 className="memo-section">메모</h2> : null}
      <div className="grid-cards">{rest.map(renderCard)}</div>
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
