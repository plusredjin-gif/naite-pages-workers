/**
 * 나이테 Pages-only — 일정(캘린더·할일) 뷰
 *
 * 기능:
 *  - Google 캘린더 30일 일정(api.calendar.agenda)을 날짜별로 그룹지어 표시.
 *    메모에서 만든 일정은 "메모" 배지를 달고, 누르면 해당 메모를 연다.
 *  - 일정 만들기 폼: 제목·날짜·시간·종일 여부·메모 연결(선택) →
 *    api.calendar.createEvent 호출 후 목록 새로고침.
 *  - Google 할일 '나이테 메모' 목록(api.tasks.list) 조회: 완료 여부·마감일 표시.
 *    동기화는 수동이다 (Pages-only에는 백그라운드 동기화가 없음).
 *    메모 체크리스트 블록 동기화(api.tasks.sync)는 편집기에서 하므로
 *    이 화면에서는 할일 목록 조회만 한다.
 *
 * 데이터는 api.* 실호출만 쓴다 (목업·가짜 데이터 없음).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import { Teapot } from "../components/Logo";
import "./ScheduleView.css";

const TOKEN_EXPIRED_CODE = "TOKEN_EXPIRED_RELOGIN_REQUIRED";
const AGENDA_DAYS = 30;

type AgendaEvent = Awaited<ReturnType<typeof api.calendar.agenda>>["events"][number];
type TaskItem = Awaited<ReturnType<typeof api.tasks.list>>["tasks"][number];
type MemoOption = Awaited<ReturnType<typeof api.memos.list>>["memos"][number];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayKey(): string {
  return toDateKey(new Date());
}

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** ISO 시작값을 로컬 날짜 키(YYYY-MM-DD)로 바꾼다. 종일 일정은 날짜 그대로 쓴다. */
function localDateKey(iso: string): string {
  if (DATE_ONLY.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : toDateKey(d);
}

function isAllDayEvent(ev: AgendaEvent): boolean {
  return DATE_ONLY.test(ev.start) && DATE_ONLY.test(ev.end);
}

function formatDayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
}

