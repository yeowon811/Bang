import type { Card } from '../shared/cards';
import { useCardConfig } from './cardConfig';

const SUIT = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' } as const;
export const rankLabel = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);

interface Props {
  card?: Card; // 실제 카드 (무늬/숫자 표시)
  imageKey?: string; // card 대신 항목 키만 (역할, 뒷면 등)
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  highlight?: boolean;
  dim?: boolean;
  onClick?: () => void;
  title?: string;
}

export default function CardView({ card, imageKey, size = 'md', selected, highlight, dim, onClick, title }: Props) {
  const { cards } = useCardConfig();
  const key = card?.type ?? imageKey ?? 'back';
  const info = cards[key];
  const color = info?.color ?? (info?.kind === 'card' || !info ? 'brown' : info.kind);
  const cls = ['card', `card-${size}`, `card-${color}`, selected && 'selected', highlight && 'highlight', dim && 'dim', onClick && 'clickable']
    .filter(Boolean)
    .join(' ');
  const red = card && (card.suit === 'hearts' || card.suit === 'diamonds');

  return (
    <div className={cls} onClick={onClick} title={title ?? (info ? `${info.name}\n${info.description}` : '')}>
      {info?.image ? (
        <img src={info.image} alt={info.name} draggable={false} />
      ) : (
        <div className="card-text">
          <div className="card-name">{key === 'back' ? '' : info?.name ?? key}</div>
          {size !== 'sm' && <div className="card-desc">{info?.description}</div>}
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
