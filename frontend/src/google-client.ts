/**
 * 나이테 Pages-only — 브라우저 직접 Google API 호출 (google-client.ts)
 *
 * Worker 중계가 없어졌으므로, 프론트엔드가 Google API를 브라우저에서 직접 부른다.
 *  - Drive API v3: memo 폴더 파일 CRUD (drive.file 범위 — 앱이 만든 파일만 접근)
 *  - Calendar API v3: 일정 생성·조회
 *  - Tasks API v1: 할일 목록·동기화
 *  - People API v1: 연락처 검색 (searchContacts만, 전체 열거 없음)
 *  - Geocoding API: 장소 검색·역지오코딩 (API 키 필요 — 아래 주의 참조)
 *
 * 인증: 모든 호출은 Authorization: Bearer <access_token>을 붙인다.
 * 토큰은 AuthProvider(그록 소유 로그인)가 공급한다. 이 파일은 토큰을
 * 발급·갱신하지 않는다. 토큰이 없거나 401이면 호출자가 재로그인으로 보낸다.
 *
 * 주의 — 클라이언트 ID·API 키 노출:
 *  - Google OAuth 클라이언트 ID는 공개 식별자라 브라우저 번들에 실려도 되지만,
 *    클라이언트 보안 비밀번호(client_secret)는 절대 브라우저에 두지 않는다.
 *  - Geocoding용 Maps API 키는 브라우저에서 그대로 노출된다. 키 도용을 막으려면
 *    Google Cloud 콘솔에서 HTTP 리퍼러 제한(naite.plustree.net만 허용)을
 *    반드시 설정해야 한다. 키가 없으면 장소 검색·역지오코딩은 미지원이다.
 */

import { loadAccessToken } from "./token-store";

/** 토큰 공급자. AuthProvider(그록 소유)가 구현한다. */
export interface TokenProvider {
  /**
   * 쓸 수 있는 access_token을 반환한다. 없거나 만료됐으면 null.
   * null이면 호출자는 AuthProvider.login()으로 보내면 된다.
   */
  getAccessToken(): Promise<string | null>;
}

export class GoogleApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const UNAUTHORIZED_CODE = "UNAUTHORIZED";
export const TOKEN_EXPIRED_CODE = "TOKEN_EXPIRED_RELOGIN_REQUIRED";

/** 기본 토큰 공급자: sessionStorage에 저장된 토큰을 쓴다. */
export const sessionTokenProvider: TokenProvider = {
  async getAccessToken(): Promise<string | null> {
    return loadAccessToken()?.accessToken ?? null;
  },
};

/** Google API 한 번 호출. 401이면 토큰 만료 에러를 던진다 (재로그인 유도). */
export async function googleFetch(
  provider: TokenProvider,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await provider.getAccessToken();
  if (!token) {
    throw new GoogleApiError(401, TOKEN_EXPIRED_CODE, "access_token이 없습니다. 다시 로그인하세요.");
  }
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    throw new GoogleApiError(401, TOKEN_EXPIRED_CODE, "access_token이 만료됐습니다. 다시 로그인하세요.");
  }
  return res;
}

/** Google API JSON 호출. 401 외의 오류는 GoogleApiError로 던진다. */
export async function googleFetchJson<T>(
  provider: TokenProvider,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await googleFetch(provider, url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GoogleApiError(res.status, `google_api_error_${res.status}`, body.slice(0, 200));
  }
  return (await res.json()) as T;
}

/** 로그인한 사용자 정보 (userinfo). /api/auth/me 대체 수단 — 그록 AuthProvider가 쓴다. */
export async function fetchGoogleUserinfo(
  provider: TokenProvider,
): Promise<{ sub: string; email?: string; name?: string }> {
  return googleFetchJson(provider, "https://openidconnect.googleapis.com/v1/userinfo");
}

/* ---------------- Drive API v3 (직접 호출) ---------------- */

export const MEMO_FOLDER_NAME = "memo";

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
};

export async function driveFindMemoFolder(provider: TokenProvider): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${MEMO_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const data = await googleFetchJson<{ files?: Array<{ id?: string }> }>(
    provider,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
  );
  return data.files?.[0]?.id ?? null;
}

