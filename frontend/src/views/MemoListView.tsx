/**
 * 나이테 Pages-only — 메모 목록 뷰 (원본 memoaeb 레이아웃 기준)
 *
 * 원본 구조: 제목 줄("전체 메모" + 전체 기간·최근 수정순)과 보기 전환 pill 줄은
 * App 셸에서 그린다. 이 화면은 목록만 그린다. 필터(사이드바 보기·카테고리·
 * 키워드 섹션), 기간, 정렬은 props로 받는다.
 * 데이터는 api.memos.list (브라우저 로컬 저장소)에서 온다.
 *
 * 가상 스크롤 (원본 VirtualMemoList와 동일 목적): 메모가 많아도 보이는
 * 부분만 렌더링한다. 행 높이를 96px로 고정하고, 스크롤 위치에서 보이는
 * 행 앞뒤로 5개씩만 그린다. 30개씩 페이징은 없앴다.
 * Drive 동기화는 자동(앱이 열려 있는 동안 주기적, 설정에서 변경) +
 * 사이드바 하단의 '가져오기' 수동 버튼으로 한다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, TOKEN_EXPIRED_CODE, type MemoPreview } from "../api";
import { LineIcon } from "../components/LineIcon";
import {
  PERIODS,
  filterToListParams,
  periodRange,
  type MemoFilter,
  type PeriodKey,
  type SortKey,
} from "./memoFilters";

/** 가상 스크롤 행 높이 (CSS .memo-list.virtual .memo-item과 같은 값). */
const ROW_HEIGHT = 96;
/** 보이는 행 앞뒤로 미리 그려둘 행 수. */
const OVERSCAN = 5;
/** 한 번에 가져올 수 있는 최대 메모 수 (api.memos.list는 100개씩 끊는다). */
const MAX_MEMOS = 5000;

export function MemoListView(props: {
  onOpen: (memoId: string) => void;
  onNeedLogin: () => void;
  notice: string | null;
  setNotice: (msg: string | null) => void;
  /** 상단 검색창과 공유하는 검색어 (원본: 로고 옆 검색창). */
  search: string;
  /** 사이드바에서 고른 필터 (보기·카테고리·키워드). */
  filter: MemoFilter;
  /** 제목 줄의 기간 선택 (App 셸). */
  period: PeriodKey;
  /** 제목 줄의 정렬 선택 (App 셸). */
  sort: SortKey;
  /** 자동 동기화 등으로 목록을 새로고침해야 할 때 올리는 값 (App 셸). */
  refreshTick?: number;
  /** 목록 맨 아래 "+ 새 메모" 버튼용 (App 셸의 handleNewMemo). */
  onNew?: () => void;
}) {
  const { onOpen, onNeedLogin, notice, setNotice, search, filter, period, sort, refreshTick, onNew } = props;
  const [memos, setMemos] = useState<MemoPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = periodRange(period);
      const base = {
        ...range,
        ...filterToListParams(filter),
        search: search || undefined,
        sort: sort === "oldest" ? "oldest" : undefined,
      };
      // 미리보기 전체를 100개씩 끊어 가져온다 (가상 스크롤은 전체 개수를 알아야 한다).
      const all: MemoPreview[] = [];
      let offset = 0;
      let totalCount = 0;
      do {
        const page = await api.memos.list({ ...base, limit: 100, offset });
        totalCount = page.total;
        all.push(...page.memos);
        offset += page.memos.length;
        if (page.memos.length === 0) break;
      } while (offset < totalCount && all.length < MAX_MEMOS);
      setMemos(all);
      setTotal(totalCount);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === TOKEN_EXPIRED_CODE) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, period, search, sort, onNeedLogin, setNotice]);

  // 검색어·필터·기간·정렬·새로고침 신호가 바뀌면 처음부터 다시 불러온다.
  useEffect(() => {
    void load();
    listRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [load, refreshTick]);

  useEffect(() => {
    const el = listRef.current;
    if (el) setViewportHeight(el.clientHeight);
  }, []);

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "전체 기간";
  const sortLabel = sort === "oldest" ? "오래된순" : "최근 수정순";

  // 가상 스크롤: 보이는 구간만 그린다.
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(memos.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = memos.slice(start, end);

  return (
    <div>
      {notice ? <p className="notice">{notice}</p> : null}
      <p className="meta">
        메모 {total}개 · {periodLabel} · {sortLabel} · 가상 스크롤 (보이는 부분만 렌더링)
        {loading ? " · 불러오는 중…" : ""}
      </p>
      {memos.length === 0 && !loading ? (
        <p className="meta">메모가 없습니다. 새 메모를 만들어보세요.</p>
      ) : (
        <div
          className="virtual-list"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setScrollTop(el.scrollTop);
            setViewportHeight(el.clientHeight);
          }}
        >
          <div style={{ height: memos.length * ROW_HEIGHT, position: "relative" }}>
            <ul className="memo-list virtual">
              {visible.map((m, i) => (
                <li
                  key={m.id}
                  style={{
                    position: "absolute",
                    top: (start + i) * ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT,
                  }}
                >
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
                      {m.driveFileId ? <span className="memo-drive-badge">Drive 저장됨</span> : null}{" "}
                      {new Date(m.updatedAt).toLocaleString("ko-KR")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {total > MAX_MEMOS ? (
        <p className="meta">메모가 {MAX_MEMOS}개를 넘어 처음 {MAX_MEMOS}개만 표시합니다.</p>
      ) : null}
      {onNew ? (
        <button type="button" className="list-bottom-new" onClick={onNew}>
          + 새 메모
        </button>
      ) : null}
    </div>
  );
}
