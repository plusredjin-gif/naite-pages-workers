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

  if (loading) return <p className="meta">설정을 불러오는 중…</p>;

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
              동기화는 수동으로만 합니다. Drive에서 바뀐 메모만 가져오고, 전체 가져오기는
              memo 폴더의 모든 메모 파일을 로컬로 복원합니다. 이 앱은 drive.file
              범위라 원본 앱이 만든 파일은 직접 볼 수 없습니다. 원본 메모는 아래
              파일 선택기로 직접 골라 가져오세요.
            </p>
            <DrivePickerImport onDone={setNotice} onReload={() => void load()} />
          </>
        ) : (
          <p className="meta">Drive 상태를 불러오지 못했습니다.</p>
        )}
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
