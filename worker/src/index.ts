/**
 * 나이테 API Worker (스캐폴드)
 * - Google OAuth 로그인 (authorization-code + PKCE), refresh_token을 KV에 암호화 저장
 * - Google API 중계: Drive / Calendar / Tasks / People
 * - 메모·온톨로지 CRUD는 D1, 첨부파일은 R2 (스키마는 schema.sql 참조)
 *
 * 소유 구분 (2026-11-09 jin 결정):
 * - 로그인(/api/auth/*)은 그록 소유 — 이 파일의 로그인 구간은 그록 작업과 충돌하지 않게
 *   건드리지 않는다. 연동 지점은 docs/LOGIN_SEAM.md 참조.
 * - 로그인 외 API는 worker/src/api.ts, 백그라운드 동기화는 worker/src/sync.ts.
 *
 * 아직 배포 전이다. 필요한 것:
 *  1) Google OAuth 클라이언트 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — 맨 마지막에 생성
 *  2) wrangler d1 create / kv:namespace create / r2 bucket create 후 ID를 wrangler.toml에 반영
 */

import { handleApi, corsPreflightHeaders } from "./api";
import { runScheduledSync } from "./sync";

export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  ATTACHMENTS: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  OAUTH_REDIRECT_URI: string;
  GOOGLE_AUTH_URL: string;
  GOOGLE_TOKEN_URL: string;
}

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/contacts.readonly",
].join(" ");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url(new Uint8Array(d));
}

/** 세션 쿠키에서 사용자 ID를 확인한다. (HMAC 서명 쿠키, 스캐폴드 기준) */
async function getSessionUserId(req: Request, env: Env): Promise<string | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = /naite_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const [userId, sig] = m[1].split(".");
  if (!userId || !sig) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expect = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId))));
  return sig === expect ? userId : null;
}

/** 저장된 refresh_token으로 access_token을 갱신한다. */
async function getAccessToken(userId: string, env: Env): Promise<string | null> {
  const raw = await env.TOKENS.get(`refresh:${userId}`);
  if (!raw) return null;
  const res = await fetch(env.GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: raw,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/** Google API 중계: Authorization 헤더를 서버에서 붙인다. */
async function googleProxy(req: Request, env: Env, path: string): Promise<Response> {
  const userId = await getSessionUserId(req, env);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const token = await getAccessToken(userId, env);
  if (!token) return json({ error: "token_expired_relogin_required" }, 401);
  const url = new URL(req.url);
  const target = `https://www.googleapis.com${path}${url.search}`;
  const res = await fetch(target, {
    method: req.method,
    headers: { Authorization: `Bearer ${token}`, "content-type": req.headers.get("content-type") ?? "application/json" },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 0) CORS preflight (Pages 정적 프론트엔드 → api 도메인). 로그인 라우트 CORS는 그록 소유.
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsPreflightHeaders(req) });
    }

    // 1) 로그인 시작: PKCE 코드 챌린지 생성 후 Google 인가 화면으로 이동
    if (url.pathname === "/api/auth/login") {
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = await sha256(verifier);
      const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
      await env.TOKENS.put(`pkce:${state}`, verifier, { expirationTtl: 600 });
      const auth = new URL(env.GOOGLE_AUTH_URL);
      auth.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: env.OAUTH_REDIRECT_URI,
        response_type: "code",
        scope: SCOPES,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return Response.redirect(auth.toString(), 302);
    }

    // 2) OAuth 콜백: code → 토큰 교환, refresh_token을 KV에 저장, 세션 쿠키 발급
    if (url.pathname === "/api/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const verifier = state ? await env.TOKENS.get(`pkce:${state}`) : null;
      if (!code || !verifier) return json({ error: "invalid_callback" }, 400);
      const res = await fetch(env.GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.OAUTH_REDIRECT_URI,
          grant_type: "authorization_code",
          code_verifier: verifier,
        }),
      });
      if (!res.ok) return json({ error: "token_exchange_failed" }, 502);
      const tokens = (await res.json()) as { refresh_token?: string; access_token?: string };
      if (!tokens.refresh_token) return json({ error: "no_refresh_token" }, 502);
      // 사용자 식별: userinfo로 Google sub를 가져와 userId로 쓴다.
      const me = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = (await me.json()) as { sub?: string };
      if (!profile.sub) return json({ error: "userinfo_failed" }, 502);
      await env.TOKENS.put(`refresh:${profile.sub}`, tokens.refresh_token);
      await env.TOKENS.delete(`pkce:${state}`);
      const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(env.SESSION_SECRET),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
      );
      const sig = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(profile.sub))));
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "set-cookie": `naite_session=${profile.sub}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      });
    }

    // 3) 로그아웃: refresh_token 삭제 + 세션 쿠키 만료
    if (url.pathname === "/api/auth/logout") {
      const userId = await getSessionUserId(req, env);
      if (userId) await env.TOKENS.delete(`refresh:${userId}`);
      return new Response(null, {
        status: 302,
        headers: { Location: "/", "set-cookie": "naite_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" },
      });
    }

    // 4) Google API 중계 (Drive / Calendar / Tasks / People)
    if (url.pathname.startsWith("/api/google/")) {
      const path = url.pathname.replace("/api/google", "");
      return googleProxy(req, env, path);
    }

    // 4b) 헬스체크 (세션 없이 확인)
    if (url.pathname === "/api/health") return json({ ok: true });

    // 4c) 로그인 외 API (api.ts). /api/auth/*는 여기로 오지 않는다 (그록 소유).
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, env, url, { json, getSessionUserId, getAccessToken, googleProxy });
    }

    return json({ error: "not_found" }, 404);
  },

  /** 백그라운드 동기화 (Cron Trigger, 30분 간격): Drive·Tasks 동기화 (sync.ts) */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runScheduledSync(env, { json, getSessionUserId, getAccessToken, googleProxy });
  },
};
