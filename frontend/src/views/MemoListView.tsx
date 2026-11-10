/**
 * 나이테 Pages-only — 메모 목록 뷰 (핵심 화면)
 *
 * 기능: 검색·카테고리 필터·30개씩 목록·새 메모·Drive 수동 동기화 버튼.
 * 데이터는 api.memos.list (브라우저 로컬 저장소)에서 온다.
 * Drive 동기화는 수동 버튼으로만 한다 (자동·백그라운드 동기화 없음).
 */

import { useCallback, useEffect, useState } from "react";
import { api, TOKEN_EXPIRED_CODE, type Category, type MemoPreview } from "../api";

export function MemoListView(props: {
  onOpen: (memoId: string) => void;
  onNeedLogin: () => void;
  notice: string | null;
  setNotice: (msg: string | null) => void;
  /** 상단 검색창과 공유하는 검색어 (원본: 로고 옆 검색창). */
  search: string;
}) {
  const { onOpen, onNeedLogin, notice, setNotice, search } = props;
  const [memos, setMemos] = useState<MemoPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const LIMIT = 30;

  const load = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([
        api.memos.list({
          categoryId: categoryId || undefined,
          search: search || undefined,
          limit: LIMIT,
          offset,
        }),
        api.categories.list(),
      ]);
      setMemos(list.memos);
      setTotal(list.total);
      setCategories(cats.categories);
    } catch (e) {
      setNotice(`목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [categoryId, search, offset, setNotice]);

  // 상단 검색어가 바뀌면 첫 페이지부터 다시 불러온다.
  useEffect(() => {
    setOffset(0);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleNewMemo() {
    try {
      const { id } = await api.memos.create({ title: "" });
      onOpen(id);
    } catch (e) {
      setNotice(`메모를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDriveSync() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await api.drive.sync(false);
      setNotice(
        `Drive 동기화 완료: 전체 ${result.total ?? 0}개 중 ${result.imported ?? 0}개 가져옴` +
          (result.errors && result.errors.length > 0 ? ` (오류 ${result.errors.length}개)` : ""),
      );
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === TOKEN_EXPIRED_CODE) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`Drive 동기화 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">전체 카테고리</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={() => void handleNewMemo()}>+ 새 메모</button>
        <button onClick={() => void handleDriveSync()} disabled={syncing}>
          {syncing ? "동기화 중…" : "Drive 동기화"}
        </button>
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
      <p className="meta">
        메모 {total}개 · 로컬 저장 + Drive 수동 동기화 (백그라운드 동기화 없음)
      </p>
      <ul className="memo-list">
        {memos.map((m) => (
          <li key={m.id}>
            <button className="memo-item" onClick={() => onOpen(m.id)}>
              <span className="memo-title">{m.title || "(제목 없음)"}</span>
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
          {offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
        </span>
        <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
          다음
        </button>
      </div>
    </div>
  );
}
