/**
 * 나이테 Pages-only — 앱 진입점
 *
 * 원본(memoaeb) 구조를 Pages 정적판으로 이식한 앱 셸:
 * - 로그인 전: 히어로(랜딩) → 동의 안내(LoginGuide) 2단계
 * - 로그인 후: 사이드바 내비게이션(격자·목록·아웃라인·마인드맵·온톨로지·분석 /
 *   일정·사람·장소·설정) + 편집기. 모바일은 아이콘 칩 + FAB.
 * 로그인 게이트는 AuthProvider.getSession() 결과로만 분기한다.
 * Google 공식 동의 화면은 흉내 내지 않는다.
 */

import { useEffect, useRef, useState } from "react";
import { api, configureApiTokenProvider } from "./api";
import { type AuthProvider, type Session, isGoogleClientConfigured } from "./auth-seam";
import { loadAccessToken } from "./token-store";
import { LoginGuide, PlusTreeFooter } from "./LoginGuide";
import { NaiteLogo } from "./components/Logo";
import { HeroView } from "./views/HeroView";
import { MemoListView } from "./views/MemoListView";
import { MemoEditorView } from "./views/MemoEditorView";
import { GridView } from "./views/GridView";
import { OutlineView } from "./views/OutlineView";
import { MindmapView } from "./views/MindmapView";
import { OntologyView } from "./views/OntologyView";
import { AnalysisView } from "./views/AnalysisView";
import { ScheduleView } from "./views/ScheduleView";
import { PeopleView } from "./views/PeopleView";
import { PlacesView } from "./views/PlacesView";
import { SettingsView } from "./views/SettingsView";

type MainView =
  | "grid"
  | "list"
  | "outline"
  | "mindmap"
  | "ontology"
  | "schedule"
  | "people"
  | "places"
  | "settings";

type View = { name: MainView } | { name: "editor"; memoId: string };

const NOTICE_KEY = "naite.login.notice";

/** 보기 메뉴 (원본: 격자·목록·아웃라인·마인드맵·온톨로지·분석). */
const VIEW_NAV: Array<{ key: MainView; label: string; icon: string }> = [
  { key: "grid", label: "격자", icon: "▦" },
  { key: "list", label: "목록", icon: "☰" },
  { key: "outline", label: "아웃라인", icon: "⋮≡" },
  { key: "mindmap", label: "마인드맵", icon: "✦" },
  { key: "ontology", label: "온톨로지·분석", icon: "◉" },
];

/** 왼쪽 메뉴 (원본: 일정·사람·장소·설정). */
const MENU_NAV: Array<{ key: MainView; label: string; icon: string }> = [
  { key: "schedule", label: "일정", icon: "📅" },
  { key: "people", label: "사람", icon: "👤" },
  { key: "places", label: "장소", icon: "📍" },
  { key: "settings", label: "설정", icon: "⚙" },
];

