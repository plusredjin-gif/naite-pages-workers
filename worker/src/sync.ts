/**
 * 나이테 백그라운드 동기화 (Workers Cron Trigger, 30분 간격)
 *
 * 하는 일: D1 users에 있는 모든 사용자 중 refresh_token이 KV에 있는 사람에 대해
 * Drive 증분 동기화 + Google Tasks 상태 가져오기를 실행한다 (api.ts의 cronSyncUser).
 * 한 사용자가 실패해도 나머지는 계속한다. 결과는 sync_state 테이블에 기록한다.
 *
 * 로그인(OAuth 토큰 발급)은 그록 소유라 이 파일은 토큰을 만들지 않는다.
 * 토큰이 없는 사용자는 건너뛴다.
 */

import { cronSyncUser } from "./api";
import type { ApiEnv, ApiHelpers } from "./api";

export async function runScheduledSync(env: ApiEnv, h: ApiHelpers): Promise<void> {
  const startedAt = new Date().toISOString();
  // KV에 refresh_token이 있는 사용자만 동기화 대상이다.
  const listed = await env.TOKENS.list({ prefix: "refresh:" });
  const userIds = listed.keys.map((k) => k.name.replace(/^refresh:/, ""));
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const userId of userIds) {
    try {
      const r = await cronSyncUser(env, h, userId);
      ok++;
      await env.DB.prepare(
        `INSERT INTO sync_state (user_id, kind, last_run_at, last_ok_at, detail)
         VALUES (?, 'cron', ?, ?, ?)
         ON CONFLICT(user_id, kind) DO UPDATE SET last_run_at = excluded.last_run_at, last_ok_at = excluded.last_ok_at, detail = excluded.detail`,
      )
        .bind(
          userId,
          new Date().toISOString(),
          new Date().toISOString(),
          JSON.stringify({ driveImported: r.driveImported, tasksPulled: r.tasksPulled, errors: r.errors }),
        )
        .run();
      if (r.errors.length > 0) errors.push(...r.errors.map((e) => `${userId}: ${e}`));
    } catch (e) {
      failed++;
      errors.push(`${userId}: ${String(e)}`);
    }
  }
  console.log(
    JSON.stringify({ cron: "naite-sync", startedAt, users: userIds.length, ok, failed, errors: errors.slice(0, 20) }),
  );
}
