import assert from "node:assert/strict";

const store = new Map();
const loc = { hash: "#x", pathname: "/auth/callback", search: "" };

globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { location: loc };
globalThis.history = {
  replaceState() {
    loc.hash = "";
  },
};

function saveTokenFromCallbackHash(hash) {
  const KEY = "naite.google.access_token.v1";
  const STATE = "naite.oauth.state";
  const clearHash = () => {
    loc.hash = "";
  };
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) {
    clearHash();
    return { ok: false, error: "empty" };
  }
  const params = new URLSearchParams(raw);
  if (params.get("error")) {
    clearHash();
    sessionStorage.removeItem(STATE);
    return { ok: false, error: params.get("error") };
  }
  const expected = sessionStorage.getItem(STATE);
  const got = params.get("state");
  if (expected && got && expected !== got) {
    clearHash();
    sessionStorage.removeItem(STATE);
    return { ok: false, error: "state_mismatch" };
  }
  const accessToken = params.get("access_token");
  if (!accessToken) {
    clearHash();
    return { ok: false, error: "no_token" };
  }
  const expiresIn = Number(params.get("expires_in") ?? "3600");
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      accessToken,
      expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000,
      scope: params.get("scope") ?? "",
    }),
  );
  sessionStorage.removeItem(STATE);
  clearHash();
  return { ok: true };
}

sessionStorage.setItem("naite.oauth.state", "abc");
let r = saveTokenFromCallbackHash("#access_token=tok1&expires_in=3600&state=abc&scope=drive.file");
assert.equal(r.ok, true);
assert.equal(JSON.parse(sessionStorage.getItem("naite.google.access_token.v1")).accessToken, "tok1");
assert.equal(loc.hash, "");

store.clear();
sessionStorage.setItem("naite.oauth.state", "abc");
r = saveTokenFromCallbackHash("#access_token=tok2&state=zzz");
assert.equal(r.ok, false);
assert.equal(sessionStorage.getItem("naite.google.access_token.v1"), null);

store.clear();
r = saveTokenFromCallbackHash("#error=access_denied");
assert.equal(r.ok, false);

console.log("auth-callback-selftest: ok");
