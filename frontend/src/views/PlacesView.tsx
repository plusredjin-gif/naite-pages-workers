/**
 * 나이테 Pages-only — 장소 뷰
 *
 * 기능: 장소 검색(Google Geocoding, Maps 키 필요)·직접 추가, 장소 목록·삭제,
 * 선택한 장소의 Google 지도 embed·외부 지도 링크·연결된 메모 목록,
 * 메모 위치값으로 만든 위치 노드 목록.
 * 좌표는 확신할 수 없으면 비워둔다 (지어내지 않음). 지도 embed는 Maps 키가 필요 없다.
 * 데이터는 api.places.* / api.locations.* / api.memos.* (로컬 저장소 + Google API 직접 호출).
 * 목업·가짜 데이터 없음.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type MemoPreview } from "../api";
import { Teapot } from "../components/Logo";
import "./PlacesView.css";

type Place = Awaited<ReturnType<typeof api.places.list>>["places"][number];
type PlaceCandidate = Awaited<ReturnType<typeof api.places.search>>["candidates"][number];
type LocationNode = Awaited<ReturnType<typeof api.locations.list>>["locations"][number];

type LinkedMemo = Pick<MemoPreview, "id" | "title" | "updatedAt">;

const TOKEN_EXPIRED = "TOKEN_EXPIRED_RELOGIN_REQUIRED";

/** 빈 문자열이면 undefined(비워둠), 숫자면 숫자, 숫자가 아니면 null(잘못된 입력). */
function parseCoord(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function hasCoords(p: { lat: number | null; lng: number | null }): p is { lat: number; lng: number } {
  return typeof p.lat === "number" && typeof p.lng === "number";
}

export function PlacesView(props: {
  onOpen: (memoId: string) => void;
  setNotice: (msg: string | null) => void;
}) {
  const { onOpen, setNotice } = props;
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mapsKeyMissing, setMapsKeyMissing] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [adding, setAdding] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkedMemos, setLinkedMemos] = useState<LinkedMemo[]>([]);
  const [memosLoading, setMemosLoading] = useState(false);
  const [memosTruncated, setMemosTruncated] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationMemos, setLocationMemos] = useState<LinkedMemo[]>([]);
  const [locationMemosLoading, setLocationMemosLoading] = useState(false);
  const [locationMemosTruncated, setLocationMemosTruncated] = useState(false);

  const loadPlaces = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { places: list } = await api.places.list();
      setPlaces(list);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setLoadError(`장소 목록을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  const loadLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
      const { locations: list } = await api.locations.list();
      setLocations(list);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`위치 노드를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLocationsLoading(false);
    }
  }, [setNotice]);

  useEffect(() => {
    void loadPlaces();
    void loadLocations();
  }, [loadPlaces, loadLocations]);

  const loadLinkedMemos = useCallback(
    async (placeId: string) => {
      setMemosLoading(true);
      setLinkedMemos([]);
      setMemosTruncated(false);
      try {
        const { memos, total } = await api.memos.list({ limit: 100 });
        setMemosTruncated(total > memos.length);
        const details = await Promise.all(memos.map((m) => api.memos.get(m.id)));
        setLinkedMemos(
          details
            .filter((d) => d.places.some((p) => p.id === placeId))
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

  const loadLocationMemos = useCallback(
    async (locationId: string) => {
      setLocationMemosLoading(true);
      setLocationMemos([]);
      setLocationMemosTruncated(false);
      try {
        const { memos, total } = await api.memos.list({ limit: 100 });
        setLocationMemosTruncated(total > memos.length);
        const details = await Promise.all(memos.map((m) => api.memos.get(m.id)));
        setLocationMemos(
          details
            .filter((d) => d.locations.some((l) => l.id === locationId))
            .map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt })),
        );
      } catch (e) {
        if ((e as { code?: string }).code === TOKEN_EXPIRED) {
          setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        } else {
          setNotice(`위치의 메모를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        setLocationMemosLoading(false);
      }
    },
    [setNotice],
  );

  function handleSelectPlace(placeId: string) {
    setSelectedId(placeId);
    void loadLinkedMemos(placeId);
  }

  function handleSelectLocation(locationId: string) {
    setSelectedLocationId(locationId);
    void loadLocationMemos(locationId);
  }

  async function handleSearch() {
    if (!query.trim()) {
      setNotice("검색할 장소를 입력하세요.");
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      const { candidates: found, status } = await api.places.search(query.trim());
      setMapsKeyMissing(status === "MAPS_KEY_NOT_CONFIGURED");
      setCandidates(found);
      setSearched(true);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`장소 검색에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleAddCandidate(c: PlaceCandidate) {
    const key = `${c.name}|${c.address}`;
    setAddingCandidate(key);
    setNotice(null);
    try {
      const { id } = await api.places.create({
        name: c.name,
        address: c.address !== "" ? c.address : undefined,
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
      });
      await loadPlaces();
      setSelectedId(id);
      void loadLinkedMemos(id);
      setNotice(`'${c.name}' 장소를 추가했습니다.`);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`장소 추가에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setAddingCandidate(null);
    }
  }

  async function handleAddPlace() {
    if (!newName.trim()) {
      setNotice("장소 이름을 입력하세요.");
      return;
    }
    const lat = parseCoord(newLat);
    const lng = parseCoord(newLng);
    if (lat === null || lng === null) {
      setNotice("위도·경도는 숫자로 입력하세요. 확신할 수 없으면 비워두세요.");
      return;
    }
    if ((lat === undefined) !== (lng === undefined)) {
      setNotice("위도와 경도는 함께 입력하거나 함께 비워두세요.");
      return;
    }
    setAdding(true);
    setNotice(null);
    try {
      const { id } = await api.places.create({
        name: newName.trim(),
        address: newAddress.trim() !== "" ? newAddress.trim() : undefined,
        lat,
        lng,
      });
      setNewName("");
      setNewAddress("");
      setNewLat("");
      setNewLng("");
      await loadPlaces();
      setSelectedId(id);
      void loadLinkedMemos(id);
      setNotice("장소를 추가했습니다.");
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`장소 추가에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemovePlace(place: Place) {
    if (!window.confirm(`'${place.name}' 장소를 삭제할까요? 메모와의 연결도 함께 지워집니다.`)) return;
    setRemovingId(place.id);
    setNotice(null);
    try {
      await api.places.remove(place.id);
      if (selectedId === place.id) {
        setSelectedId(null);
        setLinkedMemos([]);
      }
      await loadPlaces();
      setNotice(`'${place.name}' 장소를 삭제했습니다.`);
    } catch (e) {
      if ((e as { code?: string }).code === TOKEN_EXPIRED) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
      } else {
        setNotice(`장소 삭제에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setRemovingId(null);
    }
  }

  async function handleUnlinkMemo(memoId: string, placeId: string) {
    setUnlinkingId(memoId);
    try {
      await api.memos.unlinkPlace(memoId, placeId);
      await loadLinkedMemos(placeId);
      await loadPlaces();
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

  const selected = places.find((p) => p.id === selectedId) ?? null;
  const selectedLocation = locations.find((l) => l.id === selectedLocationId) ?? null;

  return (
    <div>
      <h2>장소</h2>

      <section className="card">
        <h3>장소 검색</h3>
        {mapsKeyMissing ? (
          <p className="notice">
            Google Maps API 키가 설정되지 않아 장소 검색을 할 수 없습니다. 아래 직접 입력으로 장소를 추가하세요.
          </p>
        ) : null}
        <div className="toolbar">
          <input
            type="search"
            placeholder="장소 검색"
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
        {searching ? <p className="meta">장소를 검색하는 중…</p> : null}
        {searched && !searching && !mapsKeyMissing && candidates.length === 0 ? (
          <p className="meta">검색 결과가 없습니다. 직접 입력으로 장소를 추가해보세요.</p>
        ) : null}
        <ul className="places-list">
          {candidates.map((c) => {
            const key = `${c.name}|${c.address}`;
            return (
              <li key={key} className="places-row">
                <span className="places-name">{c.name}</span>
                <span className="meta">{c.address || "주소 없음"}</span>
                {hasCoords(c) ? (
                  <span className="meta">
                    {c.lat}, {c.lng}
                  </span>
                ) : (
                  <span className="meta">좌표 없음</span>
                )}
                <button disabled={addingCandidate === key} onClick={() => void handleAddCandidate(c)}>
                  {addingCandidate === key ? "추가 중…" : "추가"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h3>장소 직접 추가</h3>
        <p className="meta">위도·경도는 확신할 수 없으면 비워두세요. 좌표가 없는 장소는 지도를 보여주지 않습니다.</p>
        <div className="toolbar">
          <input
            type="text"
            placeholder="장소 이름 *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="text"
            placeholder="주소 (선택)"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="위도 (선택)"
            value={newLat}
            onChange={(e) => setNewLat(e.target.value)}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="경도 (선택)"
            value={newLng}
            onChange={(e) => setNewLng(e.target.value)}
          />
          <button onClick={() => void handleAddPlace()} disabled={adding}>
            {adding ? "추가 중…" : "추가"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>장소 목록</h3>
        {loading ? (
          <p className="meta">장소 목록을 불러오는 중…</p>
        ) : loadError ? (
          <p className="notice">{loadError}</p>
        ) : places.length === 0 ? (
          <div className="empty-state">
            <Teapot />
            <p>등록된 장소가 없습니다. 검색하거나 직접 추가하세요.</p>
          </div>
        ) : (
          <ul className="places-list">
            {places.map((p) => (
              <li key={p.id} className={`places-row ${selectedId === p.id ? "selected" : ""}`}>
                <button className="places-select" onClick={() => handleSelectPlace(p.id)}>
                  <span className="places-name">{p.name}</span>
                  <span className="meta">{p.address ?? "주소 없음"}</span>
                  <span className="meta">연결된 메모 {p.memoCount}개</span>
                </button>
                <button disabled={removingId === p.id} onClick={() => void handleRemovePlace(p)}>
                  {removingId === p.id ? "삭제 중…" : "삭제"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="card">
          <h3>{selected.name}</h3>
          <dl className="kv">
            <dt>주소</dt>
            <dd>{selected.address ?? "없음"}</dd>
            <dt>좌표</dt>
            <dd>
              {hasCoords(selected) ? `${selected.lat}, ${selected.lng}` : "없음 (지도를 보여주지 않습니다)"}
            </dd>
            <dt>연결된 메모</dt>
            <dd>{selected.memoCount}개</dd>
          </dl>
          {hasCoords(selected) ? (
            <>
              <div className="graph-wrap places-map">
                <iframe
                  title={`${selected.name} 지도`}
                  src={`https://www.google.com/maps?q=${selected.lat},${selected.lng}&output=embed`}
                  loading="lazy"
                />
              </div>
              <div className="chip-row">
                <a
                  className="chip"
                  href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google 지도에서 열기
                </a>
                <a
                  className="chip"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  길찾기
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="meta">좌표가 없어 지도를 보여줄 수 없습니다.</p>
              <div className="chip-row">
                <a
                  className="chip"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.name)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google 지도에서 열기
                </a>
                <a
                  className="chip"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.name)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  길찾기
                </a>
              </div>
            </>
          )}
          <h4>연결된 메모</h4>
          {memosLoading ? (
            <p className="meta">연결된 메모를 불러오는 중…</p>
          ) : linkedMemos.length === 0 ? (
            <div className="empty-state">
              <Teapot />
              <p>이 장소와 연결된 메모가 없습니다.</p>
            </div>
          ) : (
            <ul className="memo-list">
              {linkedMemos.map((m) => (
                <li key={m.id} className="places-memo-row">
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
          {memosTruncated ? <p className="meta">메모가 많아 100개까지만 확인했습니다.</p> : null}
        </section>
      ) : null}

      <section className="card">
        <h3>위치 노드</h3>
        <p className="meta">메모 작성 시 입력한 위치값으로 만든 위치 노드입니다. 위치를 누르면 연결된 메모를 볼 수 있습니다.</p>
        {locationsLoading ? (
          <p className="meta">위치 노드를 불러오는 중…</p>
        ) : locations.length === 0 ? (
          <div className="empty-state">
            <Teapot />
            <p>위치 노드가 없습니다. 메모에 위치를 입력하면 여기에 쌓입니다.</p>
          </div>
        ) : (
          <ul className="places-list">
            {locations.map((l) => (
              <li key={l.id} className={`places-row ${selectedLocationId === l.id ? "selected" : ""}`}>
                <button className="places-select" onClick={() => handleSelectLocation(l.id)}>
                  <span className="places-name">{l.name}</span>
                  <span className="meta">
                    {hasCoords(l) ? `${l.lat}, ${l.lng}` : "좌표 없음"} · 연결된 메모 {l.memoCount}개
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedLocation ? (
          <>
            <h4>{selectedLocation.name}의 메모</h4>
            {locationMemosLoading ? (
              <p className="meta">메모를 불러오는 중…</p>
            ) : locationMemos.length === 0 ? (
              <p className="meta">이 위치와 연결된 메모가 없습니다.</p>
            ) : (
              <ul className="memo-list">
                {locationMemos.map((m) => (
                  <li key={m.id}>
                    <button className="memo-item" onClick={() => onOpen(m.id)}>
                      <span className="memo-title">{m.title || "(제목 없음)"}</span>
                      <span className="memo-date">{new Date(m.updatedAt).toLocaleString("ko-KR")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {locationMemosTruncated ? <p className="meta">메모가 많아 100개까지만 확인했습니다.</p> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
