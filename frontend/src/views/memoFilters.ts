/**
 * 나이테 Pages-only — 메모 필터·기간·정렬 공용 정의 (원본 memoaeb 기준)
 *
 * 원본 레이아웃: 왼쪽 사이드바의 보기·카테고리·키워드 섹션에서 고른 필터가
 * 격자·목록 보기에 그대로 적용된다. 제목 줄("전체 메모" + 전체 기간·최근 수정순)과
 * 보기 전환 pill 줄은 App 셸에서 그리고, GridView·MemoListView는 이 모듈의
 * 정의를 공유해 같은 필터·기간·정렬로 목록을 불러온다.
 */

export type PeriodKey = "all" | "today" | "7d" | "30d" | "year";
export type SortKey = "recent" | "oldest";

export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "all", label: "전체 기간" },
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "year", label: "올해" },
];

export const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "최근 수정순" },
  { key: "oldest", label: "오래된순" },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** 기간 선택을 api.memos.list용 from/to ISO 날짜로 바꾼다 (수정일 기준). */
export function periodRange(period: PeriodKey): { from?: string; to?: string } {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "7d":
      return { from: startOfDay(addDays(now, -6)).toISOString(), to: endOfDay(now).toISOString() };
    case "30d":
      return { from: startOfDay(addDays(now, -29)).toISOString(), to: endOfDay(now).toISOString() };
    case "year":
      return {
        from: new Date(now.getFullYear(), 0, 1).toISOString(),
        to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999).toISOString(),
      };
    case "all":
    default:
      return {};
  }
}

/** 사이드바에서 고르는 메모 필터 (원본: 보기·카테고리·키워드 섹션). */
export type MemoFilter =
  | { kind: "all" }
  | { kind: "pinned" }
  | { kind: "uncategorized" }
  | { kind: "category"; id: string; name: string }
  | { kind: "keyword"; id: string; name: string };

/** 필터를 api.memos.list 파라미터로 바꾼다. */
export function filterToListParams(filter: MemoFilter): {
  categoryId?: string;
  pinned?: boolean;
  keywordId?: string;
} {
  switch (filter.kind) {
    case "pinned":
      return { pinned: true };
    case "uncategorized":
      return { categoryId: "__none__" };
    case "category":
      return { categoryId: filter.id };
    case "keyword":
      return { keywordId: filter.id };
    case "all":
    default:
      return {};
  }
}

/** 필터에 따라 제목 줄에 보일 이름 (원본: "전체 메모" 자리). */
export function filterLabel(filter: MemoFilter): string {
  switch (filter.kind) {
    case "pinned":
      return "고정됨";
    case "uncategorized":
      return "미분류";
    case "category":
      return filter.name;
    case "keyword":
      return `#${filter.name}`;
    case "all":
    default:
      return "전체 메모";
  }
}
