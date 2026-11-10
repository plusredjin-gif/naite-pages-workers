/**
 * 나이테 개인정보처리방침 (/privacy, 로그인 없이 공개)
 *
 * Google OAuth 심사 제출용. 수집·이용·보관·제3자 제공·이용자 권리를
 * 한국어로 적고, 영문 요약을 함께 둔다.
 */

import { NaiteLogo } from "../components/Logo";
import { PlusTreeFooter } from "../LoginGuide";

export function PrivacyView() {
  return (
    <main className="app privacy-page">
      <header className="privacy-head">
        <NaiteLogo size={36} />
        <a href="/">← 나이테로 돌아가기</a>
      </header>
      <h1>개인정보처리방침</h1>
      <p className="meta">
        서비스: 나이테 (naite, https://naite.plustree.net) · 운영자: 더하기나무
        (PlusTree) · 문의:{" "}
        <a href="mailto:plustree@googlegroups.com">plustree@googlegroups.com</a> ·
        시행일: 2026년 11월 10일
      </p>

      <h2>1. 수집하는 정보</h2>
      <ul>
        <li>
          <strong>Google 계정 기본 정보</strong> — 이름, 이메일 주소, 프로필 정보.
          Google 로그인으로 본인을 확인하고 화면에 이름을 표시할 때만 씁니다.
        </li>
        <li>
          <strong>메모 내용</strong> — 제목, 본문, 체크리스트, 키워드, 카테고리, 메모에
          첨부한 사진·음성 메모. 메모를 저장하고 보여주기 위해 필요합니다.
        </li>
        <li>
          <strong>Google Drive 파일</strong> — Drive의 <code>memo</code> 폴더에 있는
          메모 파일. 이 앱이 만든 파일, 또는 사용자가 파일 선택기에서 직접
          열어준 파일만 읽고 씁니다. 다른 Drive 파일은 보지 않습니다.
        </li>
        <li>
          <strong>캘린더 일정·할 일</strong> — 메모에 연결한 일정과 체크리스트만
          Google 캘린더·Google Tasks와 주고받습니다.
        </li>
        <li>
          <strong>연락처</strong> — 메모에 사람을 연결할 때 이름·이메일로 검색한
          결과만 씁니다. 연락처 전체를 내려받거나 저장하지 않습니다.
        </li>
        <li>
          <strong>장소·위치</strong> — 메모에 연결한 장소, 메모 작성 시 기록한 현재
          위치(사용자가 위치 기록을 켠 경우만).
        </li>
      </ul>

      <h2>2. 수집 목적</h2>
      <p>
        메모를 저장하고 여러 기기에서 이어서 보기 위해, 메모에 일정·할 일·사람·장소를
        연결하기 위해, 그리고 사용자가 직접 요청한 Drive 가져오기·동기화를 실행하기
        위해서만 정보를 씁니다. 광고나 마케팅에는 쓰지 않습니다.
      </p>

      <h2>3. 저장 위치와 보관 기간</h2>
      <ul>
        <li>
          메모와 첨부 파일은 <strong>사용자 본인의 Google Drive</strong>(memo 폴더)와{" "}
          <strong>사용자 브라우저의 로컬 저장소</strong>에 저장됩니다.
        </li>
        <li>
          나이테는 별도 서버에 메모를 저장하지 않습니다. 이 앱은 서버가 없는 정적
          앱(Pages-only)이며, 로그인 토큰도 브라우저의 sessionStorage에만 두고 탭을
          닫으면 지워집니다.
        </li>
        <li>
          보관 기간은 사용자가 메모·파일을 삭제할 때까지입니다. Google 계정 설정에서
          나이테의 접근 권한을 취소하면 이 앱은 더 이상 Google 데이터에 접근하지
          않습니다.
        </li>
      </ul>

      <h2>4. 제3자 제공</h2>
      <p>
        수집한 정보를 제3자에게 판매하거나 공유하지 않습니다. Google API(Drive·
        캘린더·Tasks·People)는 사용자가 직접 요청한 기능(메모 저장, 일정·할 일 연결,
        연락처 검색)을 실행하기 위해서만 호출합니다.
      </p>

      <h2>5. 이용자의 권리</h2>
      <ul>
        <li>앱 안에서 메모·사진·음성·일정·할 일·사람·장소 연결을 직접 삭제할 수 있습니다.</li>
        <li>
          Google Drive의 memo 폴더에서 메모 파일을 직접 삭제할 수 있습니다.
        </li>
        <li>
          Google 계정 → 보안 → 타사 앱 액세스에서 나이테 권한을 취소하면 접근이
          즉시 중단됩니다. 로그아웃하면 이 브라우저의 토큰이 지워집니다.
        </li>
      </ul>

      <h2>6. 쿠키와 추적</h2>
      <p>
        광고·추적 쿠키를 쓰지 않습니다. 로그인을 유지하기 위한 토큰만 브라우저
        sessionStorage에 두며, 탭을 닫으면 지워집니다.
      </p>

      <h2>7. 방침 변경</h2>
      <p>
        이 방침이 바뀌면 이 페이지에 바뀐 내용을 공지합니다. 문의는{" "}
        <a href="mailto:plustree@googlegroups.com">plustree@googlegroups.com</a>으로
        보내주세요.
      </p>

      <h2>Privacy Policy (English summary)</h2>
      <p>
        Naite (https://naite.plustree.net) is a personal memo app operated by
        PlusTree. We collect only what the app needs: your Google profile (name
        and email, for sign-in), your memos (text, checklists, keywords,
        attachments), files in your Google Drive <code>memo</code> folder that
        this app created or that you opened with the Drive file picker,
        calendar events and tasks you linked to memos, contacts you searched for
        and registered, and places or locations you attached to memos. Memos are
        stored in your own Google Drive and in your browser&apos;s local storage;
        we run no server that stores your memos. We do not sell or share your
        data with third parties. Google APIs are called only to carry out
        features you requested (saving memos, linking events and tasks, searching
        contacts). You can delete memos in the app, delete files from your Drive
        memo folder, and revoke the app&apos;s access at any time in your Google
        account security settings. Contact:{" "}
        <a href="mailto:plustree@googlegroups.com">plustree@googlegroups.com</a>.
        Effective: 10 November 2026.
      </p>

      <PlusTreeFooter />
    </main>
  );
}
