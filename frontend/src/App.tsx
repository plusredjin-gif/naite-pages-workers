/**
 * 나이테 Pages-only — 앱 진입점 (원본 memoaeb v32 레이아웃 기준)
 *
 * 원본 구조:
 * - 로그인 전: 히어로(랜딩) → 동의 안내(LoginGuide) 2단계
 * - 로그인 후: 왼쪽 사이드바(보기·카테고리·키워드·장소 섹션) + 본문.
 *   본문 상단: 로고 옆 메모 검색창. 제목 줄: "전체 메모" 왼쪽 + 전체 기간·
 *   최근 수정순 오른쪽 같은 줄. 그 아래 보기 전환 pill 줄(격자·목록·아웃라인·
 *   마인드맵·온톨로지·분석). 온톨로지·분석은 분리된 탭이 아니라 하나의 통합 화면.
 *   가져오기·설정은 하단 회사 로고 옆으로.
 * 로그인 게이트는 AuthProvider.getSession() 결과로만 분기한다.
 * Google 공식 동의 화면은 흉내 내지 않는다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, configureApiTokenProvider, type Category } from "./api";
import { type AuthProvider, type Session, isGoogleClientConfigured } from "./auth-seam";
import { loadAccessToken } from "./token-store";
import { LoginGuide, PlusTreeFooter } from "./LoginGuide";
import { NaiteLogo } from "./components/Logo";
import { RoundIcon, categoryIconFor, type LineIconName } from "./components/LineIcon";
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
import { CategoryManager } from "./views/CategoryManager";
import {
  PERIODS,
  SORTS,
  filterLabel,
  type MemoFilter,
  type PeriodKey,
  type SortKey,
} from "./views/memoFilters";

type MainView =
  | "grid"
  | "list"
  | "outline"
  | "mindmap"
  | "ontology"
  | "schedule"
  | "people"
  | "places"
  | "settings"
  | "categories";

type View = { name: MainView } | { name: "editor"; memoId: string };

const NOTICE_KEY = "naite.login.notice";

/** 본문 보기 전환 pill 줄 (원본: 격자·목록·아웃라인·마인드맵·온톨로지·분석).
 *  아이콘은 동그란 원형 라인 아이콘 (jin 결정) — 유니코드·이모지 아님. */
const MEMO_PILLS: Array<{ key: MainView; label: string; icon: LineIconName }> = [
  { key: "grid", label: "격자", icon: "grid" },
  { key: "list", label: "목록", icon: "list" },
  { key: "outline", label: "아웃라인", icon: "outline" },
  { key: "mindmap", label: "마인드맵", icon: "mindmap" },
  { key: "ontology", label: "온톨로지·분석", icon: "ontology" },
];

const PILL_VIEWS: MainView[] = ["grid", "list", "outline", "mindmap", "ontology"];

const PILL_TITLES: Partial<Record<MainView, string>> = {
  outline: "아웃라인",
  mindmap: "마인드맵",
  ontology: "온톨로지·분석",
};

type SidebarData = {
  categories: Category[];
  keywords: Array<{ id: string; name: string }>;
  places: Array<{ id: string; name: string }>;
  total: number;
};

