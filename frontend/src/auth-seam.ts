/**
 * 나이테 Pages-only — 인증 경계 (AuthProvider 인터페이스)
 *
 * 로그인 UI·플로우·토큰 발급은 그록 소유다. 이 파일은 그록이 구현할 인터페이스와
 * 프론트엔드가 기대하는 동작만 정의한다. 프론트엔드 코드는 이 인터페이스 뒤에
 * 숨어서, 로그인 구현이 바뀌어도 나머지 화면은 그대로 동작한다.
 *
 * Pages-only 전환 (2026-11-09 jin 결정)으로 바뀐 점:
 *  - 세션 쿠키(naite_session)·HMAC 검증·Worker /api/auth/*는 없어졌다.
 *    Worker는 미사용(보관용)이다. docs/LOGIN_SEAM.md 참조.
 *  - 대신 브라우저가 Google OAuth access_token을 직접 보관·사용한다.
 *    토큰 저장은 sessionStorage만 쓴다 (token-store.ts).
 *    refresh_token은 브라우저에 저장하지 않는다.
 *  - AuthProvider에 getAccessToken()이 추가됐다. 프론트엔드의 Google API
 *    직접 호출(google-client.ts)이 이걸로 토큰을 받는다.
 *  - /api/auth/me 대체 수단: access_token으로 Google userinfo
 *    (https://openidconnect.googleapis.com/v1/userinfo)를 직접 부른다.
 *    getSession()은 그 결과를 쓴다.
 *
 * 그록이 구현해야 할 것:
 *  - AuthProvider.getSession(): 저장된 토큰으로 userinfo 확인. 없으면 null.
 *  - AuthProvider.getAccessToken(): 쓸 수 있는 access_token 반환. 없거나
 *    만료됐으면 null (프론트엔드는 재로그인으로 보낸다).
 *  - AuthProvider.login(): Google 로그인 시작 (브라우저 OAuth 플로우).
 *  - AuthProvider.logout(): 토큰 파기 (sessionStorage에서 지운다).
 *
 * 테스트 모드 (jin 결정: 테스트할 때는 OAuth 연결 없이 진행, 마지막에 연결):
 *  - 개발용 mock은 VITE_AUTH_MOCK=true 일 때만 동작하고, 프로덕션 빌드에서는
 *    절대 쓰지 않는다. mock은 가짜 세션을 반환하지만 access_token은 null이라
 *    Google API 직접 호출(Drive·캘린더·할일·연락처)은 동작하지 않는다.
 *    mock으로 만든 메모는 로컬에만 있고 Drive와 동기화되지 않는다.
 *  - 토큰 7일 만료: 테스트 모드 refresh_token 7일 만료는 Pages-only에서
 *    직접 체감되지 않는다. access_token(약 1시간)이 만료될 때마다
 *    다시 로그인해야 한다. 자동 갱신은 없다.
 */

import { clearAccessToken, loadAccessToken, saveAccessToken } from "./token-store";
import { fetchGoogleUserinfo, sessionTokenProvider } from "./google-client";

export type Session = {
  userId: string;
  email?: string;
  displayName?: string;
};

export interface AuthProvider {
  /** 현재 세션을 확인한다. 없으면 null. */
  getSession(): Promise<Session | null>;
  /** 쓸 수 있는 Google access_token. 없거나 만료됐으면 null. */
  getAccessToken(): Promise<string | null>;
  /** Google 로그인 시작 (그록 소유 브라우저 OAuth 플로우). */
  login(): void;
  /** 로그아웃 (토큰 파기). */
  logout(): Promise<void>;
}

/** 그록 구현 전까지 임시로 쓸 수 있는 개발용 mock. 프로덕션에서는 쓰지 않는다. */
export function createMockAuthProvider(): AuthProvider {
  // eslint-disable-next-line no-console
  console.warn("[naite] 개발용 mock 인증 사용 중 — 실제 Google 로그인이 아니다. Google API 호출은 동작하지 않는다.");
  let session: Session | null = { userId: "dev-user", email: "dev@example.com", displayName: "개발자" };
  return {
    async getSession() {
      return session;
    },
    async getAccessToken() {
      // mock에는 실제 access_token이 없다. Google API 직접 호출은 실패한다.
      return null;
    },
    login() {
      session = { userId: "dev-user", email: "dev@example.com", displayName: "개발자" };
    },
    async logout() {
      session = null;
    },
  };
}

/**
 * 실제 AuthProvider (Pages-only 기본 구현 — 그록이 로그인 플로우로 교체한다).
 *  - getSession(): sessionStorage 토큰으로 Google userinfo를 직접 부른다.
 *  - getAccessToken(): sessionStorage 토큰을 반환한다. 만료됐으면 null.
 *  - login(): VITE_GOOGLE_CLIENT_ID가 있으면 Google 인가 화면으로 이동한다.
 *    (PKCE·state·토큰 교환 세부 구현은 그록 소유. 클라이언트 ID가 아직
 *    없으면 — jin이 맨 마지막에 만든다 — 에러를 던진다.)
 *  - logout(): sessionStorage 토큰을 파기한다.
 */
export function createRealAuthProvider(): AuthProvider {
  return {
    async getSession(): Promise<Session | null> {
      try {
        const me = await fetchGoogleUserinfo(sessionTokenProvider);
        return { userId: me.sub, email: me.email, displayName: me.name };
      } catch {
        return null;
      }
    },
    async getAccessToken(): Promise<string | null> {
      return loadAccessToken()?.accessToken ?? null;
    },
    login() {
      // @ts-expect-error Vite 환경에서만 존재
      const clientId = typeof import.meta !== "undefined" && (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined);
      if (!clientId) {
        // OAuth 클라이언트는 jin이 맨 마지막에 만든다. 그 전까지는 로그인 불가.
        throw new Error("google_oauth_client_not_configured");
      }
      const redirectUri = `${window.location.origin}/auth/callback`;
      const state = crypto.randomUUID();
      sessionStorage.setItem("naite.oauth.state", state);
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "token",
        scope: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/calendar",
          "https://www.googleapis.com/auth/tasks",
          "https://www.googleapis.com/auth/contacts.readonly",
          "openid",
          "email",
          "profile",
        ].join(" "),
        state,
      }).toString();
      // 주의: response_type=token(Implicit)은 URL 해시에 토큰이 남는다.
      // 콜백 페이지에서 해시를 읽어 sessionStorage에 옮긴 뒤 해시를 지워야 한다.
      // 그록이 콜백 처리를 구현한다. (token-store.saveAccessToken 사용)
      window.location.href = auth.toString();
    },
    async logout() {
      clearAccessToken();
    },
  };
}

/** OAuth 콜백 해시(#access_token=...)에서 토큰을 꺼내 sessionStorage에 저장한다. 그록 콜백 처리가 쓴다. */
export function saveTokenFromCallbackHash(hash: string): boolean {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const accessToken = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") ?? "3600");
  const scope = params.get("scope") ?? "";
  if (!accessToken) return false;
  saveAccessToken({
    accessToken,
    expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000,
    scope,
  });
  return true;
}

/**
 * 프론트엔드 진입점에서 쓰는 팩토리.
 * VITE_AUTH_MOCK=true 일 때만 mock을 쓰고, 그 외에는 실제 Provider를 쓴다.
 * 그록이 로그인 UI를 넘겨주면, 이 팩토리 대신 그쪽 Provider를 주입하면 된다.
 */
export function createAuthProvider(): AuthProvider {
  // @ts-expect-error Vite 환경에서만 존재
  const useMock = typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_MOCK === "true";
  return useMock ? createMockAuthProvider() : createRealAuthProvider();
}
