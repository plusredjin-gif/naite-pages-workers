/**
 * 나이테 Pages-only — Google Drive 파일 선택기(Picker)
 *
 * 왜 Picker인가 (심사받기 쉽게 만들기, 2026-11-10 jin 결정):
 *  - 요청 범위를 drive.file(이 앱이 만든 파일만)로 줄였다. 제한된 범주인
 *    drive(전체)는 Google OAuth 심사가 매우 까다로워서 쓰지 않는다.
 *  - drive.file은 다른 앱(원본 memoaeb)이 만든 memo 파일을 볼 수 없다.
 *    대신 사용자가 Drive 파일 선택기에서 memo 파일을 직접 고르면,
 *    그 파일은 "사용자가 앱으로 열어준 파일"이 되어 drive.file 권한으로
 *    읽을 수 있다. 폴더를 고르면 그 폴더 안의 memo JSON을 가져온다.
 *
 * 필요한 것:
 *  - Google API 키 (Picker는 OAuth 토큰 외에 개발자 키가 필요하다).
 *    빌드 시 `VITE_GOOGLE_API_KEY`로 넣거나, 설정 화면에서 저장한다
 *    (localStorage `naite.google.api_key.v1`). API 키는 HTTP 리퍼러
 *    제한(naite.plustree.net 등)을 걸어 콘솔에서 만든다. 키가 없으면
 *    선택기는 열리지 않고 설정 안내를 보여준다.
 *  - 프로젝트 번호(`VITE_GOOGLE_PROJECT_NUMBER`)는 선택 사항이다.
 *    없으면 setAppId를 생략한다.
 *
 * 토큰은 sessionStorage의 로그인 토큰을 그대로 쓴다 (token-store).
 * 만료됐으면 Picker를 열지 않고 다시 로그인 안내를 던진다.
 */

import { loadAccessToken } from "./token-store";

const SAVED_API_KEY = "naite.google.api_key.v1";

/** Vite 빌드 시점 환경변수 읽기 (vite/client 타입이 없어서 직접 캐스트). */
function viteEnv(key: string): string | undefined {
  const meta = import.meta as unknown as {
    env?: Record<string, string | undefined>;
  };
  const value = meta.env?.[key];
  return value && value.trim() ? value.trim() : undefined;
}

/** Picker용 Google API 키: 빌드 환경변수 → 설정에서 저장한 키 순. */
export function getPickerApiKey(): string | null {
  return viteEnv("VITE_GOOGLE_API_KEY") ?? readSavedApiKey();
}

function readSavedApiKey(): string | null {
  try {
    const saved = localStorage.getItem(SAVED_API_KEY);
    return saved && saved.trim() ? saved.trim() : null;
  } catch {
    return null;
  }
}

/** 설정 화면에서 API 키를 저장한다 (브라우저 localStorage, 이 기기만). */
export function savePickerApiKey(key: string): void {
  try {
    localStorage.setItem(SAVED_API_KEY, key.trim());
  } catch {
    /* 저장 실패는 호출부에서 다시 안내한다. */
  }
}

/** 설정 화면에서 저장한 API 키가 있는지. */
export function hasSavedPickerApiKey(): boolean {
  return readSavedApiKey() !== null;
}

/** 저장한 API 키를 지운다. */
export function clearPickerApiKey(): void {
  try {
    localStorage.removeItem(SAVED_API_KEY);
  } catch {
    /* ignore */
  }
}

/** API 키가 빌드 시점에 들어갔는지 (설정 입력 없이 바로 쓸 수 있는지). */
export function hasBuiltInPickerApiKey(): boolean {
  return Boolean(viteEnv("VITE_GOOGLE_API_KEY"));
}

function getPickerProjectNumber(): string | null {
  return viteEnv("VITE_GOOGLE_PROJECT_NUMBER") ?? null;
}

export type PickerPick =
  | { kind: "files"; ids: string[] }
  | { kind: "folder"; id: string; name: string };

