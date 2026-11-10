/**
 * 나이테 자체 로그인·동의 안내 (Google 공식 동의 화면을 흉내 내지 않음).
 * 실제 로그인·동의는 accounts.google.com 공식 UI로만 진행한다.
 */
export function LoginGuide(props: {
  onLogin: () => void;
  notice?: string | null;
  busy?: boolean;
  clientConfigured: boolean;
}) {
  const { onLogin, notice, busy, clientConfigured } = props;
  return (
    <section className="login-guide" aria-label="로그인 안내">
      <h1>나이테</h1>
      <p className="lead">메모를 보려면 Google 로그인이 필요합니다.</p>
      <p className="meta">
        「Google로 로그인」을 누르면 <strong>Google 공식 로그인·동의 화면</strong>이 열립니다.
        이 페이지는 그 화면을 흉내 내지 않고, 왜 권한이 필요한지만 미리 알려 드립니다.
        동의 화면에 보이는 앱 이름·로고는 Google Cloud 콘솔 설정에 따릅니다.
      </p>
      <ul className="guide-list">
        <li>
          <strong>드라이브(<code>drive.file</code>)</strong> — 이 앱이 만들거나 사용자가 직접
          열어준 <code>memo</code> 폴더의 메모 파일만 읽고 씁니다. 다른 Drive 파일은
          보지 않습니다. 원본 앱 메모는 Drive 파일 선택기에서 직접 골라
          가져올 수 있습니다. 메모 동기화·가져오기에 씁니다.
        </li>
        <li>
          <strong>캘린더 일정(<code>calendar.events</code>)·할 일(<code>tasks</code>)</strong> —
          메모에 연결한 일정·할 일을 만들고 확인할 때만 씁니다. 캘린더
          설정·공유에는 접근하지 않습니다.
        </li>
        <li>
          <strong>연락처 읽기(<code>contacts.readonly</code>)</strong> — 검색에만 쓰며 연락처 전체를
          내려받지 않도록 구현되어 있습니다.
        </li>
        <li>
          <strong>토큰 보관</strong> — access token은 이 브라우저의 sessionStorage에만 둡니다.
          refresh token은 브라우저에 저장하지 않습니다. 탭을 닫거나 만료되면 다시 로그인해야 합니다.
        </li>
        <li>
          <strong>끊기</strong> — 로그아웃으로 이 브라우저의 토큰을 지울 수 있습니다. Google 계정 →
          보안 → ‘타사 앱 액세스’에서도 권한을 취소할 수 있습니다.
        </li>
      </ul>
      {!clientConfigured ? (
        <p className="notice" role="alert">
          Google OAuth 클라이언트 ID(<code>VITE_GOOGLE_CLIENT_ID</code>)가 아직 없습니다.
          배포 전에 공개 웹 클라이언트 ID와 승인된 JavaScript 원본·리다이렉트 URI
          (<code>{typeof window !== "undefined" ? window.location.origin : "https://…"}/auth/callback</code>)를
          콘솔에 등록해야 합니다. 클라이언트 비밀번호는 브라우저에 넣지 않습니다.
        </p>
      ) : null}
      {notice ? <p className="notice">{notice}</p> : null}
      <button type="button" onClick={onLogin} disabled={busy || !clientConfigured}>
        {busy ? "Google 동의 화면 여는 중…" : "Google로 로그인"}
      </button>
      <p className="meta">이 안내만으로 로그인이 완료된 것은 아닙니다. 공식 동의 후 콜백이 성공해야 합니다.</p>
    </section>
  );
}

export function PlusTreeFooter() {
  return (
    <footer className="site-foot meta">
      <span>나이테</span>
      <a href="https://www.plustree.net/" target="_blank" rel="noopener noreferrer">
        by 더하기나무
      </a>
      <a href="/privacy">개인정보처리방침</a>
      <span>Pages-only · Drive 동기화는 버튼으로 수동 실행</span>
    </footer>
  );
}
