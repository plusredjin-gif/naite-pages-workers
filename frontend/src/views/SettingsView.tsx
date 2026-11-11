/**
 * 나이테 Pages-only — 설정 뷰
 *
 * 기능: 계정 표시·Drive 상태 + 수동 동기화/가져오기·연동 토글·카테고리 관리.
 * 데이터는 api.bootstrap / api.drive.status / api.settings (로컬 저장소)에서 온다.
 * Drive 동기화·가져오기는 수동 버튼으로만 한다 (자동·백그라운드 동기화 없음).
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { CategoryManager } from "./CategoryManager";
import { DrivePickerImport } from "../components/DrivePickerImport";
import {
  clearPickerApiKey,
  getPickerApiKey,
  hasBuiltInPickerApiKey,
  savePickerApiKey,
} from "../drive-picker";
import "./SettingsView.css";

const TOKEN_EXPIRED_CODE = "TOKEN_EXPIRED_RELOGIN_REQUIRED";

const INTEGRATIONS = [
  {
    key: "calendar_enabled",
    label: "캘린더",
    desc: "메모에 일정을 연결하고 Google 캘린더에 등록합니다.",
  },
  {
    key: "tasks_enabled",
    label: "할 일",
    desc: "체크리스트를 Google Tasks와 동기화합니다.",
  },
  {
    key: "contacts_enabled",
    label: "연락처",
    desc: "메모에 사람을 연결할 때 Google 연락처를 검색합니다.",
  },
  {
    key: "places_enabled",
    label: "장소",
    desc: "메모에 장소를 연결할 때 장소 검색을 사용합니다.",
  },
  {
    key: "location_enabled",
    label: "현재 위치",
    desc: "메모에 현재 위치를 기록합니다.",
  },
] as const;

type DriveStatus = Awaited<ReturnType<typeof api.drive.status>>;

function isTokenExpired(e: unknown): boolean {
  return (e as { code?: string }).code === TOKEN_EXPIRED_CODE;
}

export function SettingsView(props: {
  setNotice: (msg: string | null) => void;
  onNeedLogin: () => void;
}) {
  const { setNotice, onNeedLogin } = props;
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string | null; displayName: string | null } | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  // Google API 키 (Drive 파일 선택기·장소 검색·역지오코딩 공용)
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  // 자동 동기화 (앱이 열려 있는 동안만 — 백그라운드 동기화는 Pages-only에서 안 됨)
  const [autoSync, setAutoSync] = useState(true);
  const [autoSyncInterval, setAutoSyncInterval] = useState("5");
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [boot, status, settings] = await Promise.all([
        api.bootstrap(),
        api.drive.status(),
        api.settings.get(),
      ]);
      setUser(boot.user);
      setDriveConnected(boot.driveConnected);
      setDriveStatus(status);
      const next: Record<string, boolean> = {};
      for (const item of INTEGRATIONS) {
        next[item.key] = settings.settings[item.key] === "1";
      }
      setToggles(next);
      // 자동 동기화: 설정이 없으면 기본 켬(5분). 끄려면 토글을 끄면 된다.
      setAutoSync(settings.settings["auto_sync_enabled"] !== "0");
      setAutoSyncInterval(settings.settings["auto_sync_interval_min"] ?? "5");
      setLastAutoSyncAt(settings.settings["last_auto_sync_at"] ?? null);
    } catch (e) {
      setNotice(`설정을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(key: string, label: string, enabled: boolean) {
    const prev = toggles[key] ?? false;
    setToggles((t) => ({ ...t, [key]: enabled }));
    try {
      await api.settings.update({ [key]: enabled ? "1" : "0" });
      setNotice(`${label} 연동을 ${enabled ? "켰습니다" : "껐습니다"}.`);
    } catch (e) {
      setToggles((t) => ({ ...t, [key]: prev }));
      setNotice(`${label} 연동 설정 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
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
      const status = await api.drive.status();
      setDriveStatus(status);
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`Drive 동기화 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDriveImport() {
    setImporting(true);
    setNotice(null);
    try {
      const result = await api.drive.importAll(false);
      setNotice(`Drive에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (전체 ${result.total ?? 0}개)`);
      const status = await api.drive.status();
      setDriveStatus(status);
    } catch (e) {
      if (isTokenExpired(e)) {
        setNotice("Google 로그인이 만료됐습니다. 다시 로그인하세요.");
        onNeedLogin();
      } else {
        setNotice(`Drive 가져오기 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setImporting(false);
    }
  }

  /** Google API 키 저장 (Drive 파일 선택기·장소 검색·역지오코딩 공용). */
  function handleSaveApiKey() {
    const key = apiKeyInput.trim();
    if (!key) return;
    savePickerApiKey(key);
    setApiKeyInput("");
    setKeySaved(true);
    setNotice("Google API 키를 저장했습니다. 장소 검색과 Drive 파일 선택기에서 바로 쓸 수 있습니다.");
  }

  function handleClearApiKey() {
    clearPickerApiKey();
    setKeySaved(false);
    setNotice("저장한 Google API 키를 지웠습니다. 빌드에 키가 들어 있으면 그 키를 씁니다.");
  }

  /** 자동 동기화 켜기/끄기. */
  async function handleAutoSyncToggle(enabled: boolean) {
    const prev = autoSync;
    setAutoSync(enabled);
    try {
      await api.settings.update({ auto_sync_enabled: enabled ? "1" : "0" });
      setNotice(`자동 동기화를 ${enabled ? "켰습니다" : "껐습니다"}.`);
    } catch (e) {
      setAutoSync(prev);
      setNotice(`자동 동기화 설정 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleAutoSyncIntervalChange(minutes: string) {
    const prev = autoSyncInterval;
    setAutoSyncInterval(minutes);
    try {
      await api.settings.update({ auto_sync_interval_min: minutes });
      setNotice(`자동 동기화 간격을 ${minutes}분으로 바꿨습니다.`);
    } catch (e) {
      setAutoSyncInterval(prev);
      setNotice(`자동 동기화 간격 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (loading) return <p className="meta">설정을 불러오는 중…</p>;

  const savedKey = getPickerApiKey();
  const maskedKey = savedKey ? `****${savedKey.slice(-4)}` : null;

  return (
    <div>
      <h2>설정</h2>

      <section className="card">
        <h3>계정</h3>
        {user ? (
          <dl className="kv">
            <dt>이름</dt>
            <dd>{user.displayName ?? "(이름 없음)"}</dd>
            <dt>이메일</dt>
            <dd>{user.email ?? "(이메일 없음)"}</dd>
          </dl>
        ) : (
          <p className="meta">로그인한 계정 정보를 불러오지 못했습니다. 다시 로그인해주세요.</p>
        )}
      </section>

      <section className="card">
        <h3>Google Drive</h3>
        {driveStatus ? (
          <>
            <dl className="kv">
              <dt>연결 상태</dt>
              <dd>{driveConnected ? "연결됨" : "연결되지 않음"}</dd>
              <dt>memo 폴더</dt>
              <dd>
                {driveStatus.memoFolderExists
                  ? `있음${driveStatus.memoFolderId ? ` (ID: ${driveStatus.memoFolderId})` : ""}`
                  : "없음 — 동기화하면 memo 폴더를 만듭니다"}
              </dd>
              <dt>동기화된 메모</dt>
              <dd>{driveStatus.syncedMemoCount}개</dd>
              <dt>마지막 동기화</dt>
              <dd>
                {driveStatus.lastSyncAt
                  ? new Date(driveStatus.lastSyncAt).toLocaleString("ko-KR")
                  : "아직 동기화한 적 없음"}
              </dd>
            </dl>
            <div className="toolbar">
              <button onClick={() => void handleDriveSync()} disabled={syncing}>
                {syncing ? "동기화 중…" : "수동 동기화"}
              </button>
              <button onClick={() => void handleDriveImport()} disabled={importing}>
                {importing ? "가져오는 중…" : "Drive에서 가져오기"}
              </button>
            </div>
            <p className="meta">
              앱이 열려 있는 동안에는 아래 자동 동기화가 주기적으로 Drive에서 바뀐
              메모를 가져옵니다. 수동 동기화는 Drive에서 바뀐 메모만 가져오고, 전체
              가져오기는 memo 폴더의 모든 메모 파일을 로컬로 복원합니다. 이 앱은
              drive.file 범위라 원본 앱이 만든 파일은 직접 볼 수 없습니다. 원본
              메모는 아래 파일 선택기로 직접 골라 가져오세요.
            </p>
            <DrivePickerImport onDone={setNotice} onReload={() => void load()} />
          </>
        ) : (
          <p className="meta">Drive 상태를 불러오지 못했습니다.</p>
        )}
      </section>

      <section className="card">
        <h3>자동 동기화</h3>
        <p className="meta">
          앱이 열려 있는 동안 {autoSyncInterval}분마다 Drive에서 바뀐 메모를 자동으로
          가져옵니다. 로컬에서 더 최근에 고친 메모는 Drive 버전으로 덮어쓰지 않습니다.
          앱을 닫으면 동기화되지 않습니다 (Pages-only 구조상 백그라운드 동기화는
          안 됩니다).
        </p>
        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <strong>자동 동기화</strong>
            <p className="meta">
              마지막 자동 동기화:{" "}
              {lastAutoSyncAt ? new Date(lastAutoSyncAt).toLocaleString("ko-KR") : "아직 한 적 없음"}
            </p>
          </div>
          <button
            type="button"
            className={autoSync ? "settings-toggle on" : "settings-toggle"}
            aria-pressed={autoSync}
            onClick={() => void handleAutoSyncToggle(!autoSync)}
          >
            {autoSync ? "켬" : "끔"}
          </button>
        </div>
        <div className="toolbar">
          <label>
            간격{" "}
            <select
              value={autoSyncInterval}
              onChange={(e) => void handleAutoSyncIntervalChange(e.target.value)}
              disabled={!autoSync}
            >
              <option value="5">5분</option>
              <option value="10">10분</option>
              <option value="30">30분</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h3>Google API 키</h3>
        <p className="meta">
          Drive 파일 선택기·장소 검색·역지오코딩에서 같이 쓰는 키입니다. Google Cloud
          Console → API 및 서비스 → 사용자 인증 정보에서 API 키를 만들고, HTTP
          리퍼러 제한에 <code>https://naite.plustree.net/*</code>,{" "}
          <code>https://memo.plustree.net/*</code>를 추가한 뒤 여기에 저장하세요.
          키는 이 브라우저에만 저장됩니다.
        </p>
        <p className="meta">
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Cloud Console 사용자 인증 정보 열기
          </a>
        </p>
        {hasBuiltInPickerApiKey() ? (
          <p className="meta">빌드에 API 키가 이미 들어 있습니다. 아래 입력은 필요 없습니다.</p>
        ) : maskedKey ? (
          <p className="meta">
            저장된 키: <code>{maskedKey}</code>{" "}
            <button type="button" onClick={() => void handleClearApiKey()}>
              지우기
            </button>
          </p>
        ) : (
          <p className="meta">저장된 키가 없습니다. 장소 검색과 Drive 파일 선택기가 동작하지 않습니다.</p>
        )}
        {!hasBuiltInPickerApiKey() ? (
          <div className="picker-key-row">
            <input
              type="text"
              placeholder="Google API 키 입력"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              aria-label="Google API 키"
            />
            <button type="button" onClick={() => void handleSaveApiKey()} disabled={!apiKeyInput.trim()}>
              저장
            </button>
          </div>
        ) : null}
        {keySaved ? <p className="meta">API 키를 저장했습니다.</p> : null}
      </section>

      <section className="card">
        <h3>연동</h3>
        <p className="meta">
          연동을 끄면 해당 화면에서는 연동이 꺼져 있다는 안내 문구만 표시되고, 기능은
          동작하지 않습니다.
        </p>
        <div className="settings-toggle-list">
          {INTEGRATIONS.map((item) => {
            const enabled = toggles[item.key] ?? false;
            return (
              <div key={item.key} className="settings-toggle-row">
                <div className="settings-toggle-text">
                  <strong>{item.label}</strong>
                  <p className="meta">{item.desc}</p>
                </div>
                <button
                  type="button"
                  className={enabled ? "settings-toggle on" : "settings-toggle"}
                  aria-pressed={enabled}
                  onClick={() => void handleToggle(item.key, item.label, !enabled)}
                >
                  {enabled ? "켬" : "끔"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h3>카테고리 관리</h3>
        <CategoryManager setNotice={setNotice} />
      </section>
    </div>
  );
}