type PickerCallbackData = {
  action?: string;
  docs?: Array<{ id?: string; name?: string }>;
};

interface PickerBuilderLike {
  setOAuthToken(token: string): PickerBuilderLike;
  setDeveloperKey(key: string): PickerBuilderLike;
  setAppId(id: string): PickerBuilderLike;
  setCallback(cb: (data: PickerCallbackData) => void): PickerBuilderLike;
  addView(view: unknown): PickerBuilderLike;
  enableFeature(feature: unknown): PickerBuilderLike;
  setTitle(title: string): PickerBuilderLike;
  build(): { setVisible(visible: boolean): void };
}

interface DocsViewLike {
  setMimeTypes(mime: string): DocsViewLike;
  setMode(mode: unknown): DocsViewLike;
  setSelectFolderEnabled(enabled: boolean): DocsViewLike;
}

interface PickerApi {
  PickerBuilder: new () => PickerBuilderLike;
  DocsView: new (viewId?: unknown) => DocsViewLike;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  DocsViewMode: { LIST: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
}

type GapiLoader = { load: (name: string, cb: () => void) => void };

function getGapi(): GapiLoader | null {
  const w = window as unknown as { gapi?: GapiLoader };
  return w.gapi ?? null;
}

function getPickerApi(): PickerApi | null {
  const w = window as unknown as { google?: { picker?: PickerApi } };
  return w.google?.picker ?? null;
}

function loadGapiPicker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = getGapi();
    if (existing) {
      existing.load("picker", resolve);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const gapi = getGapi();
      if (!gapi) {
        reject(new Error("picker_load_failed"));
        return;
      }
      gapi.load("picker", resolve);
    };
    script.onerror = () => reject(new Error("picker_load_failed"));
    document.head.appendChild(script);
  });
}

/**
 * Drive 파일 선택기를 연다.
 *  - mode "files": 메모 JSON 파일 여러 개 선택.
 *  - mode "folder": memo 폴더 하나 선택 (안의 JSON을 한꺼번에 가져온다).
 * 에러 코드: picker_login_required / picker_api_key_missing /
 * picker_load_failed / picker_cancelled / picker_no_selection
 */
export async function openDrivePicker(mode: "files" | "folder"): Promise<PickerPick> {
  const token = loadAccessToken();
  if (!token) throw new Error("picker_login_required");
  const apiKey = getPickerApiKey();
  if (!apiKey) throw new Error("picker_api_key_missing");
  await loadGapiPicker();
  const picker = getPickerApi();
  if (!picker) throw new Error("picker_load_failed");
  return new Promise<PickerPick>((resolve, reject) => {
    const builder = new picker.PickerBuilder()
      .setOAuthToken(token.accessToken)
      .setDeveloperKey(apiKey)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const docs = (data.docs ?? []).filter(
            (doc): doc is { id: string; name: string } => Boolean(doc.id),
          );
          if (docs.length === 0) {
            reject(new Error("picker_no_selection"));
            return;
          }
          if (mode === "folder") {
            resolve({ kind: "folder", id: docs[0].id, name: docs[0].name ?? "memo" });
          } else {
            resolve({ kind: "files", ids: docs.map((doc) => doc.id) });
          }
        } else if (data.action === picker.Action.CANCEL) {
          reject(new Error("picker_cancelled"));
        }
      });
    const projectNumber = getPickerProjectNumber();
    if (projectNumber) builder.setAppId(projectNumber);
    if (mode === "folder") {
      builder.addView(
        new picker.DocsView(picker.ViewId.FOLDERS)
          .setSelectFolderEnabled(true)
          .setMode(picker.DocsViewMode.LIST),
      );
      builder.setTitle("memo 폴더 선택");
    } else {
      builder.addView(
        new picker.DocsView(picker.ViewId.DOCS)
          .setMimeTypes("application/json")
          .setMode(picker.DocsViewMode.LIST),
      );
      builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
      builder.setTitle("가져올 메모 파일 선택 (JSON)");
    }
    builder.build().setVisible(true);
  });
}
