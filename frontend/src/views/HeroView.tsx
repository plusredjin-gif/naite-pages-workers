/**
 * 나이테 Pages-only — 랜딩 히어로 뷰 (로그인 전 첫 화면)
 *
 * 원본(memoaeb) 랜딩 기준: 헤드라인 '생각나는 순간, 바로 남기는 메모',
 * 주전자 drawing 캐릭터(이젤 앞에서 붓으로 로고 그리는 장면),
 * 시연용 예시 카드 3종, 하위 기능 10개 카드.
 * 캐릭터 소개 블록은 만들지 않는다 (jin 결정).
 */

import { NaiteLogo, Teapot } from "../components/Logo";
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

export function HeroView(props: { onLogin: () => void }) {
  const { onLogin } = props;
  return (
    <div className="hero-view">
      <section className="hero">
        <div className="hero-text">
          <NaiteLogo size={56} />
          <h1>생각나는 순간, 바로 남기는 메모</h1>
          <p>
            흩어진 메모를 그냥 쌓아두지 마세요. 나이테는 메모에서 키워드를 뽑아내고,
            키워드끼리 이어 지식의 나이테를 만듭니다. 메모는 Google Drive에 그대로
            저장됩니다.
          </p>
          <div className="toolbar">
            <button type="button" onClick={onLogin}>
              Google로 로그인
            </button>
          </div>
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

      <section className="feature-list" aria-label="나이테 기능">
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
