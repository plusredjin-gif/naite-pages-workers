/**
 * 나이테 Pages-only — 랜딩 히어로 뷰 (로그인 전 첫 화면)
 *
 * 스페이스 원본(memoaeb) 히어로 그대로:
 * - 모바일 상단 바: 햄버거(왼쪽) · 주전자 아바타(가운데) · "..."(오른쪽)
 * - 가운데 정렬: 주황 소제목 "Google Drive 연동 메모" → 큰 제목 2줄
 *   ("생각나는 순간," / "바로 남기는 메모" — "메모"가 따로 떨어지지 않음)
 *   → 설명 문구 → 흰색 pill 로그인 버튼(Google G 로고) → 작은 안내 문구
 * - 하단: 주전자 이젤 그림을 원본처럼 크게
 * - 데스크톱은 원본대로 글 왼쪽·캐릭터 오른쪽 2단 배치.
 * 캐릭터 소개 블록은 만들지 않는다 (jin 결정).
 */

import { useState } from "react";
import { NaiteLogo, Teapot } from "../components/Logo";
import { GoogleLoginButton } from "../components/GoogleLoginButton";
import "./HeroView.css";

const FEATURES = [
  {
    title: "텍스트 메모",
    desc: "제목 아래 단락으로 자유롭게 적는 기본 메모입니다.",
  },
  {
    title: "사진",
    desc: "메모에 사진을 첨부해 현장과 자료를 함께 기록합니다.",
  },
  {
    title: "체크리스트",
    desc: "할 일을 체크하며 진행 상황을 한눈에 확인합니다.",
  },
  {
    title: "음성메모",
    desc: "말로 남긴 메모를 텍스트로 바꿔 저장합니다.",
  },
  {
    title: "Drive 저장",
    desc: "메모 1개 = Drive 파일 1개, Google Drive에 안전하게 보관합니다.",
  },
  {
    title: "키워드",
    desc: "본문에서 키워드를 자동 추출해 메모를 태그로 묶습니다.",
  },
  {
    title: "온톨로지",
    desc: "키워드 사이의 상위·관련 관계를 그래프로 엮어 지식을 연결합니다.",
  },
  {
    title: "일정",
    desc: "메모에 일정을 붙이고 Google 캘린더와 연결합니다.",
  },
  {
    title: "사람",
    desc: "메모와 관련된 사람을 연락처에서 찾아 연결합니다.",
  },
  {
    title: "장소",
    desc: "메모가 쓰인 곳과 관련 장소를 함께 기록합니다.",
  },
] as const;

/** 시연용 예시 카드 3종 (원본 랜딩과 동일 — 클릭해도 로그인 전이라 열리지 않음). */
const EXAMPLE_CARDS = [
  {
    title: "장보기 목록",
    desc: "우유 · 계란 · 방울토마토 · 바질 — 체크하면 할 일로 동기화돼요.",
    tag: "생활",
  },
  {
    title: "독서 메모 — 나이테",
    desc: "나무 나이테처럼, 메모가 쌓이면 지식의 결이 보여요.",
    tag: "독서",
  },
  {
    title: "주말 산책 코스",
    desc: "한강 공원 — 사진과 위치를 함께 남긴 메모.",
    tag: "여행",
  },
] as const;

/** 동그란 라인 아이콘 스타일(앱 전체 공통)의 햄버거·점 3개 아이콘. */
function TopBarIcon(props: { kind: "menu" | "more" }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {props.kind === "menu" ? (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </>
      ) : (
        <>
          <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

export function HeroView(props: { onLogin: () => void }) {
  const { onLogin } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="hero-view">
      {/* 모바일 상단 바 (스페이스 원본 기준: 햄버거 · 아바타 · "..."). */}
      <div className="hero-topbar">
        <button
          type="button"
          className="hero-topbar-btn"
          aria-label="메뉴"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <TopBarIcon kind="menu" />
        </button>
        <span className="hero-topbar-avatar" aria-hidden="true">
          <Teapot expression="wave" alt="" />
        </span>
        <button
          type="button"
          className="hero-topbar-btn"
          aria-label="더 보기"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <TopBarIcon kind="more" />
        </button>
        {menuOpen ? (
          <nav className="hero-topbar-menu" aria-label="히어로 메뉴">
            <button type="button" onClick={onLogin}>
              Google로 로그인
            </button>
            <a href="/privacy">개인정보처리방침</a>
            <a href="#features" onClick={() => setMenuOpen(false)}>
              기능 소개
            </a>
          </nav>
        ) : null}
      </div>

      <section className="hero">
        <div className="hero-text">
          <NaiteLogo size={56} />
          <p className="hero-eyebrow">Google Drive 연동 메모</p>
          <h1>
            <span className="hero-line">생각나는 순간,</span>
            <span className="hero-line">바로 남기는 메모</span>
          </h1>
          <p className="hero-desc">
            텍스트·사진·체크리스트·음성까지 한 메모에. 로그인하면 내 Google
            Drive의 memo 폴더에 파일로 저장됩니다.
          </p>
          <div className="toolbar hero-login">
            <GoogleLoginButton onClick={onLogin} label="Google 계정으로 로그인" />
          </div>
          <p className="hero-note">
            따로 회원가입 없이, 쓰던 Google 계정으로 바로 시작합니다.
          </p>
        </div>
        <div className="hero-art">
          <Teapot expression="drawing" alt="이젤 앞에서 붓으로 로고를 그리는 주전자 캐릭터" />
        </div>
      </section>

      <section className="example-cards" aria-label="예시 메모">
        {EXAMPLE_CARDS.map((c) => (
          <article key={c.title} className="example-card">
            <span className="example-tag">{c.tag}</span>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
            <p className="meta">예시 카드입니다 — 로그인하면 내 메모가 보입니다.</p>
          </article>
        ))}
      </section>

      <section className="feature-list" id="features" aria-label="나이테 기능">
        {FEATURES.map((f) => (
          <article key={f.title} className="feature-card">
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
