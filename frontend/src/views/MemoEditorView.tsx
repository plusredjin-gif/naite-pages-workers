/**
 * 나이테 Pages-only — 메모 편집기 뷰
 *
 * 원본(memoaeb) 편집기 기준:
 * 제목·쓰기/미리보기·고정·삭제(2단계)·새 메모 빈 단락 1개,
 * 블록 단락(MD 미리보기)·체크리스트(마감일·Tasks 동기화)·사진·음성(녹음·말해서 입력)·
 * 일정 블록, 블록 이동·삭제, 하단 아이콘 도구 모음,
 * 푸터 메타데이터(키워드 칩·사람·장소·현재 위치·카테고리·카드 색상 7종),
 * 가져오기 모달(md/txt/html), 빈 새 메모 닫으면 자동 삭제.
 * 저장은 입력할 때마다 로컬에 즉시 반영, Drive 저장은 "Drive에 저장" 버튼으로 수동.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, TOKEN_EXPIRED_CODE, type Block, type Category, type MemoDetail } from "../api";

/** 카드 색상 7종 (원본). */
const CARD_COLORS = [
  { value: "#ffffff", label: "기본" },
  { value: "#fff3e0", label: "주황" },
  { value: "#fde8e8", label: "분홍" },
  { value: "#e8f5e9", label: "초록" },
  { value: "#e8f0fe", label: "파랑" },
  { value: "#f3e8fd", label: "보라" },
  { value: "#fdf0e3", label: "살구" },
] as const;

type PeopleCandidate = Awaited<ReturnType<typeof api.people.search>>["candidates"][number];
type PlaceCandidate = Awaited<ReturnType<typeof api.places.search>>["candidates"][number];

