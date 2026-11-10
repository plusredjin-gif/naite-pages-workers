/**
 * 나이테 로고 (Pages-only 정적판)
 *
 * 원본(memoaeb) 로고 그대로: 손그림 동심원 결 + 붓글씨 'naite' PNG
 * (public/assets/naite-logo.png, 원본 client/src/assets에서 복사) +
 * 한글 '나이테' 텍스트(테만 주황 #e8590c).
 */

/** 원본 로고 이미지. 가로가 긴 락업이라 높이를 기준으로 쓴다. */
export function NaiteLogo(props: { height?: number; size?: number; withKorean?: boolean; className?: string }) {
  const { height, size, withKorean = true, className } = props;
  const h = height ?? size ?? 40;
  return (
    <span className={className ?? "naite-logo"}>
      <img
        src="/assets/naite-logo.png"
        alt="naite 로고"
        style={{ height: h, width: "auto", display: "block" }}
      />
      {withKorean ? (
        <span className="naite-ko">
          나이<span className="naite-ko-accent">테</span>
        </span>
      ) : null}
    </span>
  );
}

/** 작은 자리(파비콘 대용·칩 등)용 심플 SVG 마크. 원본 동심원 결을 간략히 재현. */
export function NaiteMark(props: { size?: number }) {
  const s = props.size ?? 36;
  const arc = (r: number) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const x1 = 18 + r * Math.cos(rad(-210));
    const y1 = 18 + r * Math.sin(rad(-210));
    const x2 = 18 + r * Math.cos(rad(30));
    const y2 = 18 + r * Math.sin(rad(30));
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  return (
    <svg width={s} height={s} viewBox="0 0 36 36" role="img" aria-label="나이테 로고 마크" style={{ flexShrink: 0 }}>
      <path d={arc(15)} fill="none" stroke="#C2571B" strokeWidth={2.4} strokeLinecap="round" />
      <path d={arc(10.5)} fill="none" stroke="#B98A4E" strokeWidth={2.2} strokeLinecap="round" />
      <path d={arc(6)} fill="none" stroke="#6B4A2F" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

/**
 * 주전자 캐릭터. 원본(memoaeb) 풀사이즈 PNG 그대로 사용한다.
 * 배치 원칙(원본): drawing=히어로, good=동의, best=빈 목록,
 * cheer=검색 결과 없음, laugh=온톨로지 빈 상태, wave=인사, sleep=대기.
 */
export const TEAPOT_EXPRESSIONS = {
  drawing: "teapot-drawing.png",
  wave: "teapot-wave.png",
  waving: "teapot-wave.png",
  laugh: "teapot-laugh.png",
  good: "teapot-good.png",
  sleepy: "teapot-sleep.png",
  sleep: "teapot-sleep.png",
  best: "teapot-best.png",
  cheer: "teapot-cheer.png",
} as const;

export type TeapotExpression = keyof typeof TEAPOT_EXPRESSIONS;

export function Teapot(props: { expression?: TeapotExpression; alt?: string; className?: string }) {
  const { expression = "wave", alt = "주전자 캐릭터", className } = props;
  return (
    <img
      src={`/assets/teapot/${TEAPOT_EXPRESSIONS[expression]}`}
      alt={alt}
      className={className ?? "teapot-img"}
      loading="lazy"
    />
  );
}
