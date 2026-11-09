/**
 * 나이테 Pages-only — 메모 편집기 뷰 (핵심 화면)
 *
 * 기능: 제목·단락 블록(기본)·체크리스트 블록·키워드 자동 추출·Drive에 저장.
 * 저장은 로컬 저장소에 즉시 반영되고, Drive 저장은 "Drive에 저장" 버튼으로
 * 수동으로 한다 (자동 업로드 없음).
 */

import { useCallback, useEffect, useState } from "react";
import { api, TOKEN_EXPIRED_CODE, type Block, type MemoDetail } from "../api";

export function MemoEditorView(props: {
  memoId: string;
  onBack: () => void;
  onNeedLogin: () => void;
  setNotice: (msg: string | null) => void;
}) {
  const { memoId, onBack, onNeedLogin, setNotice } = props;
  const [memo, setMemo] = useState<MemoDetail | null>(null);
  const [title, setTitle] = useState("");
  const [pushing, setPushing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await api.memos.get(memoId);
      setMemo(detail);
      setTitle(detail.title);
    } catch (e) {
      setNotice(`메모를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [memoId, setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTitleBlur() {
    if (!memo || title === memo.title) return;
    try {
      await api.memos.update(memoId, { title });
      setMemo({ ...memo, title });
    } catch (e) {
      setNotice(`제목 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleBlockText(block: Block, text: string) {
    setMemo((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === block.id ? { ...b, text } : b)) } : prev,
    );
    try {
      await api.blocks.update(block.id, { text });
    } catch (e) {
      setNotice(`블록 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleBlockChecked(block: Block, checked: boolean) {
    setMemo((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === block.id ? { ...b, checked: checked ? 1 : 0 } : b)) } : prev,
    );
    try {
      await api.blocks.update(block.id, { checked: checked ? 1 : 0 });
    } catch (e) {
      setNotice(`체크 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleAddBlock(type: Block["type"]) {
    try {
      const { id } = await api.memos.addBlock(memoId, { type });
      await load();
      void id;
    } catch (e) {
      setNotice(`블록 추가 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleExtractKeywords() {
    setExtracting(true);
    try {
      const { keywords } = await api.memos.extractKeywords(memoId);
      setNotice(keywords.length > 0 ? `키워드 추출: ${keywords.join(", ")}` : "추출된 키워드가 없습니다.");
      await load();
    } catch (e) {
      setNotice(`키워드 추출 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExtracting(false);
    }
  }

  async function handlePushToDrive() {
    setPushing(true);
    try {
      const result = await api.drive.pushMemo(memoId);
      setNotice(`Drive에 저장했습니다. 파일 ID: ${result.driveFileId ?? "(없음)"}`);
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === TOKEN_EXPIRED_CODE) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`Drive 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setPushing(false);
    }
  }

  if (!memo) return <p className="meta">메모를 불러오는 중…</p>;

  return (
    <div>
      <div className="toolbar">
        <button onClick={onBack}>← 목록으로</button>
        <button onClick={() => void handleExtractKeywords()} disabled={extracting}>
          {extracting ? "추출 중…" : "키워드 자동 추출"}
        </button>
        <button onClick={() => void handlePushToDrive()} disabled={pushing}>
          {pushing ? "저장 중…" : "Drive에 저장"}
        </button>
      </div>
      <input
        className="memo-title-input"
        placeholder="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void handleTitleBlur()}
      />
      <div className="blocks">
        {memo.blocks.map((block) => (
          <div key={block.id} className="block">
            {block.type === "todo" ? (
              <>
                <input
                  type="checkbox"
                  checked={block.checked === 1}
                  onChange={(e) => void handleBlockChecked(block, e.target.checked)}
                />
                <input
                  type="text"
                  value={block.text}
                  placeholder="할 일"
                  onChange={(e) => void handleBlockText(block, e.target.value)}
                />
              </>
            ) : block.type === "paragraph" ? (
              <textarea
                value={block.text}
                placeholder="단락 (새 메모는 제목 밑 단락이 기본입니다)"
                rows={3}
                onChange={(e) => void handleBlockText(block, e.target.value)}
              />
            ) : (
              <p className="meta">
                [{block.type}] 블록 — 이 화면에서는 텍스트만 표시합니다. ({block.text || "내용 없음"})
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="toolbar">
        <button onClick={() => void handleAddBlock("paragraph")}>+ 단락</button>
        <button onClick={() => void handleAddBlock("todo")}>+ 체크리스트</button>
        <button onClick={() => void handleAddBlock("schedule")}>+ 일정 블록</button>
      </div>
      {memo.keywords.length > 0 ? (
        <p className="meta">키워드: {memo.keywords.map((k) => k.name).join(", ")}</p>
      ) : null}
      <p className="meta">
        Drive 파일: {memo.driveFileId ?? "아직 Drive에 저장되지 않음 (로컬에만 있음)"}
      </p>
    </div>
  );
}
