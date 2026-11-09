/**
 * 나이테 Pages-only — 앱 진입점
 *
 * 로그인 게이트는 AuthProvider.getSession() 결과로만 분기한다.
 * 로그인·동의 안내는 LoginGuide (그록)가 담당. Google 공식 동의 화면은 흉내 내지 않는다.
 */

import { useEffect, useState } from "react";
import { api, configureApiTokenProvider } from "./api";
import { type AuthProvider, type Session, isGoogleClientConfigured } from "./auth-seam";
import { LoginGuide, PlusTreeFooter } from "./LoginGuide";
import { MemoListView } from "./views/MemoListView";
import { MemoEditorView } from "./views/MemoEditorView";

type View = { name: "list" } | { name: "editor"; memoId: string };

const NOTICE_KEY = "naite.login.notice";

export function App(props: { auth: AuthProvider }) {
  const { auth } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: "list" });
  const [notice, setNotice] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);

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
    setView({ name: "list" });
  }

  async function handleDriveImport() {
    setNotice(null);
    try {
      const result = await api.drive.importAll(false);
      setNotice(`Drive에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (전체 ${result.total ?? 0}개)`);
      setView({ name: "list" });
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
        <LoginGuide
          onLogin={handleLogin}
          notice={notice}
          busy={loginBusy}
          clientConfigured={isGoogleClientConfigured()}
        />
        <PlusTreeFooter />
      </main>
    );
  }

  return (
    <main className="app">
      <header className="header">
        <h1>나이테</h1>
        <span className="meta">{session.displayName ?? session.email ?? session.userId}</span>
        <button type="button" onClick={() => void handleDriveImport()}>
          Drive에서 가져오기
        </button>
        <button type="button" onClick={() => void handleLogout()}>
          로그아웃
        </button>
      </header>
      {view.name === "list" ? (
        <MemoListView
          onOpen={(memoId) => setView({ name: "editor", memoId })}
          onNeedLogin={() => handleLogin()}
          notice={notice}
          setNotice={setNotice}
        />
      ) : (
        <MemoEditorView
          memoId={view.memoId}
          onBack={() => setView({ name: "list" })}
          onNeedLogin={() => handleLogin()}
          setNotice={setNotice}
        />
      )}
      <PlusTreeFooter />
    </main>
  );
}