export function App(props: { auth: AuthProvider }) {
  const { auth } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: "grid" });
  const [lastMain, setLastMain] = useState<MainView>("grid");
  /** 온톨로지·분석은 원본처럼 하나의 메뉴, 안에서 그래프/대시보드 탭 전환. */
  const [ontologyTab, setOntologyTab] = useState<"graph" | "analysis">("graph");
  const [notice, setNotice] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  /** 로그인 전: 히어로만 보이다가 "Google로 로그인"을 누르면 동의 안내로. */
  const [showConsent, setShowConsent] = useState(false);
  /** 상단 검색창 (원본: 로고 옆 검색창 — 모든 보기에서 공유). */
  const [search, setSearch] = useState("");
  /** Drive 전체 읽기 권한이 없는 기존 토큰이면 다시 로그인 안내. */
  const [needRelogin, setNeedRelogin] = useState(false);
  /** 첫 로그인 자동 가져오기는 세션당 한 번만. */
  const autoImportDone = useRef(false);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(NOTICE_KEY);
      if (pending) {
        setNotice(pending);
        sessionStorage.removeItem(NOTICE_KEY);
      }
    } catch {
      /* ignore */
    }
    configureApiTokenProvider({ getAccessToken: () => auth.getAccessToken() });
    void auth
      .getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setChecking(false));
  }, [auth]);

  // 첫 로그인 시: 로컬 메모가 비어 있으면 Drive memo 폴더에서 자동 가져오기.
  // 원본 memoaeb 메모가 Drive에 있으면 여기서 로컬로 복원된다.
  useEffect(() => {
    if (!session || autoImportDone.current) return;
    autoImportDone.current = true;
    void (async () => {
      // 기존 토큰이 drive.file 범위면 원본 메모 파일이 안 보인다.
      const scope = loadAccessToken()?.scope ?? "";
      const scopes = scope.split(/\s+/).filter(Boolean);
      if (!scopes.includes("https://www.googleapis.com/auth/drive")) {
        setNeedRelogin(true);
        setNotice(
          "Drive 메모를 가져오려면 Drive 전체 읽기 권한이 필요합니다. 아래 '다시 로그인' 버튼으로 다시 로그인하면 원본 메모를 가져올 수 있습니다. (기존 로그인은 drive.file 범위라 원본 메모 파일이 안 보입니다.)",
        );
        return;
      }
      try {
        const first = await api.memos.list({ limit: 1 });
        if (first.total > 0) return; // 로컬에 이미 메모가 있으면 가져오지 않는다.
        const settings = await api.settings.get();
        if (settings.settings["drive_first_import_done"] === "1") return;
        const result = await api.drive.importAll(false);
        await api.settings.update({ drive_first_import_done: "1" });
        if ((result.total ?? 0) === 0) {
          setNotice("Drive memo 폴더에 가져올 메모가 없습니다. 새 메모를 만들어보세요.");
        } else {
          setNotice(
            `Drive에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (전체 ${result.total ?? 0}개)` +
              (result.errors && result.errors.length > 0 ? ` (오류 ${result.errors.length}개)` : ""),
          );
        }
        goMain("grid");
      } catch (e) {
        setNotice(
          `Drive 가져오기 실패: ${e instanceof Error ? e.message : String(e)} — 사이드바 하단의 'Drive에서 가져오기' 버튼으로 다시 시도할 수 있습니다.`,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function goMain(name: MainView) {
    setLastMain(name);
    setView({ name });
  }

  /** 왼쪽 메뉴 키워드: 온톨로지 화면의 키워드 관리 카드로 이동한다. */
  function goKeywords() {
    setOntologyTab("graph");
    goMain("ontology");
    window.setTimeout(() => {
      document.getElementById("keyword-manage")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
  }

  /** 상단 검색: 다른 보기에서 입력하면 격자 보기로 이동해 검색한다. */
  function handleSearchChange(value: string) {
    setSearch(value);
    if (view.name !== "grid" && view.name !== "list" && view.name !== "editor") {
      goMain("grid");
    }
  }

  /** Drive 범위 부족 시: 토큰을 지우고 로그인 안내 화면으로 (다시 동의받는다). */
  async function handleRelogin() {
    await auth.logout();
    setSession(null);
    setNeedRelogin(false);
    setNotice(null);
    setShowConsent(true);
  }

  function openMemo(memoId: string) {
    setView({ name: "editor", memoId });
  }

  function handleLogin() {
    setNotice(null);
    setLoginBusy(true);
    try {
      auth.login();
    } catch (e) {
      setLoginBusy(false);
      const msg = e instanceof Error ? e.message : String(e);
      setNotice(
        msg === "google_oauth_client_not_configured"
          ? "Google OAuth 클라이언트 ID가 아직 없습니다. jin이 맨 마지막에 공개 웹 클라이언트 ID를 넣으면 로그인이 열립니다."
          : `로그인할 수 없습니다: ${msg}`,
      );
    }
  }

  async function handleLogout() {
    await auth.logout();
    setSession(null);
    setView({ name: "grid" });
    setShowConsent(false);
  }

  async function handleNewMemo() {
    try {
      const { id } = await api.memos.create({ title: "" });
      openMemo(id);
    } catch (e) {
      setNotice(`메모를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDriveImport() {
    setNotice(null);
    try {
      const result = await api.drive.importAll(false);
      setNotice(`Drive에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (전체 ${result.total ?? 0}개)`);
      goMain("grid");
    } catch (e) {
      setNotice(`Drive 가져오기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (checking) {
    return (
      <main className="app">
        <p className="meta">확인 중…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="app">
        {showConsent ? (
          <LoginGuide
            onLogin={handleLogin}
            notice={notice}
            busy={loginBusy}
            clientConfigured={isGoogleClientConfigured()}
          />
        ) : (
          <HeroView onLogin={() => setShowConsent(true)} />
        )}
        <PlusTreeFooter />
      </main>
    );
  }

  const currentMain: MainView = view.name === "editor" ? lastMain : view.name;
  const editorMemoId = view.name === "editor" ? view.memoId : "";
  const needLogin = () => handleLogin();

  return (
    <main className="app">
      <div className="app-shell">
        <aside className="sidebar">
          <NaiteLogo size={36} />
          <button type="button" className="new-memo-btn" onClick={() => void handleNewMemo()}>
            + 새 메모
          </button>
          <nav className="side-nav" aria-label="보기">
            {VIEW_NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={currentMain === item.key ? "active" : ""}
                onClick={() => goMain(item.key)}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
          <nav className="side-nav" aria-label="메뉴">
            {MENU_NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={currentMain === item.key ? "active" : ""}
                onClick={() => goMain(item.key)}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
            <button
              type="button"
              className={currentMain === "ontology" ? "active" : ""}
              onClick={() => goKeywords()}
            >
              <span className="nav-icon" aria-hidden>
                #
              </span>
              <span className="nav-label">키워드</span>
            </button>
          </nav>
          <div className="side-foot">
            <p className="meta">{session.displayName ?? session.email ?? session.userId}</p>
            <button type="button" onClick={() => void handleDriveImport()}>
              Drive에서 가져오기
            </button>
            <button type="button" onClick={() => void handleLogout()}>
              로그아웃
            </button>
          </div>
        </aside>

        <div className="app-main">
          <header className="header">
            <input
              className="header-search"
              type="search"
              placeholder="메모 검색"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="메모 검색"
            />
            <span className="meta">{session.displayName ?? session.email ?? session.userId}</span>
            <button type="button" onClick={() => void handleLogout()}>
              로그아웃
            </button>
          </header>
          {needRelogin ? (
            <p className="notice">
              Drive 메모를 가져오려면 다시 로그인이 필요합니다.{" "}
              <button type="button" onClick={() => void handleRelogin()}>
                다시 로그인
              </button>
            </p>
          ) : null}
          {view.name !== "list" && notice ? <p className="notice">{notice}</p> : null}
          {view.name === "grid" ? (
            <GridView onOpen={openMemo} setNotice={setNotice} search={search} />
          ) : view.name === "list" ? (
            <MemoListView
              onOpen={openMemo}
              onNeedLogin={needLogin}
              notice={notice}
              setNotice={setNotice}
              search={search}
            />
          ) : view.name === "outline" ? (
            <OutlineView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "mindmap" ? (
            <MindmapView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "ontology" ? (
            <div>
              <div className="toolbar" role="tablist" aria-label="온톨로지·분석">
                <button
                  type="button"
                  role="tab"
                  aria-selected={ontologyTab === "graph"}
                  className={ontologyTab === "graph" ? "active" : ""}
                  onClick={() => setOntologyTab("graph")}
                >
                  온톨로지 그래프
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={ontologyTab === "analysis"}
                  className={ontologyTab === "analysis" ? "active" : ""}
                  onClick={() => setOntologyTab("analysis")}
                >
                  분석 대시보드
                </button>
              </div>
              {ontologyTab === "graph" ? (
                <OntologyView onOpen={openMemo} setNotice={setNotice} />
              ) : (
                <AnalysisView onOpen={openMemo} setNotice={setNotice} />
              )}
            </div>
          ) : view.name === "schedule" ? (
            <ScheduleView onOpen={openMemo} setNotice={setNotice} onNeedLogin={needLogin} />
          ) : view.name === "people" ? (
            <PeopleView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "places" ? (
            <PlacesView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "settings" ? (
            <SettingsView setNotice={setNotice} onNeedLogin={needLogin} />
          ) : (
            <MemoEditorView
              memoId={editorMemoId}
              onBack={() => goMain(lastMain)}
              onNeedLogin={needLogin}
              setNotice={setNotice}
            />
          )}
          <PlusTreeFooter />
        </div>
      </div>
      <button
        type="button"
        className="fab-new-memo"
        aria-label="새 메모"
        onClick={() => void handleNewMemo()}
      >
        +
      </button>
    </main>
  );
}