function formatEventTime(ev: AgendaEvent): string {
  if (isAllDayEvent(ev)) return "종일";
  const start = new Date(ev.start);
  if (Number.isNaN(start.getTime())) return ev.start;
  const startText = start.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const end = new Date(ev.end);
  if (!Number.isNaN(end.getTime()) && ev.end && ev.end !== ev.start) {
    return `${startText} – ${end.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return startText;
}

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

export function ScheduleView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
  onNeedLogin: () => void;
}) {
  const { onOpen, setNotice, onNeedLogin } = props;

  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [memoOptions, setMemoOptions] = useState<MemoOption[]>([]);
  const [loadingAgenda, setLoadingAgenda] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [agendaError, setAgendaError] = useState(false);
  const [tasksError, setTasksError] = useState(false);
  const [creating, setCreating] = useState(false);

  // 일정 만들기 폼
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayKey());
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  /** 팝업 알림 ("" = 없음). 원본 memoaeb의 "알림"과 동일. */
  const [reminder, setReminder] = useState("");
  const [memoId, setMemoId] = useState("");
  /** 삭제 확인 2단계: 삭제 버튼을 한 번 누르면 이 일정만 확인 상태가 된다. */
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const handleError = useCallback(
    (e: unknown, fallback: string) => {
      if ((e as { code?: string }).code === TOKEN_EXPIRED_CODE) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`${fallback}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [setNotice, onNeedLogin],
  );

  const loadAgenda = useCallback(async () => {
    setLoadingAgenda(true);
    setAgendaError(false);
    try {
      const result = await api.calendar.agenda(AGENDA_DAYS);
      setEvents(result.events);
    } catch (e) {
      setAgendaError(true);
      handleError(e, "일정을 불러오지 못했습니다");
    } finally {
      setLoadingAgenda(false);
    }
  }, [handleError]);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    setTasksError(false);
    try {
      const result = await api.tasks.list();
      setTasks(result.tasks);
    } catch (e) {
      setTasksError(true);
      handleError(e, "할일을 불러오지 못했습니다");
    } finally {
      setLoadingTasks(false);
    }
  }, [handleError]);

  const loadMemoOptions = useCallback(async () => {
    try {
      const result = await api.memos.list({ limit: 30 });
      setMemoOptions(result.memos);
    } catch (e) {
      setNotice(`메모 목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [setNotice]);

  useEffect(() => {
    void loadAgenda();
    void loadTasks();
    void loadMemoOptions();
  }, [loadAgenda, loadTasks, loadMemoOptions]);

  /** 일정을 날짜별로 그룹지어 오름차순으로 정렬한다. */
  const groupedEvents = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const ev of events) {
      const key = localDateKey(ev.start);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [events]);

  /** 할일: 미완료 먼저, 마감일 오름차순 (마감일 없음은 뒤로). */
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    });
  }, [tasks]);

  const incompleteCount = useMemo(() => tasks.filter((t) => !t.completed).length, [tasks]);

  /** 하위 할일(Google Tasks subtask)은 상위 할일 바로 아래에 들여쓰기로 묶는다. */
  const taskTree = useMemo(() => {
    const byParent = new Map<string, TaskItem[]>();
    for (const t of sortedTasks) {
      if (t.parent) {
        const list = byParent.get(t.parent) ?? [];
        list.push(t);
        byParent.set(t.parent, list);
      }
    }
    const top = sortedTasks.filter((t) => !t.parent);
    return { top, byParent };
  }, [sortedTasks]);

  async function handleRefresh() {
    setNotice(null);
    await Promise.all([loadAgenda(), loadTasks()]);
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setNotice("일정 제목을 입력하세요.");
      return;
    }
    if (!date) {
      setNotice("날짜를 선택하세요.");
      return;
    }
    setCreating(true);
    setNotice(null);
    try {
      let start: string;
      let end: string;
      if (allDay) {
        // 종일 일정: Google은 종료일을 exclusive로 보므로 다음 날을 넘긴다.
        start = date;
        end = addDaysKey(date, 1);
      } else {
        const startDate = new Date(`${date}T${startTime || "09:00"}:00`);
        if (Number.isNaN(startDate.getTime())) throw new Error("invalid_start");
        let endDate = new Date(`${date}T${endTime || "10:00"}:00`);
        if (Number.isNaN(endDate.getTime()) || endDate <= startDate) {
          endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
        }
        start = startDate.toISOString();
        end = endDate.toISOString();
      }
      await api.calendar.createEvent({
        memoId: memoId || undefined,
        title: title.trim(),
        start,
        end,
        allDay,
        reminderMinutes: reminder === "" ? null : Number(reminder),
      });
      setNotice("일정을 만들었습니다.");
      setTitle("");
      setMemoId("");
      await loadAgenda();
    } catch (err) {
      handleError(err, "일정을 만들지 못했습니다");
    } finally {
      setCreating(false);
    }
  }

  /** 일정 삭제: Google 캘린더에서 지운다. 메모에서 만든 일정이면 연결 기록도 함께 지운다. */
  async function handleDeleteEvent(ev: AgendaEvent) {
    if (!ev.googleEventId) return;
    if (deletingEventId !== ev.googleEventId) {
      setDeletingEventId(ev.googleEventId);
      return;
    }
    setDeletingEventId(null);
    try {
      await api.calendar.deleteEvent(ev.googleEventId, ev.memoId ?? undefined);
      setNotice("일정을 삭제했습니다.");
      await loadAgenda();
    } catch (err) {
      handleError(err, "일정을 삭제하지 못했습니다");
    }
  }

  return (
    <div>
      <div className="toolbar">
        <button onClick={() => void handleRefresh()} disabled={loadingAgenda || loadingTasks}>
          새로고침
        </button>
      </div>
      <p className="meta">오늘부터 {AGENDA_DAYS}일간의 Google 캘린더 일정과 Google 할일 &lsquo;나이테 메모&rsquo; 목록입니다.</p>

      <section className="card">
        <h2>일정 만들기</h2>
        <form className="schedule-form" onSubmit={(e) => void handleCreate(e)}>
          <label>
            제목
            <input
              type="text"
              placeholder="일정 제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <div className="form-row">
            <label>
              날짜
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              종일
            </label>
          </div>
          <div className="form-row">
            <label>
              시작 시간
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={allDay}
              />
            </label>
            <label>
              종료 시간
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={allDay}
              />
            </label>
          </div>
          <label>
            알림
            <select value={reminder} onChange={(e) => setReminder(e.target.value)}>
              <option value="">없음</option>
              <option value="10">10분 전</option>
              <option value="30">30분 전</option>
              <option value="60">1시간 전</option>
              <option value="1440">하루 전</option>
            </select>
          </label>
          <label>
            메모 연결 (선택)
            <select value={memoId} onChange={(e) => setMemoId(e.target.value)}>
              <option value="">연결 안 함</option>
              {memoOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title || "(제목 없음)"}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={creating}>
            {creating ? "만드는 중…" : "일정 만들기"}
          </button>
        </form>
      </section>

      <section>
        <h2>다가오는 일정 ({AGENDA_DAYS}일)</h2>
        {loadingAgenda ? (
          <p className="meta">일정을 불러오는 중…</p>
        ) : agendaError ? (
          <p className="meta">일정을 불러오지 못했습니다. 새로고침을 눌러 다시 시도하세요.</p>
        ) : groupedEvents.length === 0 ? (
          <div className="empty-state">
            <Teapot />
            <p>
              앞으로 {AGENDA_DAYS}일 일정이 없습니다.
              <br />
              위 폼에서 첫 일정을 만들어보세요.
            </p>
          </div>
        ) : (
          groupedEvents.map(([day, dayEvents]) => (
            <div key={day} className="card">
              <h3>{formatDayLabel(day)}</h3>
              <ul className="schedule-day-list">
                {dayEvents.map((ev, i) => (
                  <li
                    key={ev.googleEventId ? `${ev.googleEventId}-${i}` : `${day}-${ev.start}-${i}`}
                    className="schedule-event"
                  >
                    <span className="schedule-time">{formatEventTime(ev)}</span>
                    <span className="schedule-title">{ev.title || "(제목 없음)"}</span>
                    {ev.memoId ? (
                      <button className="chip" onClick={() => onOpen(ev.memoId as string)}>
                        메모
                      </button>
                    ) : null}
                    {ev.googleEventId ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteEvent(ev)}
                        title="이 일정을 삭제합니다"
                      >
                        {deletingEventId === ev.googleEventId ? "정말 삭제" : "삭제"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>Google 할일 — 나이테 메모</h2>
        <p className="meta">
          동기화는 수동입니다. Pages-only에는 백그라운드 동기화가 없어, 메모 체크리스트를
          Google 할일로 보내는 작업은 편집기에서 직접 합니다.
        </p>
        {loadingTasks ? (
          <p className="meta">할일을 불러오는 중…</p>
        ) : tasksError ? (
          <p className="meta">할일을 불러오지 못했습니다. 새로고침을 눌러 다시 시도하세요.</p>
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <Teapot expression="sleepy" />
            <p>할일이 없습니다. 메모의 체크리스트를 편집기에서 Google 할일로 보내보세요.</p>
          </div>
        ) : (
          <>
            <p className="meta">
              할일 {tasks.length}개 · 미완료 {incompleteCount}개
            </p>
            <ul className="task-list">
              {taskTree.top.map((t) => (
                <li key={t.googleTaskId || t.title}>
                  <div className={t.completed ? "task-item task-done" : "task-item"}>
                    <span className="task-check" aria-label={t.completed ? "완료" : "미완료"}>
                      {t.completed ? "✓" : "○"}
                    </span>
                    <span className="task-title">{t.title || "(제목 없음)"}</span>
                    {t.due ? <span className="meta">마감 {formatDue(t.due)}</span> : null}
                    {t.blockId ? <span className="chip">메모 연결</span> : null}
                  </div>
                  {(taskTree.byParent.get(t.googleTaskId) ?? []).map((child) => (
                    <div
                      key={child.googleTaskId || child.title}
                      className={child.completed ? "task-item task-done task-sub" : "task-item task-sub"}
                    >
                      <span className="task-check" aria-label={child.completed ? "완료" : "미완료"}>
                        {child.completed ? "✓" : "○"}
                      </span>
                      <span className="task-title">└ {child.title || "(제목 없음)"}</span>
                      {child.due ? <span className="meta">마감 {formatDue(child.due)}</span> : null}
                      {child.blockId ? <span className="chip">메모 연결</span> : null}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