export async function driveEnsureMemoFolder(provider: TokenProvider): Promise<string | null> {
  const existing = await driveFindMemoFolder(provider);
  if (existing) return existing;
  const data = await googleFetchJson<{ id?: string }>(
    provider,
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: MEMO_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    },
  );
  return data.id ?? null;
}

export async function driveListMemoFiles(
  provider: TokenProvider,
  folderId: string,
): Promise<DriveFileMeta[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await googleFetchJson<{ files?: DriveFileMeta[] }>(
    provider,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,mimeType)&pageSize=100`,
  );
  return (data.files ?? []).filter(
    (f) => f.mimeType === "application/json" || f.name.endsWith(".json"),
  );
}

export async function driveDownloadJson<T>(provider: TokenProvider, fileId: string): Promise<T> {
  const res = await googleFetch(
    provider,
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  );
  if (!res.ok) throw new GoogleApiError(res.status, `drive_download_failed_${res.status}`);
  return (await res.json()) as T;
}

/** 메모 JSON을 Drive memo 폴더에 올린다 (신규 생성 또는 기존 파일 PATCH). */
export async function driveUploadMemoJson(
  provider: TokenProvider,
  folderId: string,
  fileName: string,
  payload: string,
  existingFileId?: string | null,
): Promise<string | null> {
  const boundary = `naite-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: "application/json",
    ...(existingFileId ? {} : { parents: [folderId] }),
  });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n` +
    `--${boundary}--`;
  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const data = await googleFetchJson<{ id?: string }>(provider, url, {
    method: existingFileId ? "PATCH" : "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return data.id ?? existingFileId ?? null;
}

/** 첨부 파일(사진·음성)을 Drive memo 폴더에 올린다. R2 대체 — 파일은 Drive에 남는다. */
export async function driveUploadAttachment(
  provider: TokenProvider,
  folderId: string,
  file: File,
): Promise<{ id: string; webViewLink: string }> {
  if (file.size > 20 * 1024 * 1024) {
    throw new GoogleApiError(413, "file_too_large", "20MB 초과 파일은 올릴 수 없습니다.");
  }
  const boundary = `naite-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    parents: [folderId],
  });
  // File 본문은 multipart 텍스트로 합칠 수 없으므로 FormData 대신
  // 메타데이터+바이너리를 직접 이어붙인 Uint8Array 본문을 만든다.
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const bytes = await file.arrayBuffer();
  const merged = new Uint8Array(head.length + bytes.byteLength + tail.length);
  merged.set(head, 0);
  merged.set(new Uint8Array(bytes), head.length);
  merged.set(tail, head.length + bytes.byteLength);
  const data = await googleFetchJson<{ id?: string; webViewLink?: string }>(
    provider,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: merged,
    },
  );
  if (!data.id) throw new GoogleApiError(502, "drive_upload_failed");
  return { id: data.id, webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` };
}

/* ---------------- Calendar API v3 (직접 호출) ---------------- */

export async function calendarCreateEvent(
  provider: TokenProvider,
  event: { summary: string; description?: string; start: string; end: string; allDay?: boolean },
): Promise<string | null> {
  const body: Record<string, unknown> = {
    summary: event.summary,
    description: event.description ?? "",
  };
  if (event.allDay) {
    body.start = { date: event.start.slice(0, 10) };
    body.end = { date: event.end.slice(0, 10) };
  } else {
    body.start = { dateTime: event.start };
    body.end = { dateTime: event.end };
  }
  const data = await googleFetchJson<{ id?: string }>(
    provider,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  return data.id ?? null;
}

export type CalendarEventItem = {
  id?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export async function calendarListAgenda(
  provider: TokenProvider,
  days = 30,
): Promise<CalendarEventItem[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=" +
    encodeURIComponent(timeMin) +
    "&timeMax=" +
    encodeURIComponent(timeMax) +
    "&singleEvents=true&orderBy=startTime&maxResults=100";
  const data = await googleFetchJson<{ items?: CalendarEventItem[] }>(provider, url);
  return data.items ?? [];
}

/* ---------------- Tasks API v1 (직접 호출) ---------------- */

export async function tasksGetOrCreateListId(provider: TokenProvider): Promise<string | null> {
  const lists = await googleFetchJson<{ items?: Array<{ id?: string; title?: string }> }>(
    provider,
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
  );
  const found = (lists.items ?? []).find((l) => l.title === "나이테 메모");
  if (found?.id) return found.id;
  const created = await googleFetchJson<{ id?: string }>(
    provider,
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "나이테 메모" }),
    },
  );
  return created.id ?? null;
}

export type GoogleTaskItem = {
  id?: string;
  title?: string;
  status?: string;
  due?: string;
  notes?: string;
  parent?: string;
};

export async function tasksList(provider: TokenProvider, listId: string): Promise<GoogleTaskItem[]> {
  const data = await googleFetchJson<{ items?: GoogleTaskItem[] }>(
    provider,
    `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&maxResults=100`,
  );
  return data.items ?? [];
}

export async function tasksCreateOrPatch(
  provider: TokenProvider,
  listId: string,
  task: { title: string; status: string; notes?: string; due?: string },
  existingId?: string | null,
): Promise<string | null> {
  const url = existingId
    ? `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${existingId}`
    : `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`;
  const data = await googleFetchJson<{ id?: string }>(provider, url, {
    method: existingId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  return data.id ?? existingId ?? null;
}

/* ---------------- People API v1 (직접 호출 — 검색만) ---------------- */

export type PeopleCandidate = {
  googleResourceName: string;
  name: string;
  email: string;
  phone: string;
};

/** 연락처 검색: searchContacts만 사용한다. 전체 열거(list)는 하지 않는다. */
export async function peopleSearchContacts(
  provider: TokenProvider,
  q: string,
): Promise<PeopleCandidate[]> {
  const url =
    "https://people.googleapis.com/v1/people:searchContacts?query=" +
    encodeURIComponent(q) +
    "&readMask=names,emailAddresses,phoneNumbers&pageSize=10";
  const data = await googleFetchJson<{
    results?: Array<{
      person?: {
        resourceName?: string;
        names?: Array<{ displayName?: string }>;
        emailAddresses?: Array<{ value?: string }>;
        phoneNumbers?: Array<{ value?: string }>;
      };
    }>;
  }>(provider, url);
  return (data.results ?? [])
    .map((r) => ({
      googleResourceName: r.person?.resourceName ?? "",
      name: r.person?.names?.[0]?.displayName ?? "",
      email: r.person?.emailAddresses?.[0]?.value ?? "",
      phone: r.person?.phoneNumbers?.[0]?.value ?? "",
    }))
    .filter((c) => c.name);
}

/* ---------------- Geocoding API (직접 호출 — API 키 필요) ---------------- */

/**
 * 장소 검색. Maps API 키가 없으면 null을 반환한다 (미지원 — 에러가 아니라 제한).
 * 키는 Vite 환경변수 VITE_GOOGLE_MAPS_API_KEY로 번들에 실린다.
 * 키 도용 방지를 위해 Google Cloud 콘솔에서 HTTP 리퍼러 제한이 필수다.
 */
export async function geocodeSearch(
  mapsApiKey: string | null,
  q: string,
): Promise<Array<{ name: string; address: string; lat: number | null; lng: number | null; partialMatch: boolean }> | null> {
  if (!mapsApiKey) return null;
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(q) +
    "&key=" +
    encodeURIComponent(mapsApiKey) +
    "&language=ko";
  const res = await fetch(url);
  if (!res.ok) throw new GoogleApiError(res.status, `geocode_failed_${res.status}`);
  const data = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
      partial_match?: boolean;
    }>;
  };
  return (data.results ?? []).map((r) => {
    const loc = r.geometry?.location;
    const certain =
      r.geometry?.location_type === "ROOFTOP" || r.geometry?.location_type === "RANGE_INTERPOLATED";
    return {
      name: q,
      address: r.formatted_address ?? "",
      // 건물 단위 확정이 아니면 좌표를 비워둔다 (지어내지 않음).
      lat: certain && typeof loc?.lat === "number" ? loc.lat : null,
      lng: certain && typeof loc?.lng === "number" ? loc.lng : null,
      partialMatch: r.partial_match ?? false,
    };
  });
}

/** 역지오코딩. 키가 없거나 실패하면 null (좌표만 저장한다). */
export async function reverseGeocode(
  mapsApiKey: string | null,
  lat: number,
  lng: number,
): Promise<string | null> {
  if (!mapsApiKey) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(mapsApiKey)}&language=ko`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ formatted_address?: string }> };
    return data.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}
