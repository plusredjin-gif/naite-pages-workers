/**
 * 나이테 Pages-only — 앱 진입점
 *
 * 로그인 게이트는 AuthProvider.getSession() 결과로만 분기한다.
 * 로그인 화면 자체는 그록 소유라 이 파일에서 만들지 않는다.
 * (그록이 로그인 UI를 넘겨주면 createAuthProvider 대신 그쪽 Provider를 주입한다.)
 */

import { useEffect, useState } from "react";
import { api, configureApiTokenProvider } from "./api";
import { type AuthProvider, type Session } from "./auth-seam";
import { MemoListView } from "./views/MemoListView";
import { MemoEditorView } from "./views/MemoEditorView";

type View = { name: "list" } | { name: "editor"; memoId: string };

export function App(props: { auth: AuthProvider }) {
  const { auth } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: "list" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // AuthProvider의 토큰 공급자를 api에 연결한다 (Google API 직접 호출용).
    configureApiTokenProvider({ getAccessToken: () => auth.getAccessToken() });
    void auth
      .getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setChecking(false));
  }, [auth]);

  async function handleLogin() {
    try {
      auth.login();
    } catch (e) {
      setNotice(
        `로그인할 수 없습니다: ${e instanceof Error ? e.message : String(e)} — Google OAuth 클라이언트는 jin이 맨 마지막에 만듭니다.`,
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

  if (checking) return <main className="app"><p className="meta">확인 중…</p></main>;

  if (!session) {
    return (
      <main className="app">
        <h1>나이테</h1>
        <p>메모를 보려면 Google 로그인이 필요합니다.</p>
        <p className="meta">
          로그인하면 브라우저에서 Google Drive·캘린더·할일에 직접 연결합니다.
          토큰은 이 브라우저(sessionStorage)에만 보관되고, 만료되면 다시 로그인해야 합니다.
        </p>
        {notice ? <p className="notice">{notice}</p> : null}
        <button onClick={() => void handleLogin()}>Google로 로그인</button>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="header">
        <h1>나이테</h1>
        <span className="meta">{session.displayName ?? session.email ?? session.userId}</span>
        <button onClick={() => void handleDriveImport()}>Drive에서 가져오기</button>
        <button onClick={() => void handleLogout()}>로그아웃</button>
      </header>
      {view.name === "list" ? (
        <MemoListView
          onOpen={(memoId) => setView({ name: "editor", memoId })}
          onNeedLogin={() => void handleLogin()}
          notice={notice}
          setNotice={setNotice}
        />
      ) : (
        <MemoEditorView
          memoId={view.memoId}
          onBack={() => setView({ name: "list" })}
          onNeedLogin={() => void handleLogin()}
          setNotice={setNotice}
        />
      )}
      <footer className="meta">
        Pages-only: 백그라운드 동기화·실시간 알림 없음. Drive 동기화는 버튼으로 수동 실행.
      </footer>
    </main>
  );
}
