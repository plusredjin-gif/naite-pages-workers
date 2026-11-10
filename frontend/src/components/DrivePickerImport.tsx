/**
 * 나이테 Pages-only — Drive 파일 선택기(Picker) 가져오기 버튼
 *
 * drive.file 범위에서는 원본 memoaeb 메모 파일을 직접 볼 수 없으므로,
 * 사용자가 Drive 파일 선택기에서 memo 파일·폴더를 직접 골라 가져온다.
 * Picker에는 Google API 키가 필요하다. 빌드 시 `VITE_GOOGLE_API_KEY`가
 * 없으면 설정에서 키를 저장할 수 있게 입력란을 보여준다.
 */

import { useState } from "react";
import { api } from "../api";
import {
  getPickerApiKey,
  hasBuiltInPickerApiKey,
  openDrivePicker,
  savePickerApiKey,
} from "../drive-picker";

export function DrivePickerImport(props: {
  onDone: (msg: string) => void;
  onReload?: () => void;
}) {
  const { onDone, onReload } = props;
  const [busy, setBusy] = useState(false);
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  async function handlePick(mode: "files" | "folder") {
    if (busy) return;
    if (!getPickerApiKey()) {
      setShowKeySetup(true);
      onDone(
        "Drive 파일 선택기를 쓰려면 Google API 키가 먼저 필요합니다. 아래에서 API 키를 저장해주세요.",
      );
      return;
    }
    setBusy(true);
    try {
      const picked = await openDrivePicker(mode);
      if (picked.kind === "files") {
        const result = await api.drive.importPickedFiles(picked.ids);
        onDone(
          `Drive에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (선택 ${result.total ?? 0}개)` +
            (result.errors && result.errors.length > 0
              ? ` (오류 ${result.errors.length}개)`
              : ""),
        );
      } else {
        const result = await api.drive.importPickedFolder(picked.id);
        if ((result.total ?? 0) === 0) {
          onDone(
            `'${picked.name}' 폴더 안에 가져올 메모 파일이 없습니다. 메모 JSON 파일을 직접 고르는 방식으로 다시 시도해주세요.`,
          );
        } else {
          onDone(
            `'${picked.name}' 폴더에서 ${result.imported ?? 0}개 메모를 가져왔습니다. (전체 ${result.total ?? 0}개)` +
              (result.errors && result.errors.length > 0
                ? ` (오류 ${result.errors.length}개)`
                : ""),
          );
        }
      }
      onReload?.();
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      if (code === "picker_cancelled") {
        /* 취소는 아무것도 안 한다. */
      } else if (code === "picker_login_required") {
        onDone("Google 로그인이 만료됐습니다. 다시 로그인한 뒤 시도해주세요.");
      } else if (code === "picker_api_key_missing") {
        setShowKeySetup(true);
        onDone("Google API 키가 필요합니다. 아래에서 API 키를 저장해주세요.");
      } else if (code === "picker_load_failed") {
        onDone("Drive 파일 선택기를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.");
      } else if (code === "picker_no_selection") {
        onDone("선택한 파일이 없습니다.");
      } else {
        onDone(`Drive 가져오기 실패: ${code}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSaveKey() {
    const key = apiKeyInput.trim();
    if (!key) return;
    savePickerApiKey(key);
    setKeySaved(true);
    setApiKeyInput("");
    onDone("API 키를 저장했습니다. 이제 'Drive에서 파일 선택'을 눌러주세요.");
  }

  return (
    <div className="picker-import">
      <div className="toolbar">
        <button type="button" onClick={() => void handlePick("files")} disabled={busy}>
          {busy ? "가져오는 중…" : "Drive에서 파일 선택"}
        </button>
        <button type="button" onClick={() => void handlePick("folder")} disabled={busy}>
          {busy ? "가져오는 중…" : "폴더 선택"}
        </button>
      </div>
      <p className="meta">
        원본 나이테 앱의 메모를 가져오려면, 먼저 원본 앱에서 Drive 동기화를 눌러 memo
        파일을 Drive에 올린 뒤, 여기서 파일(또는 memo 폴더)을 직접 고르세요.
        이 앱은 사용자가 직접 열어준 파일만 봅니다.
      </p>
      {showKeySetup ? (
        <div className="card picker-key-setup">
          <h3>Google API 키 저장</h3>
          <p className="meta">
            Drive 파일 선택기는 Google API 키가 필요합니다. Google Cloud Console →
            API 및 서비스 → 사용자 인증 정보에서 API 키를 만들고, HTTP 리퍼러 제한에
            <code>https://naite.plustree.net/*</code>,{" "}
            <code>https://memo.plustree.net/*</code>를 추가한 뒤 여기에 저장하세요.
            키는 이 브라우저에만 저장됩니다.
          </p>
          <p className="meta">
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Cloud Console 사용자 인증 정보 열기
            </a>
          </p>
          {hasBuiltInPickerApiKey() ? (
            <p className="meta">빌드에 API 키가 이미 들어 있습니다. 아래 입력은 필요 없습니다.</p>
          ) : (
            <div className="picker-key-row">
              <input
                type="text"
                placeholder="Google API 키 입력"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                aria-label="Google API 키"
              />
              <button type="button" onClick={handleSaveKey} disabled={!apiKeyInput.trim()}>
                저장
              </button>
            </div>
          )}
          {keySaved ? <p className="meta">API 키를 저장했습니다.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