/** 최소 Web Speech API 타입 (ko-KR 말해서 단락 추가용). */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** HTML 이스케이프 후 간단한 마크다운(**굵게**·*기울임*·`코드`·[링크](url))만 렌더링. */
function renderMarkdownLite(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, "<br>");
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MemoEditorView(props: {
  memoId: string;
  onBack: () => void;
  onNeedLogin: () => void;
  setNotice: (msg: string | null) => void;
}) {
  const { memoId, onBack, onNeedLogin, setNotice } = props;
  const [memo, setMemo] = useState<MemoDetail | null>(null);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, { url: string; mime: string }>>({});
  const [pushing, setPushing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 키워드
  const [newKeyword, setNewKeyword] = useState("");
  // 사람·장소 연결
  const [personQuery, setPersonQuery] = useState("");
  const [personCandidates, setPersonCandidates] = useState<PeopleCandidate[]>([]);
  const [personSearching, setPersonSearching] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeCandidates, setPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeStatus, setPlaceStatus] = useState<string | null>(null);
  // 현재 위치
  const [locating, setLocating] = useState(false);
  // 일정 패널
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [eventDate, setEventDate] = useState(todayKey());
  const [eventAllDay, setEventAllDay] = useState(false);
  const [eventStart, setEventStart] = useState("09:00");
  const [eventEnd, setEventEnd] = useState("10:00");
  const [creatingEvent, setCreatingEvent] = useState(false);
  // 음성 패널
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // 가져오기 모달
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<"markdown" | "html">("markdown");
  const [importing, setImporting] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, cats] = await Promise.all([api.memos.get(memoId), api.categories.list()]);
      setMemo(detail);
      setTitle(detail.title);
      setCategories(cats.categories);
      const urls: Record<string, { url: string; mime: string }> = {};
      for (const b of detail.blocks) {
        if (!b.attachmentId) continue;
        try {
          const att = await api.attachments.get(b.attachmentId);
          urls[b.id] = { url: att.url, mime: att.mime };
        } catch {
          /* 첨부 없음 — 링크만 표시 */
        }
      }
      setAttachmentUrls(urls);
    } catch (e) {
      setNotice(`메모를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [memoId, setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  // 녹음·음성 인식 정리
  useEffect(
    () => () => {
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  function handleApiError(e: unknown, fallback: string) {
    const code = (e as { code?: string }).code;
    if (code === TOKEN_EXPIRED_CODE) {
      setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      onNeedLogin();
    } else {
      setNotice(`${fallback}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleTitleBlur() {
    if (!memo || title === memo.title) return;
    try {
      await api.memos.update(memoId, { title });
      setMemo({ ...memo, title });
    } catch (e) {
      handleApiError(e, "제목 저장 실패");
    }
  }

  async function handleBlockText(block: Block, text: string) {
    setMemo((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === block.id ? { ...b, text } : b)) } : prev,
    );
    try {
      await api.blocks.update(block.id, { text });
    } catch (e) {
      handleApiError(e, "블록 저장 실패");
    }
  }

  async function handleBlockChecked(block: Block, checked: boolean) {
    setMemo((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === block.id ? { ...b, checked: checked ? 1 : 0 } : b)) } : prev,
    );
    try {
      await api.blocks.update(block.id, { checked: checked ? 1 : 0 });
    } catch (e) {
      handleApiError(e, "체크 저장 실패");
    }
  }

  async function handleBlockDueDate(block: Block, dueDate: string) {
    setMemo((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === block.id ? { ...b, dueDate: dueDate || null } : b)) } : prev,
    );
    try {
      await api.blocks.update(block.id, { dueDate: dueDate || null });
    } catch (e) {
      handleApiError(e, "마감일 저장 실패");
    }
  }

  async function handleAddBlock(type: Block["type"], text?: string) {
    try {
      await api.memos.addBlock(memoId, { type, text });
      await load();
    } catch (e) {
      handleApiError(e, "블록 추가 실패");
    }
  }

  async function handleMoveBlock(block: Block, dir: -1 | 1) {
    if (!memo) return;
    const sorted = [...memo.blocks].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((b) => b.id === block.id);
    const other = sorted[idx + dir];
    if (!other) return;
    try {
      await Promise.all([
        api.blocks.update(block.id, { position: other.position }),
        api.blocks.update(other.id, { position: block.position }),
      ]);
      await load();
    } catch (e) {
      handleApiError(e, "블록 이동 실패");
    }
  }

  async function handleRemoveBlock(block: Block) {
    try {
      await api.blocks.remove(block.id);
      await load();
    } catch (e) {
      handleApiError(e, "블록 삭제 실패");
    }
  }

  async function handleTogglePin() {
    if (!memo) return;
    const pinned = memo.pinned !== 1;
    try {
      await api.memos.update(memoId, { pinned });
      setMemo({ ...memo, pinned: pinned ? 1 : 0 });
    } catch (e) {
      handleApiError(e, "고정 저장 실패");
    }
  }

  async function handleDeleteMemo() {
    try {
      await api.memos.remove(memoId);
      setNotice("메모를 삭제했습니다.");
      onBack();
    } catch (e) {
      handleApiError(e, "메모 삭제 실패");
    }
  }

  /** 빈 새 메모면 닫을 때 자동 삭제 (원본 규칙). */
  async function handleBack() {
    if (memo) {
      const empty =
        title.trim() === "" &&
        memo.blocks.every((b) => b.text.trim() === "" && !b.attachmentId) &&
        memo.keywords.length === 0 &&
        memo.people.length === 0 &&
        memo.places.length === 0 &&
        memo.locations.length === 0 &&
        !memo.event;
      if (empty) {
        try {
          await api.memos.remove(memoId);
          setNotice("빈 메모를 삭제했습니다.");
        } catch {
          /* 삭제 실패해도 그냥 나감 */
        }
      }
    }
    onBack();
  }

  async function handleExtractKeywords() {
    setExtracting(true);
    try {
      const { keywords } = await api.memos.extractKeywords(memoId);
      setNotice(keywords.length > 0 ? `키워드 추출: ${keywords.join(", ")}` : "추출된 키워드가 없습니다.");
      await load();
    } catch (e) {
      handleApiError(e, "키워드 추출 실패");
    } finally {
      setExtracting(false);
    }
  }

  async function handleAddKeyword() {
    const name = newKeyword.trim();
    if (!name) return;
    try {
      await api.memos.addKeyword(memoId, name);
      setNewKeyword("");
      await load();
    } catch (e) {
      handleApiError(e, "키워드 추가 실패");
    }
  }

  async function handleRemoveKeyword(keywordId: string) {
    try {
      await api.memos.removeKeyword(memoId, keywordId);
      await load();
    } catch (e) {
      handleApiError(e, "키워드 삭제 실패");
    }
  }

  async function handlePushToDrive() {
    setPushing(true);
    try {
      const result = await api.drive.pushMemo(memoId);
      setNotice(`Drive에 저장했습니다. 파일 ID: ${result.driveFileId ?? "(없음)"}`);
      await load();
    } catch (e) {
      handleApiError(e, "Drive 저장 실패");
    } finally {
      setPushing(false);
    }
  }

  // ---- 사진 첨부 ----
  async function handlePhotoFile(file: File) {
    setUploading(true);
    try {
      const { id } = await api.memos.addBlock(memoId, { type: "photo" });
      const uploaded = await api.attachments.upload(memoId, file);
      await api.blocks.update(id, { attachmentId: uploaded.id });
      setAttachmentUrls((prev) => ({ ...prev, [id]: { url: uploaded.url, mime: file.type } }));
      await load();
      setNotice("사진을 첨부했습니다.");
    } catch (e) {
      handleApiError(e, "사진 첨부 실패");
    } finally {
      setUploading(false);
    }
  }

  // ---- 음성: 녹음 → 음성 블록 ----
  async function handleRecordToggle() {
    if (recording) {
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void (async () => {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          if (blob.size === 0) return;
          const file = new File([blob], `음성메모-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`, {
            type: blob.type,
          });
          setUploading(true);
          try {
            const { id } = await api.memos.addBlock(memoId, { type: "voice" });
            const uploaded = await api.attachments.upload(memoId, file);
            await api.blocks.update(id, { attachmentId: uploaded.id });
            setAttachmentUrls((prev) => ({ ...prev, [id]: { url: uploaded.url, mime: file.type } }));
            await load();
            setNotice("음성메모를 저장했습니다.");
          } catch (e) {
            handleApiError(e, "음성 저장 실패");
          } finally {
            setUploading(false);
          }
        })();
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setNotice("마이크를 사용할 수 없습니다. 브라우저 마이크 권한을 확인해주세요.");
    }
  }

  // ---- 음성: 말해서 단락 추가 (Web Speech API, ko-KR) ----
  function handleSpeechToggle() {
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setNotice("이 브라우저는 음성 인식을 지원하지 않습니다. 크롬에서 시도해주세요.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) void handleAddBlock("paragraph", text);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error !== "aborted") setNotice(`음성 인식 실패: ${e.error ?? "알 수 없음"}`);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setNotice("음성 인식을 시작할 수 없습니다.");
    }
  }

  // ---- 일정 ----
  async function handleCreateEvent() {
    if (!memo) return;
    setCreatingEvent(true);
    try {
      const start = eventAllDay ? eventDate : `${eventDate}T${eventStart}:00`;
      const end = eventAllDay ? eventDate : `${eventDate}T${eventEnd}:00`;
      await api.calendar.createEvent({
        memoId,
        title: title.trim() || "(제목 없음)",
        start,
        end,
        allDay: eventAllDay,
        description: "나이테 메모에서 만든 일정입니다.",
      });
      setNotice("캘린더에 일정을 만들었습니다.");
      setScheduleOpen(false);
      await load();
    } catch (e) {
      handleApiError(e, "일정 만들기 실패");
    } finally {
      setCreatingEvent(false);
    }
  }

  async function handleTaskSync(block: Block) {
    try {
      await api.tasks.sync(block.id);
      setNotice("Google Tasks와 동기화했습니다.");
    } catch (e) {
      handleApiError(e, "Tasks 동기화 실패");
    }
  }

  // ---- 사람·장소 연결 ----
  async function handlePersonSearch() {
    if (!personQuery.trim()) return;
    setPersonSearching(true);
    try {
      const { candidates } = await api.people.search(personQuery.trim());
      setPersonCandidates(candidates);
    } catch (e) {
      handleApiError(e, "연락처 검색 실패");
    } finally {
      setPersonSearching(false);
    }
  }

  async function handleLinkPerson(c: PeopleCandidate) {
    try {
      const { id } = await api.people.create({
        name: c.name,
        email: c.email || undefined,
        phone: c.phone || undefined,
        googleResourceName: c.googleResourceName || undefined,
      });
      await api.memos.linkPerson(memoId, id);
      setPersonCandidates([]);
      setPersonQuery("");
      await load();
    } catch (e) {
      handleApiError(e, "사람 연결 실패");
    }
  }

  async function handleUnlinkPerson(personId: string) {
    try {
      await api.memos.unlinkPerson(memoId, personId);
      await load();
    } catch (e) {
      handleApiError(e, "사람 연결 해제 실패");
    }
  }

  async function handlePlaceSearch() {
    if (!placeQuery.trim()) return;
    setPlaceSearching(true);
    setPlaceStatus(null);
    try {
      const res = await api.places.search(placeQuery.trim());
      setPlaceCandidates(res.candidates);
      if (res.status === "MAPS_KEY_NOT_CONFIGURED") {
        setPlaceStatus("장소 검색은 Google Maps API 키가 필요합니다. 이름만 직접 추가할 수 있습니다.");
      }
    } catch (e) {
      handleApiError(e, "장소 검색 실패");
    } finally {
      setPlaceSearching(false);
    }
  }

  async function handleLinkPlace(c: PlaceCandidate) {
    try {
      const { id } = await api.places.create({
        name: c.name,
        address: c.address ?? undefined,
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
      });
      await api.memos.linkPlace(memoId, id);
      setPlaceCandidates([]);
      setPlaceQuery("");
      await load();
    } catch (e) {
      handleApiError(e, "장소 연결 실패");
    }
  }

  async function handleAddPlaceByName() {
    const name = placeQuery.trim();
    if (!name) return;
    try {
      const { id } = await api.places.create({ name });
      await api.memos.linkPlace(memoId, id);
      setPlaceQuery("");
      await load();
    } catch (e) {
      handleApiError(e, "장소 추가 실패");
    }
  }

  async function handleUnlinkPlace(placeId: string) {
    try {
      await api.memos.unlinkPlace(memoId, placeId);
      await load();
    } catch (e) {
      handleApiError(e, "장소 연결 해제 실패");
    }
  }

  // ---- 현재 위치 ----
  function handleSetGeo() {
    if (!navigator.geolocation) {
      setNotice("이 브라우저는 위치를 지원하지 않습니다.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void (async () => {
          try {
            await api.memos.setGeo(memoId, { lat: pos.coords.latitude, lng: pos.coords.longitude });
            setNotice("현재 위치를 메모에 저장했습니다.");
            await load();
          } catch (e) {
            handleApiError(e, "위치 저장 실패");
          } finally {
            setLocating(false);
          }
        })();
      },
      () => {
        setLocating(false);
        setNotice("위치를 가져오지 못했습니다. 위치 권한을 확인해주세요.");
      },
      { timeout: 10000 },
    );
  }

  async function handleClearGeo() {
    try {
      await api.memos.clearGeo(memoId);
      await load();
    } catch (e) {
      handleApiError(e, "위치 지우기 실패");
    }
  }

  // ---- 가져오기 ----
  async function handleImport() {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      await api.memos.importText(memoId, importText, importFormat);
      setImportText("");
      setImportOpen(false);
      setNotice("가져오기를 마쳤습니다.");
      await load();
    } catch (e) {
      handleApiError(e, "가져오기 실패");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      setImportText(text);
      setImportFormat(/\.html?$/i.test(file.name) ? "html" : "markdown");
    } catch {
      setNotice("파일을 읽지 못했습니다.");
    }
  }

  if (!memo) return <p className="meta">메모를 불러오는 중…</p>;
  const sortedBlocks = [...memo.blocks].sort((a, b) => a.position - b.position);

  return (
    <div className="editor" style={memo.color ? { background: memo.color } : undefined}>
      <div className="toolbar">
        <button onClick={() => void handleBack()}>← 목록으로</button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          aria-pressed={preview}
        >
          {preview ? "쓰기" : "미리보기"}
        </button>
        <button type="button" onClick={() => void handleTogglePin()} aria-pressed={memo.pinned === 1}>
          {memo.pinned === 1 ? "📌 고정됨" : "📍 고정"}
        </button>
        <button type="button" onClick={() => setImportOpen(true)}>
          가져오기
        </button>
        {deleteConfirm ? (
          <>
            <button type="button" onClick={() => void handleDeleteMemo()}>
              정말 삭제
            </button>
            <button type="button" onClick={() => setDeleteConfirm(false)}>
              취소
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setDeleteConfirm(true)}>
            삭제
          </button>
        )}
      </div>

      <input
        className="memo-title-input"
        placeholder="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void handleTitleBlur()}
      />

      <div className="blocks">
        {sortedBlocks.map((block) => (
          <div key={block.id} className="block">
            <div className="block-controls">
              <button type="button" aria-label="위로" onClick={() => void handleMoveBlock(block, -1)}>
                ↑
              </button>
              <button type="button" aria-label="아래로" onClick={() => void handleMoveBlock(block, 1)}>
                ↓
              </button>
              <button type="button" aria-label="삭제" onClick={() => void handleRemoveBlock(block)}>
                ✕
              </button>
            </div>
            {block.type === "todo" ? (
              <div className="todo-block">
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
                <input
                  type="date"
                  value={block.dueDate ?? ""}
                  title="마감일"
                  onChange={(e) => void handleBlockDueDate(block, e.target.value)}
                />
                <button
                  type="button"
                  title="Google Tasks와 동기화"
                  onClick={() => void handleTaskSync(block)}
                >
                  ↻ Tasks
                </button>
              </div>
            ) : block.type === "photo" ? (
              <div className="photo-block">
                {attachmentUrls[block.id] ? (
                  <img src={attachmentUrls[block.id].url} alt="첨부 사진" className="block-photo" />
                ) : (
                  <p className="meta">사진 첨부 (Drive 링크를 불러오지 못했습니다)</p>
                )}
              </div>
            ) : block.type === "voice" ? (
              <div className="voice-block">
                {attachmentUrls[block.id] ? (
                  <audio controls src={attachmentUrls[block.id].url} preload="none" />
                ) : (
                  <p className="meta">음성메모 (Drive 링크를 불러오지 못했습니다)</p>
                )}
                {block.text ? <p>{block.text}</p> : null}
              </div>
            ) : block.type === "schedule" ? (
              <div className="schedule-block">
                {memo.event ? (
                  <p className="meta">
                    📅 {new Date(memo.event.startAt).toLocaleString("ko-KR")}~
                    {new Date(memo.event.endAt).toLocaleString("ko-KR")}
                    {memo.event.allDay === 1 ? " (종일)" : ""}
                  </p>
                ) : (
                  <p className="meta">일정 블록 — 아래 일정 패널에서 일정을 만드세요.</p>
                )}
              </div>
            ) : preview ? (
              <div
                className="paragraph-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdownLite(block.text) || "&nbsp;" }}
              />
            ) : (
              <textarea
                value={block.text}
                placeholder="단락 (새 메모는 제목 밑 단락이 기본입니다)"
                rows={3}
                onChange={(e) => void handleBlockText(block, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {/* 하단 아이콘 도구 모음 (원본: 단락·체크리스트·사진·음성메모·일정) */}
      <div className="toolbar editor-toolbar" role="toolbar" aria-label="블록 추가">
        <button type="button" onClick={() => void handleAddBlock("paragraph")} title="단락 추가">
          ¶ 단락
        </button>
        <button type="button" onClick={() => void handleAddBlock("todo")} title="체크리스트 추가">
          ☑ 체크리스트
        </button>
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={uploading}
          title="사진 첨부"
        >
          🖼 사진
        </button>
        <button type="button" onClick={() => setVoiceOpen((v) => !v)} title="음성메모">
          🎙 음성메모
        </button>
        <button type="button" onClick={() => setScheduleOpen((v) => !v)} title="일정 추가">
          📅 일정
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handlePhotoFile(f);
          }}
        />
      </div>

      {voiceOpen ? (
        <section className="card voice-panel">
          <h3>음성메모</h3>
          <div className="toolbar">
            <button type="button" onClick={() => void handleRecordToggle()} disabled={uploading}>
              {recording ? "⏹ 녹음 중지" : "● 녹음 시작"}
            </button>
            <button type="button" onClick={() => handleSpeechToggle()}>
              {listening ? "음성 인식 중지" : "🎤 말해서 단락 추가"}
            </button>
          </div>
          <p className="meta">
            녹음은 Drive memo 폴더에 음성 파일로 저장돼 음성 블록이 됩니다. 말해서 입력은
            한국어 음성을 텍스트 단락으로 바꿉니다 (크롬 권장).
          </p>
        </section>
      ) : null}

      {scheduleOpen ? (
        <section className="card schedule-panel">
          <h3>일정 추가</h3>
          {memo.event ? (
            <p className="meta">
              이 메모의 일정: {new Date(memo.event.startAt).toLocaleString("ko-KR")}~
              {new Date(memo.event.endAt).toLocaleString("ko-KR")}
              {memo.event.allDay === 1 ? " (종일)" : ""}
              <br />
              (일정 삭제는 캘린더에서 직접 해주세요.)
            </p>
          ) : null}
          <div className="toolbar">
            <label>
              날짜{" "}
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={eventAllDay}
                onChange={(e) => setEventAllDay(e.target.checked)}
              />{" "}
              종일
            </label>
            {!eventAllDay ? (
              <>
                <label>
                  시작{" "}
                  <input type="time" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
                </label>
                <label>
                  종료{" "}
                  <input type="time" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
                </label>
              </>
            ) : null}
            <button type="button" onClick={() => void handleCreateEvent()} disabled={creatingEvent}>
              {creatingEvent ? "만드는 중…" : "캘린더에 만들기"}
            </button>
          </div>
        </section>
      ) : null}

      {/* 푸터 메타데이터 */}
      <section className="card editor-meta">
        <h3>키워드</h3>
        <div className="chip-row">
          {memo.keywords.map((k) => (
            <span key={k.id} className="chip">
              {k.name}{" "}
              <button type="button" aria-label={`${k.name} 삭제`} onClick={() => void handleRemoveKeyword(k.id)}>
                ✕
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="키워드 추가"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddKeyword();
            }}
          />
          <button type="button" onClick={() => void handleAddKeyword()}>
            추가
          </button>
          <button type="button" onClick={() => void handleExtractKeywords()} disabled={extracting}>
            {extracting ? "추출 중…" : "키워드 자동 추출"}
          </button>
        </div>
        <p className="meta">키워드는 본문 블록이 아니라 메타데이터로만 저장됩니다.</p>

        <h3>사람</h3>
        <div className="chip-row">
          {memo.people.map((p) => (
            <span key={p.id} className="chip">
              👤 {p.name}{" "}
              <button type="button" aria-label={`${p.name} 연결 해제`} onClick={() => void handleUnlinkPerson(p.id)}>
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="toolbar">
          <input
            type="search"
            placeholder="연락처 검색 (이름·이메일)"
            value={personQuery}
            onChange={(e) => setPersonQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handlePersonSearch();
            }}
          />
          <button type="button" onClick={() => void handlePersonSearch()} disabled={personSearching}>
            검색
          </button>
        </div>
        {personCandidates.map((c) => (
          <p key={c.googleResourceName || c.name} className="meta">
            {c.name}
            {c.email ? ` · ${c.email}` : ""}{" "}
            <button type="button" onClick={() => void handleLinkPerson(c)}>
              연결
            </button>
          </p>
        ))}
        <p className="meta">연락처 전체를 가져오지 않고, 검색해서 찾은 사람만 연결합니다.</p>

        <h3>장소</h3>
        <div className="chip-row">
          {memo.places.map((p) => (
            <span key={p.id} className="chip">
              📍 {p.name}{" "}
              <button type="button" aria-label={`${p.name} 연결 해제`} onClick={() => void handleUnlinkPlace(p.id)}>
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="toolbar">
          <input
            type="search"
            placeholder="장소 검색"
            value={placeQuery}
            onChange={(e) => setPlaceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handlePlaceSearch();
            }}
          />
          <button type="button" onClick={() => void handlePlaceSearch()} disabled={placeSearching}>
            검색
          </button>
          <button type="button" onClick={() => void handleAddPlaceByName()}>
            이름만 추가
          </button>
        </div>
        {placeStatus ? <p className="notice">{placeStatus}</p> : null}
        {placeCandidates.map((c) => (
          <p key={`${c.name}-${c.lat ?? ""}-${c.lng ?? ""}`} className="meta">
            {c.name}
            {c.address ? ` · ${c.address}` : ""}{" "}
            <button type="button" onClick={() => void handleLinkPlace(c)}>
              연결
            </button>
          </p>
        ))}

        <h3>현재 위치</h3>
        {memo.locations.length > 0 ? (
          <div className="chip-row">
            {memo.locations.map((l) => (
              <span key={l.id} className="chip">
                ◎ {l.name}
              </span>
            ))}
            <button type="button" onClick={() => void handleClearGeo()}>
              위치 지우기
            </button>
          </div>
        ) : (
          <p className="meta">위치 없음</p>
        )}
        <div className="toolbar">
          <button type="button" onClick={() => handleSetGeo()} disabled={locating}>
            {locating ? "위치 확인 중…" : "현재 위치 저장"}
          </button>
        </div>
        <p className="meta">위치는 버튼을 눌렀을 때만 저장합니다. 좌표가 불확실하면 비워 둡니다.</p>

        <h3>카테고리·카드 색상</h3>
        <div className="toolbar">
          <label>
            카테고리{" "}
            <select
              value={memo.categoryId ?? ""}
              onChange={(e) => {
                const categoryId = e.target.value || null;
                void (async () => {
                  try {
                    await api.memos.update(memoId, { categoryId });
                    await load();
                  } catch (err) {
                    handleApiError(err, "카테고리 저장 실패");
                  }
                })();
              }}
            >
              <option value="">미분류</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <span className="meta">카드 색상</span>
          {CARD_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={`카드 색상 ${c.label}`}
              aria-pressed={memo.color === c.value}
              onClick={() => {
                void (async () => {
                  try {
                    await api.memos.update(memoId, { color: c.value });
                    setMemo((prev) => (prev ? { ...prev, color: c.value } : prev));
                  } catch (err) {
                    handleApiError(err, "색상 저장 실패");
                  }
                })();
              }}
              style={{
                background: c.value,
                width: 24,
                height: 24,
                borderRadius: "50%",
                border: memo.color === c.value ? "2px solid #e8590c" : "1px solid #ccc",
              }}
            />
          ))}
        </div>
      </section>

      <div className="toolbar">
        <button onClick={() => void handlePushToDrive()} disabled={pushing}>
          {pushing ? "저장 중…" : "Drive에 저장"}
        </button>
        <button onClick={() => void handleBack()}>완료</button>
      </div>
      <p className="meta">Drive 파일: {memo.driveFileId ?? "아직 Drive에 저장되지 않음 (로컬에만 있음)"}</p>

      {importOpen ? (
        <div className="modal" role="dialog" aria-label="가져오기">
          <div className="modal-card">
            <h3>마크다운·HTML 가져오기</h3>
            <div className="toolbar">
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
              >
                파일 선택 (.md / .txt / .html)
              </button>
              <label>
                형식{" "}
                <select
                  value={importFormat}
                  onChange={(e) => setImportFormat(e.target.value as "markdown" | "html")}
                >
                  <option value="markdown">마크다운</option>
                  <option value="html">HTML</option>
                </select>
              </label>
              <input
                ref={importFileRef}
                type="file"
                accept=".md,.txt,.html,.htm"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleImportFile(f);
                }}
              />
            </div>
            <textarea
              rows={10}
              placeholder="여기에 마크다운 또는 HTML을 붙여넣으세요. 제목·단락·할 일로 변환됩니다."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="toolbar">
              <button type="button" onClick={() => void handleImport()} disabled={importing || !importText.trim()}>
                {importing ? "가져오는 중…" : "가져오기"}
              </button>
              <button type="button" onClick={() => setImportOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
