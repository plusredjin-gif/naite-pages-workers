import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createAuthProvider } from "./auth-seam";
import "./styles.css";

// 로그인 Provider는 그록 소유. 여기서는 팩토리로 받아 App에 주입한다.
const auth = createAuthProvider();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App auth={auth} />
  </StrictMode>,
);