export function App(props: { auth: AuthProvider }) {
  const { auth } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: "grid" });
  const [lastMain, setLastMain] = useState<MainView>("grid");
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
  /** 사이드바 필터 (원본: 보기·카테고리·키워드 섹션에서 고른 값). */
  const [memoFilter, setMemoFilter] = useState<MemoFilter>({ kind: "all" });
  /** 제목 줄의 기간·정렬 (원본: 제목 줄 오른쪽). 격자·목록 보기가 공유한다. */
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  /** 사이드바 섹션 데이터 (보기 개수·카테고리·키워드·장소). */
  const [sidebar, setSidebar] = useState<SidebarData>({
    categories: [],
    keywords: [],
    places: [],
    total: 0,
  });

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

  const loadSidebar = useCallback(async () => {
    try {
      const [cats, kws, pls, list] = await Promise.all([
        api.categories.list(),
        api.keywords.list(),
        api.places.list(),
        api.memos.list({ limit: 1 }),
      ]);
      setSidebar({
        categories: cats.categories,
        keywords: kws.keywords,
        places: pls.places,
        total: list.total,
      });
    } catch {
      /* 사이드바는 보조 정보라 실패해도 본문은 그대로 둔다. */
    }
  }, []);

  // 로그인 후 + 보기·필터가 바뀔 때마다 사이드바 섹션을 새로고침한다 (로컬 저장소라 가볍다).
  useEffect(() => {
    if (!session) return;
    void loadSidebar();
  }, [session, view, loadSidebar]);

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
        void loadSidebar();
      } catch (e) {
        setNotice(
          `Drive 가져오기 실패: ${e instanceof Error ? e.message : String(e)} — 사이드바 하단의 '가져오기' 버튼으로 다시 시도할 수 있습니다.`,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function goMain(name: MainView) {
    setLastMain(name);
    setView({ name });
  }

  /** 사이드바 필터 선택: 메모 보기(격자)로 이동해 해당 필터로 보여준다. */
  function pickFilter(filter: MemoFilter) {
    setMemoFilter(filter);
    goMain("grid");
  }

  /** 왼쪽 메뉴 키워드: 온톨로지 화면의 키워드 관리 카드로 이동한다. */
  function goKeywords() {
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
      void loadSidebar();
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
  const isMemoView = view.name !== "editor" && PILL_VIEWS.includes(currentMain);
  const isMemoList = currentMain === "grid" || currentMain === "list";
  const memoTitle =
    currentMain === "grid" || currentMain === "list"
      ? filterLabel(memoFilter)
      : (PILL_TITLES[currentMain] ?? "전체 메모");
  const topCategories = sidebar.categories.filter((c) => !c.parentId);
  const subCategories = (parentId: string) =>
    sidebar.categories.filter((c) => c.parentId === parentId);
  const filterActive = (kind: MemoFilter["kind"], id?: string) =>
    isMemoList &&
    memoFilter.kind === kind &&
    (id === undefined || (memoFilter.kind === "category" || memoFilter.kind === "keyword") ? (memoFilter as { id?: string }).id === id : false);

  return (
    <main className="app app-shell-wrap">
      <div className="app-shell">
        <aside className="sidebar">
          <NaiteLogo size={36} />
          <button type="button" className="new-memo-btn" onClick={() => void handleNewMemo()}>
            + 새 메모
          </button>

          <p className="side-section">보기</p>
          <nav className="side-nav" aria-label="보기">
            <button
              type="button"
              className={filterActive("all") ? "active" : ""}
              onClick={() => pickFilter({ kind: "all" })}
            >
              <RoundIcon name="inbox" />
              <span className="nav-label">전체 메모</span>
              <span className="nav-count">{sidebar.total}</span>
            </button>
            <button
              type="button"
              className={filterActive("pinned") ? "active" : ""}
              onClick={() => pickFilter({ kind: "pinned" })}
            >
              <RoundIcon name="pin" />
              <span className="nav-label">고정됨</span>
            </button>
            <button
              type="button"
              className={filterActive("uncategorized") ? "active" : ""}
              onClick={() => pickFilter({ kind: "uncategorized" })}
            >
              <RoundIcon name="folder" />
              <span className="nav-label">미분류</span>
            </button>
            <button
              type="button"
              className={currentMain === "people" ? "active" : ""}
              onClick={() => goMain("people")}
            >
              <RoundIcon name="user" />
              <span className="nav-label">사람</span>
            </button>
            <button
              type="button"
              className={currentMain === "places" ? "active" : ""}
              onClick={() => goMain("places")}
            >
              <RoundIcon name="mapPin" />
              <span className="nav-label">장소</span>
            </button>
            <button
              type="button"
              className={currentMain === "ontology" ? "active" : ""}
              onClick={() => goKeywords()}
            >
              <RoundIcon name="hash" />
              <span className="nav-label">키워드</span>
            </button>
            <button
              type="button"
              className={currentMain === "schedule" ? "active" : ""}
              onClick={() => goMain("schedule")}
            >
              <RoundIcon name="calendar" />
              <span className="nav-label">일정</span>
            </button>
          </nav>

          <div className="side-section-row">
            <p className="side-section">카테고리</p>
            <button type="button" className="side-manage" onClick={() => goMain("categories")}>
              관리
            </button>
          </div>
          <nav className="side-nav" aria-label="카테고리">
            {topCategories.map((c) => (
              <span key={c.id}>
                <button
                  type="button"
                  className={filterActive("category", c.id) ? "active" : ""}
                  onClick={() => pickFilter({ kind: "category", id: c.id, name: c.name })}
                >
                  <RoundIcon name={categoryIconFor(c.icon)} />
                  <span className="nav-label">{c.name}</span>
                </button>
                {subCategories(c.id).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`side-sub${filterActive("category", s.id) ? " active" : ""}`}
                    onClick={() => pickFilter({ kind: "category", id: s.id, name: s.name })}
                  >
                    <RoundIcon name={categoryIconFor(s.icon)} />
                    <span className="nav-label">{s.name}</span>
                  </button>
                ))}
              </span>
            ))}
          </nav>

          <div className="side-section-row">
            <p className="side-section">키워드</p>
            <button type="button" className="side-manage" onClick={() => goKeywords()}>
              관리
            </button>
          </div>
          <nav className="side-nav" aria-label="키워드">
            {sidebar.keywords.map((k) => (
              <button
                key={k.id}
                type="button"
                className={filterActive("keyword", k.id) ? "active" : ""}
                onClick={() => pickFilter({ kind: "keyword", id: k.id, name: k.name })}
              >
                <RoundIcon name="hash" />
                <span className="nav-label">{k.name}</span>
              </button>
            ))}
          </nav>

          <p className="side-section">장소</p>
          <nav className="side-nav" aria-label="장소">
            {sidebar.places.map((p) => (
              <button key={p.id} type="button" onClick={() => goMain("places")}>
                <RoundIcon name="mapPin" />
                <span className="nav-label">{p.name}</span>
              </button>
            ))}
          </nav>

          <div className="side-foot">
            <p className="meta">{session.displayName ?? session.email ?? session.userId}</p>
            <div className="side-foot-row">
              <a href="https://www.plustree.net/" target="_blank" rel="noopener noreferrer" title="더하기나무">
                <img className="side-company-logo" src="/assets/plustree-logo.png" alt="더하기나무" />
              </a>
              <button type="button" onClick={() => void handleDriveImport()}>
                가져오기
              </button>
              <button type="button" onClick={() => goMain("settings")}>
                설정
              </button>
              <button type="button" onClick={() => void handleLogout()}>
                로그아웃
              </button>
            </div>
          </div>
        </aside>

        <div className="app-main">
          <header className="header">
            <NaiteLogo size={36} />
            <input
              className="header-search"
              type="search"
              placeholder="메모 검색"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="메모 검색"
            />
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
          {isMemoView ? (
            <>
              <div className="title-row">
                <h1>{memoTitle}</h1>
                {isMemoList ? (
                  <div className="title-controls">
                    <select
                      className="period-select"
                      value={period}
                      onChange={(e) => setPeriod(e.target.value as PeriodKey)}
                      aria-label="기간"
                    >
                      {PERIODS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                      aria-label="정렬"
                    >
                      {SORTS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <div className="view-pills" role="tablist" aria-label="보기 전환">
                {MEMO_PILLS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={currentMain === item.key}
                    className={currentMain === item.key ? "active" : ""}
                    onClick={() => goMain(item.key)}
                  >
                    <RoundIcon name={item.icon} />
                    <span className="pill-label">{item.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {view.name === "grid" ? (
            <GridView
              onOpen={openMemo}
              setNotice={setNotice}
              search={search}
              filter={memoFilter}
              period={period}
              sort={sort}
            />
          ) : view.name === "list" ? (
            <MemoListView
              onOpen={openMemo}
              onNeedLogin={needLogin}
              notice={notice}
              setNotice={setNotice}
              search={search}
              filter={memoFilter}
              period={period}
              sort={sort}
            />
          ) : view.name === "outline" ? (
            <OutlineView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "mindmap" ? (
            <MindmapView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "ontology" ? (
            <div>
              <OntologyView onOpen={openMemo} setNotice={setNotice} />
              <AnalysisView onOpen={openMemo} setNotice={setNotice} />
            </div>
          ) : view.name === "schedule" ? (
            <ScheduleView onOpen={openMemo} setNotice={setNotice} onNeedLogin={needLogin} />
          ) : view.name === "people" ? (
            <PeopleView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "places" ? (
            <PlacesView onOpen={openMemo} setNotice={setNotice} />
          ) : view.name === "settings" ? (
            <SettingsView setNotice={setNotice} onNeedLogin={needLogin} />
          ) : view.name === "categories" ? (
            <CategoryManager setNotice={setNotice} />
          ) : (
            <MemoEditorView
              memoId={editorMemoId}
              onBack={() => goMain(lastMain)}
              onNeedLogin={needLogin}
              setNotice={setNotice}
            />
          )}
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
