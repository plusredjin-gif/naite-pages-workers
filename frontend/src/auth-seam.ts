/**
 * 나이테 정적 프론트엔드 — 인증 경계 (AuthProvider 인터페이스)
 *
 * 로그인 UI·플로우·세션 발급은 그록 소유다. 이 파일은 그록이 구현할 인터페이스와
 * 프론트엔드가 기대하는 동작만 정의한다. 프론트엔드 코드는 이 인터페이스 뒤에
 * 숨어서, 로그인 구현이 바뀌어도 나머지 화면은 그대로 동작한다.
 *
 * 그록이 구현해야 할 것:
 *  - AuthProvider.getSession(): 현재 세션 확인. Worker GET /api/auth/me 가
 *    그록이 정한 세션 확인 엔드포인트다 (docs/LOGIN_SEAM.md 참조).
 *  - AuthProvider.login(): Google 로그인 시작. Worker /api/auth/login 으로 이동.
 *  - AuthProvider.logout(): Worker /api/auth/logout 호출 후 세션 상태 초기화.
 *
 * 테스트 모드 (jin 결정: 테스트할 때는 OAuth 연결 없이 진행, 마지막에 연결):
 *  - 개발용 mock은 VITE_AUTH_MOCK=true 일 때만 동작하고, 프로덕션 빌드에서는
 *    절대 쓰지 않는다. mock은 Worker와 통신하지 않고 가짜 세션을 반환한다.
 *  - mock으로 만든 데이터는 로컬에만 있고 Drive·D1과 동기화되지 않는다.
 */

export type Session = {
  userId: string;
  email?: string;
  displayName?: string;
};

export interface AuthProvider {
  /** 현재 세션을 확인한다. 없으면 null. */
  getSession(): Promise<Session | null>;
  /** Google 로그인 시작 (Worker /api/auth/login 으로 이동). */
  login(): void;
  /** 로그아웃 (Worker /api/auth/logout 호출). */
  logout(): Promise<void>;
}

const API_BASE_URL =
  // @ts-expect-error Vite 환경에서만 존재
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  "https://api.naite.plustree.net";

/** 그록 구현 전까지 임시로 쓸 수 있는 개발용 mock. 프로덕션에서는 쓰지 않는다. */
export function createMockAuthProvider(): AuthProvider {
  // eslint-disable-next-line no-console
  console.warn("[naite] 개발용 mock 인증 사용 중 — 실제 Google 로그인이 아니다.");
  let session: Session | null = { userId: "dev-user", email: "dev@example.com", displayName: "개발자" };
  return {
    async getSession() {
      return session;
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
 * 실제 AuthProvider. 그록이 /api/auth/me 를 구현하면 이 함수가 그걸 쓴다.
 * 아직 /api/auth/me 가 없으면 getSession()은 null을 반환하고, 프론트엔드는
 * 로그인 화면(그록 작업)을 보여준다.
 */
export function createRealAuthProvider(): AuthProvider {
  return {
    async getSession(): Promise<Session | null> {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" });
        if (!res.ok) return null;
        const data = (await res.json()) as { userId?: string; email?: string; displayName?: string };
        if (!data.userId) return null;
        return { userId: data.userId, email: data.email, displayName: data.displayName };
      } catch {
        return null;
      }
    },
    login() {
      window.location.href = `${API_BASE_URL}/api/auth/login`;
    },
    async logout() {
      await fetch(`${API_BASE_URL}/api/auth/logout`, { credentials: "include" }).catch(() => undefined);
    },
  };
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
