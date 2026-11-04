// 캐릭터 16명 — 능력 메커니즘은 원작 기본판과 같은 구성, 이름은 오리지널.
// 이름·설명·이미지는 관리자 화면에서 덮어쓸 수 있다 (키: char-<id>).

export type CharId =
  | 'thickskin' | 'gambler' | 'twinguns' | 'thorns'
  | 'bandit' | 'shadow' | 'scout' | 'clover'
  | 'dust' | 'junker' | 'hawkeye' | 'herbalist'
  | 'butcher' | 'emptyhand' | 'undertaker' | 'quickdraw';

export interface CharDef {
  id: CharId;
  name: string;
  hp: number;
  description: string;
}

export const CHARACTERS: CharDef[] = [
  { id: 'thickskin', name: '오뚝이 조', hp: 4, description: '피해를 1 받을 때마다 카드 1장을 뽑는다.' },
  { id: 'gambler', name: '도박사 루', hp: 4, description: '뽑기 단계에서 두 번째 카드를 공개한다. 하트/다이아면 1장 더 뽑는다.' },
  { id: 'twinguns', name: '쌍권총 메이', hp: 4, description: '사격과 회피를 서로 바꿔서 쓸 수 있다.' },
  { id: 'thorns', name: '가시덤불 레오', hp: 3, description: '다른 플레이어에게 피해를 1 받을 때마다 그 사람의 손패 1장을 무작위로 가져온다.' },
  { id: 'bandit', name: '노상강도 잭', hp: 4, description: '뽑기 단계의 첫 장을 덱 대신 다른 플레이어의 손패에서 무작위로 가져올 수 있다.' },
  { id: 'shadow', name: '그림자 피에르', hp: 4, description: '항상 엄폐물을 장착한 것으로 친다.' },
  { id: 'scout', name: '정찰병 키라', hp: 4, description: '뽑기 단계에서 3장을 보고 2장을 고른다. 나머지는 덱 위로 돌려놓는다.' },
  { id: 'clover', name: '네잎 클로버 니나', hp: 4, description: '판정할 때 2장을 공개하고 유리한 쪽을 쓴다.' },
  { id: 'dust', name: '먼지바람 레이', hp: 3, description: '항상 애마를 장착한 것으로 친다. (다른 사람이 볼 때 거리 +1)' },
  { id: 'junker', name: '고물상 버디', hp: 4, description: '뽑기 단계의 첫 장을 버린 카드 더미 맨 위에서 가져올 수 있다.' },
  { id: 'hawkeye', name: '매의 눈 하나', hp: 4, description: '항상 망원경을 장착한 것으로 친다. (내가 볼 때 거리 -1)' },
  { id: 'herbalist', name: '약초꾼 미나', hp: 4, description: '언제든 카드 2장을 버리고 체력 1을 회복할 수 있다.' },
  { id: 'butcher', name: '백정 브루노', hp: 4, description: '내 사격을 피하려면 회피가 2장 필요하다.' },
  { id: 'emptyhand', name: '맨손의 제니', hp: 4, description: '손패가 0장이 되면 즉시 1장을 뽑는다.' },
  { id: 'undertaker', name: '장의사 모트', hp: 4, description: '다른 플레이어가 탈락하면 그 사람의 카드를 모두 가져온다.' },
  { id: 'quickdraw', name: '번개손 테오', hp: 4, description: '사격을 횟수 제한 없이 쓸 수 있다.' },
];

export const CHAR_MAP: Record<CharId, CharDef> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<CharId, CharDef>;
