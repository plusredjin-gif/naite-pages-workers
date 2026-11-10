/**
 * 나이테 Pages-only — 사람 뷰
 *
 * 기능: Google 연락처 검색 → 등록, 이름 직접 추가, 등록된 사람 목록·삭제,
 * 사람별 연결된 메모 목록.
 * jin 결정: '연락처 불러오기' 일괄 가져오기는 없다. 검색해서 등록한 사람만 기록한다.
 * 데이터는 api.people.* / api.memos.* (브라우저 로컬 저장소 + People API 직접 호출).
 * 목업·가짜 데이터 없음.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type MemoPreview } from "../api";
import { Teapot } from "../components/Logo";
import "./PeopleView.css";

type Person = Awaited<ReturnType<typeof api.people.list>>["people"][number];
type PeopleCandidate = Awaited<ReturnType<typeof api.people.search>>["candidates"][number];

type LinkedMemo = Pick<MemoPreview, "id" | "title" | "updatedAt">;

const TOKEN_EXPIRED = "TOKEN_EXPIRED_RELOGIN_REQUIRED";

export function PeopleView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
}) {
  const { onOpen, setNotice } = props;
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PeopleCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkedMemos, setLinkedMemos] = useState<LinkedMemo[]>([]);
  const [memosLoading, setMemosLoading] = useState(false);
  const [memosTruncated, setMemosTruncated] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { people: list } = await api.people.list();
      setPeople(list);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setLoadError(`사람 목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const loadLinkedMemos = useCallback(
    async (personId: string) => {
      setMemosLoading(true);
      setLinkedMemos([]);
      setMemosTruncated(false);
      try {
        const { memos, total } = await api.memos.list({ limit: 100 });
        setMemosTruncated(total > memos.length);
        const details = await Promise.all(memos.map((m) => api.memos.get(m.id)));
        setLinkedMemos(
          details
            .filter((d) => d.people.some((p) => p.id === personId))
            .map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt })),
        );
      } catch (e) {
        if ((e as { code?: string }).code === TOKEN_EXPIRED) {
          setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        } else {
          setNotice(`연결된 메모를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        setMemosLoading(false);
      }
    },
    [setNotice],
  );

  function handleSelectPerson(personId: string) {
    setSelectedId(personId);
    void loadLinkedMemos(personId);
  }

  function isRegistered(c: PeopleCandidate): boolean {
    return people.some(
      (p) =>
        (c.googleResourceName !== "" && p.googleResourceName === c.googleResourceName) ||
        (c.email !== "" && p.email !== null && p.email === c.email),
    );
  }

  async function handleSearch() {
    if (!query.trim()) {
      setNotice("검색할 이름 또는 이메일을 입력하세요.");
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      const { candidates: found } = await api.people.search(query.trim());
      setCandidates(found);
      setSearched(true);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`연락처 검색에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleRegister(c: PeopleCandidate) {
    const key = c.googleResourceName || `${c.name}|${c.email}`;
    setRegistering(key);
    setNotice(null);
    try {
      const { id } = await api.people.create({
        name: c.name,
        email: c.email !== "" ? c.email : undefined,
        phone: c.phone !== "" ? c.phone : undefined,
        googleResourceName: c.googleResourceName !== "" ? c.googleResourceName : undefined,
      });
      await loadPeople();
      setNotice(`'${c.name}'님을 등록했습니다.`);
      void id;
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`등록에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setRegistering(null);
    }
  }

  async function handleAddPerson() {
    if (!newName.trim()) {
      setNotice("이름을 입력하세요.");
      return;
    }
    setAdding(true);
    setNotice(null);
    try {
      await api.people.create({
        name: newName.trim(),
        email: newEmail.trim() !== "" ? newEmail.trim() : undefined,
        phone: newPhone.trim() !== "" ? newPhone.trim() : undefined,
      });
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      await loadPeople();
      setNotice("사람을 추가했습니다.");
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`추가에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemovePerson(person: Person) {
    if (!window.confirm(`'${person.name}'님을 삭제할까요? 메모와의 연결도 함께 지워집니다.`)) return;
    setRemovingId(person.id);
    setNotice(null);
    try {
      await api.people.remove(person.id);
      if (selectedId === person.id) {
        setSelectedId(null);
        setLinkedMemos([]);
      }
      await loadPeople();
      setNotice(`'${person.name}'님을 삭제했습니다.`);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`삭제에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setRemovingId(null);
    }
  }

  async function handleUnlinkMemo(memoId: string, personId: string) {
    setUnlinkingId(memoId);
    try {
      await api.memos.unlinkPerson(memoId, personId);
      await loadLinkedMemos(personId);
      await loadPeople();
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`연결 해제에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setUnlinkingId(null);
    }
  }

  const selected = people.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <h2>사람</h2>

      <section className="card">
        <h3>연락처에서 사람 찾기</h3>
        <p className="meta">이름이나 이메일로 Google 연락처를 검색해 등록합니다. 전체 연락처를 불러오지는 않습니다.</p>
        <div className="toolbar">
          <input
            type="search"
            placeholder="이름 또는 이메일"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSearch();
            }}
          />
          <button onClick={() => void handleSearch()} disabled={searching}>
            {searching ? "검색 중…" : "검색"}
          </button>
        </div>
        {searching ? <p className="meta">연락처를 검색하는 중…</p> : null}
        {searched && !searching && candidates.length === 0 ? (
          <p className="meta">검색 결과가 없습니다. 다른 이름이나 이메일로 검색해보세요.</p>
        ) : null}
        <ul className="people-list">
          {candidates.map((c) => {
            const key = c.googleResourceName || `${c.name}|${c.email}`;
            const registered = isRegistered(c);
            return (
              <li key={key} className="people-row">
                <span className="people-name">{c.name}</span>
                <span className="meta">
                  {[c.email, c.phone].filter((v) => v !== "").join(" · ") || "연락처 정보 없음"}
                </span>
                {registered ? (
                  <span className="chip">등록됨</span>
                ) : (
                  <button disabled={registering === key} onClick={() => void handleRegister(c)}>
                    {registering === key ? "등록 중…" : "등록"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h3>이름 직접 추가</h3>
        <div className="toolbar">
          <input
            type="text"
            placeholder="이름 *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="email"
            placeholder="이메일 (선택)"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input
            type="tel"
            placeholder="전화 (선택)"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
          />
          <button onClick={() => void handleAddPerson()} disabled={adding}>
            {adding ? "추가 중…" : "추가"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>등록한 사람</h3>
        {loading ? (
          <p className="meta">사람 목록을 불러오는 중…</p>
        ) : loadError ? (
          <p className="notice">{loadError}</p>
        ) : people.length === 0 ? (
          <div className="empty-state">
            <Teapot />
            <p>등록된 사람이 없습니다. 연락처에서 검색해 등록하거나 이름을 직접 추가하세요.</p>
          </div>
        ) : (
          <ul className="people-list">
            {people.map((p) => (
              <li key={p.id} className={`people-row ${selectedId === p.id ? "selected" : ""}`}>
                <button className="people-select" onClick={() => handleSelectPerson(p.id)}>
                  <span className="people-name">{p.name}</span>
                  <span className="meta">
                    {[p.email, p.phone].filter((v): v is string => v !== null && v !== "").join(" · ") ||
                      "연락처 정보 없음"}
                  </span>
                  <span className="meta">연결된 메모 {p.memoCount}개</span>
                </button>
                <button
                  disabled={removingId === p.id}
                  onClick={() => void handleRemovePerson(p)}
                >
                  {removingId === p.id ? "삭제 중…" : "삭제"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="card">
          <h3>{selected.name}님의 메모</h3>
          <dl className="kv">
            <dt>이메일</dt>
            <dd>{selected.email ?? "없음"}</dd>
            <dt>전화</dt>
            <dd>{selected.phone ?? "없음"}</dd>
            <dt>연결된 메모</dt>
            <dd>{selected.memoCount}개</dd>
          </dl>
          {memosLoading ? (
            <p className="meta">연결된 메모를 불러오는 중…</p>
          ) : linkedMemos.length === 0 ? (
            <div className="empty-state">
              <Teapot />
              <p>이 사람과 연결된 메모가 없습니다.</p>
            </div>
          ) : (
            <ul className="memo-list">
              {linkedMemos.map((m) => (
                <li key={m.id} className="people-memo-row">
                  <button className="memo-item" onClick={() => onOpen(m.id)}>
                    <span className="memo-title">{m.title || "(제목 없음)"}</span>
                    <span className="memo-date">{new Date(m.updatedAt).toLocaleString("ko-KR")}</span>
                  </button>
                  <button
                    disabled={unlinkingId === m.id}
                    onClick={() => void handleUnlinkMemo(m.id, selected.id)}
                  >
                    {unlinkingId === m.id ? "해제 중…" : "연결 해제"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {memosTruncated ? (
            <p className="meta">메모가 많아 100개까지만 확인했습니다.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
