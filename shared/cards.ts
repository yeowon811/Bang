// 카드 정의 — 장수/효과는 원작 기본판과 같은 80장 구성, 이름은 오리지널.
// 이름·설명·이미지는 관리자 화면에서 덮어쓸 수 있다 (data/card-config.json).

import { CHARACTERS, CharId } from './characters';

export type Suit ='hearts' | 'diamonds' | 'clubs' | 'spades';
export type Role = 'sheriff' | 'deputy' | 'outlaw' | 'renegade';

export type CardType =
  // 갈색 (즉시 사용)
  | 'shot' | 'dodge' | 'beer' | 'saloon' | 'stagecoach' | 'wellsfargo'
  | 'steal' | 'sabotage' | 'store' | 'raid' | 'duel' | 'gatling'
  // 파란색 (장착)
  | 'barrel' | 'scope' | 'mustang' | 'jail' | 'dynamite'
  | 'volcanic' | 'schofield' | 'remington' | 'carbine' | 'winchester';

/** none: 대상 없음 / player: 플레이어 지정 / playerCard: 플레이어의 카드 지정 */
export type TargetKind = 'none' | 'player' | 'playerCard';

export interface CardDef {
  type: CardType;
  name: string;
  description: string;
  count: number;
  color: 'brown' | 'blue';
  target: TargetKind;
  /** 무기 사거리 (무기만) */
  range?: number;
}

export interface Card {
  id: string;
  type: CardType;
  suit: Suit;
  rank: number; // 2~14 (11=J, 12=Q, 13=K, 14=A)
}

export const CARD_DEFS: CardDef[] = [
  { type: 'shot', name: '사격', description: '사거리 안의 한 명에게 피해 1. 턴당 1장만 사용.', count: 25, color: 'brown', target: 'player' },
  { type: 'dodge', name: '회피', description: '사격 1발을 피한다. 공격받았을 때만 사용.', count: 12, color: 'brown', target: 'none' },
  { type: 'beer', name: '위스키', description: '체력 +1. 2명만 남았을 때는 효과 없음.', count: 6, color: 'brown', target: 'none' },
  { type: 'steal', name: '소매치기', description: '거리 1 이내 플레이어의 카드 1장을 가져온다.', count: 4, color: 'brown', target: 'playerCard' },
  { type: 'sabotage', name: '훼방', description: '아무 플레이어의 카드 1장을 버리게 한다.', count: 4, color: 'brown', target: 'playerCard' },
  { type: 'duel', name: '결투', description: '지정한 상대부터 번갈아 사격을 낸다. 못 내는 쪽이 피해 1.', count: 3, color: 'brown', target: 'player' },
  { type: 'stagecoach', name: '보급마차', description: '카드 2장을 뽑는다.', count: 2, color: 'brown', target: 'none' },
  { type: 'store', name: '만물상', description: '생존자 수만큼 카드를 공개하고, 자신부터 1장씩 가져간다.', count: 2, color: 'brown', target: 'none' },
  { type: 'raid', name: '습격', description: '다른 모두가 사격 1장을 버리거나 피해 1을 받는다.', count: 2, color: 'brown', target: 'none' },
  { type: 'wellsfargo', name: '금고털이', description: '카드 3장을 뽑는다.', count: 1, color: 'brown', target: 'none' },
  { type: 'gatling', name: '난사', description: '다른 모두에게 사격 1발.', count: 1, color: 'brown', target: 'none' },
  { type: 'saloon', name: '축제', description: '살아있는 모두의 체력 +1.', count: 1, color: 'brown', target: 'none' },

  { type: 'schofield', name: '리볼버', description: '무기. 사거리 2.', count: 3, color: 'blue', target: 'none', range: 2 },
  { type: 'jail', name: '감옥', description: '다른 플레이어(보안관 제외)에게 건다. 턴 시작 시 판정: 하트면 탈출, 아니면 턴을 건너뛴다.', count: 3, color: 'blue', target: 'player' },
  { type: 'volcanic', name: '연발권총', description: '무기. 사거리 1. 사격을 횟수 제한 없이 사용.', count: 2, color: 'blue', target: 'none', range: 1 },
  { type: 'barrel', name: '엄폐물', description: '사격을 받으면 판정: 하트면 회피한 것으로 친다.', count: 2, color: 'blue', target: 'none' },
  { type: 'mustang', name: '애마', description: '다른 사람이 나를 볼 때 거리 +1.', count: 2, color: 'blue', target: 'none' },
  { type: 'remington', name: '장총', description: '무기. 사거리 3.', count: 1, color: 'blue', target: 'none', range: 3 },
  { type: 'carbine', name: '카빈', description: '무기. 사거리 4.', count: 1, color: 'blue', target: 'none', range: 4 },
  { type: 'winchester', name: '저격총', description: '무기. 사거리 5.', count: 1, color: 'blue', target: 'none', range: 5 },
  { type: 'scope', name: '망원경', description: '내가 다른 사람을 볼 때 거리 -1.', count: 1, color: 'blue', target: 'none' },
  { type: 'dynamite', name: '다이너마이트', description: '턴 시작 시 판정: 스페이드 2~9면 폭발해 피해 3, 아니면 다음 사람에게 넘어간다.', count: 1, color: 'blue', target: 'none' },
];

export const CARD_DEF_MAP: Record<CardType, CardDef> = Object.fromEntries(
  CARD_DEFS.map((d) => [d.type, d]),
) as Record<CardType, CardDef>;

export const isWeapon = (t: CardType) => CARD_DEF_MAP[t].range !== undefined;

export const ROLE_DEFS: { role: Role; name: string; description: string }[] = [
  { role: 'sheriff', name: '보안관', description: '정체 공개. 무법자와 배신자를 모두 제거하면 승리. 체력 +1.' },
  { role: 'deputy', name: '부관', description: '보안관을 도와 무법자와 배신자를 제거하면 승리.' },
  { role: 'outlaw', name: '무법자', description: '보안관을 제거하면 승리.' },
  { role: 'renegade', name: '배신자', description: '마지막까지 혼자 살아남으면 승리.' },
];

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

/** 80장 덱 생성. 무늬는 정확히 1/4씩, 숫자는 고르게 분산. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let i = 0;
  for (const def of CARD_DEFS) {
    for (let n = 1; n <= def.count; n++) {
      deck.push({ id: `${def.type}-${n}`, type: def.type, suit: SUITS[i % 4], rank: 2 + ((i * 5) % 13) });
      i++;
    }
  }
  return deck;
}

/** 관리자 화면에서 이미지를 넣을 수 있는 항목 키 */
export type ImageKey = CardType | `role-${Role}` | `char-${CharId}` | 'back';

export const IMAGE_KEYS: ImageKey[] = [
  ...CARD_DEFS.map((d) => d.type),
  ...ROLE_DEFS.map((r) => `role-${r.role}` as const),
  ...CHARACTERS.map((c) => `char-${c.id}` as const),
  'back',
];
