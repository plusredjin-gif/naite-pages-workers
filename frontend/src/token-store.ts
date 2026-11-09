/**
 * 나이테 Pages-only — 브라우저 토큰 보관 (token-store.ts)
 *
 * Pages-only에서는 서버(Worker·KV)가 없으므로 Google OAuth access_token을
 * 브라우저에 직접 보관해야 한다. 보안상 타협이므로 규칙을 엄격히 지킨다.
 *
 * 보관 규칙 (고정):
 *  - access_token만 보관한다. refresh_token은 브라우저에 절대 저장하지 않는다.
 *    (refresh_token이 탈취되면 오프라인에서 계속 재발급이 가능하기 때문)
 *  - 저장 위치는 sessionStorage다. localStorage는 쓰지 않는다.
 *    sessionStorage는 탭을 닫으면 지워지고, 다른 탭·다른 오리진에서 읽을 수 없다.
 *  - 토큰과 함께 만료 시각(expires_at, 초 단위)을 저장하고, 만료 60초 전부터는
 *    만료된 것으로 취급한다. 만료 시 재로그인이 필요하다 (자동 갱신 불가).
 *  - 토큰을 URL·콘솔 로그·Drive 파일·메모 본문에 절대 기록하지 않는다.
 *
 * 한계 (테스트 모드):
 *  - Google OAuth 테스트 모드에서는 refresh_token이 7일 만료되지만,
 *    Pages-only는 refresh_token 자체를 저장하지 않으므로 access_token(약 1시간)
 *    만료마다 다시 로그인해야 한다. 이것이 Pages-only의 가장 큰 사용성 한계다.
 *  - 이 한계를 없애려면 서버(Worker)가 refresh_token을 보관해야 하는데,
 *    그건 Pages-only 전환(jin 결정 2026-11-09)에서 제외된 방식이다.
 *
 * 토큰 발급 자체는 그록 소유 로그인(AuthProvider)이 한다. 이 파일은
 * AuthProvider가 넘겨준 토큰을 보관·만료 판정하는 저장소일 뿐이다.
 */

export type StoredToken = {
  accessToken: string;
  /** 만료 시각 (epoch ms). */
  expiresAt: number;
  /** 발급받은 범위 (공백 구분). */
  scope: string;
  /** 토큰 소유자 식별자 (Google sub 등, 있으면). 민감 정보가 아니지만 토큰과 함께 지운다. */
  userId?: string;
};

const KEY = "naite.google.access_token.v1";
const EXPIRY_SKEW_MS = 60_000; // 만료 60초 전부터 만료로 취급

function isSessionStorageAvailable(): boolean {
  try {
    const probe = "__naite_probe__";
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** access_token을 sessionStorage에 저장한다. refresh_token은 절대 이리로 오지 않는다. */
export function saveAccessToken(token: StoredToken): void {
  if (!isSessionStorageAvailable()) {
    // 저장소가 막혀 있으면 메모리에도 남기지 않고 에러로 알린다.
    throw new Error("session_storage_unavailable");
  }
  sessionStorage.setItem(KEY, JSON.stringify(token));
}

/** 저장된 access_token을 읽는다. 없거나 만료가 임박했으면 null. */
export function loadAccessToken(): StoredToken | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.accessToken || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt - Date.now() <= EXPIRY_SKEW_MS) {
      clearAccessToken();
      return null;
    }
    return parsed;
  } catch {
    clearAccessToken();
    return null;
  }
}

/** 토큰을 지운다. 로그아웃·만료·사용자 전환 시 호출한다. */
export function clearAccessToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // 지우다 실패해도 무시 (다음 읽기에서 만료 판정으로 걸러진다).
  }
}

/** 저장된 토큰이 지금 쓸 수 있는지 (네트워크 호출 없이 판정). */
export function hasValidAccessToken(): boolean {
  return loadAccessToken() !== null;
}
