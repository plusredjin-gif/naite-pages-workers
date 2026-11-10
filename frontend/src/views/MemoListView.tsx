/**
 * 나이테 Pages-only — 메모 목록 뷰 (원본 memoaeb 레이아웃 기준)
 *
 * 원본 구조: 제목 줄("전체 메모" + 전체 기간·최근 수정순)과 보기 전환 pill 줄은
 * App 셸에서 그린다. 이 화면은 목록만 그린다. 필터(사이드바 보기·카테고리·
 * 키워드 섹션), 기간, 정렬은 props로 받는다.
 * 데이터는 api.memos.list (브라우저 로컬 저장소)에서 온다.
 * Drive 동기화는 사이드바 하단의 '가져오기' 버튼으로만 한다 (자동·백그라운드 동기화 없음).
 */

import { useCallback, useEffect, useState } from "react";
import { api, TOKEN_EXPIRED_CODE, type MemoPreview } from "../api";
import {
  PERIODS,
  filterToListParams,
  periodRange,
  type MemoFilter,
  type PeriodKey,
  type SortKey,
} from "./memoFilters";

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
}) {
  const { onOpen, onNeedLogin, notice, setNotice, search, filter, period, sort } = props;
  const [memos, setMemos] = useState<MemoPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 30;

  const load = useCallback(async () => {
    try {
      const range = periodRange(period);
      const list = await api.memos.list({
        ...range,
        ...filterToListParams(filter),
        search: search || undefined,
        sort: sort === "oldest" ? "oldest" : undefined,
        limit: LIMIT,
        offset,
      });
      setMemos(list.memos);
      setTotal(list.total);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === TOKEN_EXPIRED_CODE) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }, [filter, period, search, sort, offset, onNeedLogin, setNotice]);

  // 검색어·필터·기간·정렬이 바뀌면 첫 페이지부터 다시 불러온다.
  useEffect(() => {
    setOffset(0);
  }, [search, filter, period, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "전체 기간";
  const sortLabel = sort === "oldest" ? "오래된순" : "최근 수정순";

  return (
    <div>
      {notice ? <p className="notice">{notice}</p> : null}
      <p className="meta">
        메모 {total}개 · {periodLabel} · {sortLabel} · 로컬 저장 + Drive 수동 동기화 (백그라운드 동기화 없음)
      </p>
      <ul className="memo-list">
        {memos.map((m) => (
          <li key={m.id}>
            <button className="memo-item" onClick={() => onOpen(m.id)}>
              <span className="memo-title">
                {m.pinned === 1 ? <span className="pin-mark" title="고정됨">📌 </span> : null}
                {m.title || "(제목 없음)"}
              </span>
              <span className="memo-preview">{m.preview ?? ""}</span>
              <span className="memo-date">{new Date(m.updatedAt).toLocaleString("ko-KR")}</span>
            </button>
          </li>
        ))}
      </ul>
      {memos.length === 0 ? <p className="meta">메모가 없습니다. 새 메모를 만들어보세요.</p> : null}
      <div className="pager">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          이전
        </button>
        <span>
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
        </span>
        <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
          다음
        </button>
      </div>
    </div>
  );
}
