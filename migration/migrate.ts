/**
 * 나이테 데이터 마이그레이션 스크립트 (틀)
 *
 * Drive memo 폴더(원본) → D1 + R2 로 복원한다. PLAN.md 순서대로 실행한다.
 * 기본값은 --dry-run (읽기만, 아무것도 쓰지 않음). 실제 적용은 --apply 필요.
 *
 * 실행 조건: Worker 배포 + Google OAuth 연결이 끝난 뒤 (jin 결정: 마지막에 연결).
 * 실행 전: NAITE_SESSION_COOKIE 환경변수에 로그인 세션 쿠키를 넣는다.
 *   export NAITE_SESSION_COOKIE="naite_session=..."
 *   npx tsx migration/migrate.ts --dry-run
 *   npx tsx migration/migrate.ts --apply
 *
 * Drive 원본은 수정·삭제하지 않는다. D1 적용은 drive_file_id 기준 멱등이다.
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
  if (!COOKIE) {
    console.error("NAITE_SESSION_COOKIE가 없습니다. 로그인 후 세션 쿠키로 실행하세요.");
    process.exit(1);
  }
  console.log(`[migrate] mode=${APPLY ? "APPLY" : "DRY-RUN"} api=${API_BASE}`);

  // 1단계 — 인벤토리
  const status = await call("/api/drive/status");
  console.log("[1] drive status:", JSON.stringify(status));
  const inventory = await call("/api/drive/import?dryRun=1", { method: "POST", body: "{}" });
  console.log(`[1] 가져올 파일: ${inventory.total ?? 0}개`);
  if (!APPLY) {
    console.log("[dry-run] 여기까지만 실행합니다. 적용하려면 --apply를 붙이세요.");
    return;
  }

  // 2단계 — D1 복원 (멱등)
  const imported = await call("/api/drive/import", { method: "POST", body: "{}" });
  console.log(`[2] 복원 결과: 전체 ${imported.total}개 중 ${imported.imported}개 가져옴`);
  if (Array.isArray(imported.errors) && imported.errors.length > 0) {
    console.log("[2] 오류 목록:", JSON.stringify(imported.errors, null, 2));
  }

  // 3단계 — 첨부파일은 Drive 파일 목록을 보고 별도 이관 (수동 확인 후 진행)
  //   첨부 파일명 → R2 업로드 → 블록 attachmentId 교체는
  //   /api/attachments/upload 로 파일 단위로 실행한다.
  //   이 틀에서는 목록만 출력하고, 실제 업로드는 운영자가 확인 후 실행한다.
  console.log("[3] 첨부파일 이관은 별도 단계입니다. Drive memo 폴더의 이미지·음성 파일을 확인하세요.");

  // 4단계 — 검증
  const summary = await call("/api/analytics/summary");
  console.log("[4] 검증 요약:", JSON.stringify(summary));
  const driveAfter = await call("/api/drive/status");
  console.log("[4] drive status (적용 후):", JSON.stringify(driveAfter));
  console.log("[migrate] 완료. 불일치가 있으면 PLAN.md 4단계를 보세요.");
}

main().catch((e) => {
  console.error("[migrate] 실패:", e);
  process.exit(1);
});
