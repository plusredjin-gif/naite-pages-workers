/**
 * 나이테 데이터 마이그레이션 스크립트 (틀) — 미사용 (Pages-only)
 *
 * Pages-only 전환 (2026-11-09 jin 결정): Worker+D1 경로가 폐기됐다.
 * 이 스크립트는 Worker API(`/api/drive/*`, 세션 쿠키)를 부르므로
 * Pages-only에서는 동작하지 않는다. 마이그레이션은 앱 안에서
 * `api.drive.importAll()`로 실행한다 (migration/PLAN.md 참조).
 * 파일은 기록용으로 남긴다. 실행하면 안내만 출력하고 종료한다.
 */

const API_BASE = process.env.NAITE_API_BASE ?? "https://api.naite.plustree.net";
const COOKIE = process.env.NAITE_SESSION_COOKIE ?? "";
const APPLY = process.argv.includes("--apply");

type Json = Record<string, unknown>;

async function call(path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: COOKIE,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} -> HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as Json;
}

async function main(): Promise<void> {
  console.log("[migrate] 미사용: Pages-only 전환(2026-11-09)으로 Worker+D1 마이그레이션은 폐기됐습니다.");
  console.log("[migrate] 마이그레이션은 앱 안에서 api.drive.importAll()로 실행하세요. migration/PLAN.md 참조.");
  console.log("[migrate] (이전 Worker API 호출 코드는 아래에 기록용으로 남겨두었으나 실행하지 않습니다.)");
}

main().catch((e) => {
  console.error("[migrate] 실패:", e);
  process.exit(1);
});

// ---- 아래는 Worker 시절 기록용 코드 (실행되지 않는다) ----
// (이전 main() 본문: /api/drive/status, /api/drive/import, /api/analytics/summary 호출)
