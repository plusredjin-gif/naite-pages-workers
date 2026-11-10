import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createAuthProvider, saveTokenFromCallbackHash } from "./auth-seam";
import { PrivacyView } from "./views/PrivacyView";
import "./styles.css";

const NOTICE_KEY = "naite.login.notice";

/** /auth/callback SPA 진입: 해시 토큰 → sessionStorage, 해시는 비우고 `/`로 이동. */
function consumeOAuthCallback(): void {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path !== "/auth/callback") return;
  const result = saveTokenFromCallbackHash(window.location.hash);
  if (!result.ok) {
    try {
      sessionStorage.setItem(NOTICE_KEY, result.error);
    } catch {
      /* ignore */
    }
  } else {
    try {
      sessionStorage.removeItem(NOTICE_KEY);
    } catch {
      /* ignore */
    }
  }
  history.replaceState(null, "", "/");
}

consumeOAuthCallback();

/** /privacy는 로그인 없이 공개되는 개인정보처리방침 페이지다. */
const publicPath =
  typeof window !== "undefined"
    ? window.location.pathname.replace(/\/$/, "") || "/"
    : "/";

const auth = createAuthProvider();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {publicPath === "/privacy" ? <PrivacyView /> : <App auth={auth} />}
  </StrictMode>,
);

export { NOTICE_KEY };
