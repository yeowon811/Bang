import { useRef } from 'react';
import type { Card } from '../shared/cards';
import { useCardConfig } from './cardConfig';
import { useZoom, ZoomTarget } from './zoom';

const SUIT = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' } as const;
const SUIT_KO = { hearts: '하트', diamonds: '다이아', clubs: '클로버', spades: '스페이드' } as const;
export const rankLabel = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'zoom';

interface Props {
  card?: Card; // 실제 카드 (무늬/숫자 표시)
  imageKey?: string; // card 대신 항목 키만 (역할, 캐릭터, 뒷면 등)
  size?: Size;
  selected?: boolean;
  highlight?: boolean;
  dim?: boolean;
  onClick?: () => void;
  title?: string;
  /** 확대 보기 끄기 (뒷면 등) */
  noZoom?: boolean;
}

export default function CardView({ card, imageKey, size = 'md', selected, highlight, dim, onClick, title, noZoom }: Props) {
  const { cards } = useCardConfig();
  const zoom = useZoom();
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = card?.type ?? imageKey ?? 'back';
  const info = cards[key];
  const color = info?.color ?? (info?.kind === 'card' || !info ? 'brown' : info.kind);
  const zoomable = !noZoom && key !== 'back' && size !== 'zoom';
  const cls = ['card', `card-${size}`, `card-${color}`, selected && 'selected', highlight && 'highlight', dim && 'dim', onClick && 'clickable', zoomable && 'zoomable']
    .filter(Boolean)
    .join(' ');
  const red = card && (card.suit === 'hearts' || card.suit === 'diamonds');
  const target: ZoomTarget = { card, imageKey };
  const showDesc = size === 'md' || size === 'lg' || size === 'xl' || size === 'zoom';

  const handlers = zoomable
    ? {
        onMouseEnter: () => zoom.hover(target),
        onMouseLeave: () => zoom.hover(null),
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          zoom.open(target);
        },
        onTouchStart: () => {
          longPress.current = setTimeout(() => zoom.open(target), 450);
        },
        onTouchEnd: () => longPress.current && clearTimeout(longPress.current),
        onTouchMove: () => longPress.current && clearTimeout(longPress.current),
      }
    : {};

  return (
    <div className={cls} onClick={onClick} title={zoomable ? undefined : title ?? (info ? `${info.name}\n${info.description}` : '')} {...handlers}>
      {info?.image ? (
        <img src={info.image} alt={info.name} draggable={false} />
      ) : (
        <div className="card-text">
          <div className="card-name">{key === 'back' ? '' : info?.name ?? key}</div>
          {showDesc && <div className="card-desc">{info?.description}</div>}
        </div>
      )}
      {card && (
        <div className={`card-suit ${red ? 'red' : ''}`}>
          {rankLabel(card.rank)}
          {SUIT[card.suit]}
        </div>
      )}
    </div>
  );
}

/** 확대 보기 내용: 큰 카드 + 이름/설명 (이미지 카드는 글자가 안 보일 수 있으므로 함께 표시) */
export function ZoomView({ target, mode, close }: { target: ZoomTarget; mode: 'hover' | 'modal'; close: () => void }) {
  const { cards } = useCardConfig();
  const key = target.card?.type ?? target.imageKey ?? 'back';
  const info = cards[key];
  const c = target.card;
  const body = (
    <div className={mode === 'hover' ? 'zoom-hover' : 'zoom-modal-body'} onClick={(e) => e.stopPropagation()}>
      <CardView card={c} imageKey={target.imageKey} size="zoom" />
      <div className="zoom-text">
        <b>{info?.name ?? key}</b>
        {info?.hp !== undefined && <span className="hp-label">체력 {info.hp}</span>}
        {c && (
          <span className={c.suit === 'hearts' || c.suit === 'diamonds' ? 'zoom-suit red' : 'zoom-suit'}>
            {SUIT[c.suit]} {SUIT_KO[c.suit]} {rankLabel(c.rank)}
          </span>
        )}
        <p>{info?.description}</p>
        {mode === 'modal' && <button onClick={close}>닫기</button>}
      </div>
    </div>
  );
  if (mode === 'hover') return body;
  return (
    <div className="modal zoom-modal" onClick={close}>
      {body}
    </div>
  );
}
