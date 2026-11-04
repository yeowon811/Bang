// 봇 AI — 규칙 기반. 공개 정보(공개된 역할, 누가 누구를 공격했는지)만 보고 판단한다.
// botActions()는 우선순위 순서의 후보 행동 목록을 돌려주고, 서버는 처음 성공하는 1개만 실행한다.

import { Card, CardType, CARD_DEF_MAP, isWeapon } from './cards';
import type { CharId } from './characters';
import { Action, barrelCount, canAnswerAs, distance, GameState, Player, weaponRange } from './engine';

/** 공격 기록: memory[공격자][대상] = 횟수 */
export type BotMemory = Record<string, Record<string, number>>;

/** 공격성 카드를 대상에게 냈을 때 기록 (서버가 행동 성공 후 호출) */
export function recordAttack(mem: BotMemory, attackerId: string, targetId: string) {
  (mem[attackerId] ??= {})[targetId] = (mem[attackerId][targetId] ?? 0) + 1;
}

/** 지금 행동해야 하는 플레이어 */
export function whoActs(s: GameState): string | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'pickCharacter') return Object.keys(s.charOffers)[0] ?? null;
  const p = s.pending;
  if (p?.kind === 'store') return p.order[0];
  if (p?.kind === 'duel') return p.responderId;
  if (p) return p.targetId;
  return s.players[s.turn].id;
}

const VALUE: Record<CardType, number> = {
  dodge: 8, beer: 8, shot: 7, barrel: 7, wellsfargo: 7, gatling: 6, steal: 6, mustang: 6,
  stagecoach: 6, duel: 5, raid: 5, sabotage: 5, scope: 5, store: 4, saloon: 4, volcanic: 4,
  winchester: 4, carbine: 4, remington: 3, schofield: 3, jail: 3, dynamite: 1,
};
/** 캐릭터 선호 순서 (앞일수록 좋아함) */
const CHAR_RANK: CharId[] = [
  'quickdraw', 'butcher', 'shadow', 'scout', 'gambler', 'thickskin', 'twinguns', 'herbalist',
  'hawkeye', 'dust', 'clover', 'undertaker', 'bandit', 'junker', 'thorns', 'emptyhand',
];
const byValue = (a: Card, b: Card) => VALUE[a.type] - VALUE[b.type];

const hostility = (mem: BotMemory, a: string, b: string) => mem[a]?.[b] ?? 0;

/** 대상에 대한 적대 점수. 0보다 크면 공격 대상 */
export function enemyScore(s: GameState, mem: BotMemory, me: Player, t: Player): number {
  if (t.id === me.id || !t.alive) return -Infinity;
  const sheriff = s.players.find((p) => p.role === 'sheriff')!;
  const aliveN = s.players.filter((p) => p.alive).length;
  const isSheriff = t.role === 'sheriff'; // 보안관만 공개 정보
  const hitSheriff = hostility(mem, t.id, sheriff.id);
  const hitMe = hostility(mem, t.id, me.id);
  switch (me.role) {
    case 'sheriff':
      return hitMe * 10 + 1;
    case 'deputy':
      return isSheriff ? -100 : hitSheriff * 10 + hitMe * 3 - 1;
    case 'outlaw':
      return isSheriff ? 100 : 1 - hitSheriff * 10 + hitMe * 5;
    case 'renegade':
      if (isSheriff) return aliveN <= 2 ? 100 : -20;
      return hitSheriff * 5 + hitMe * 3 + 1;
  }
}

export function botActions(s: GameState, mem: BotMemory, botId: string): Action[] {
  const me = s.players.find((p) => p.id === botId)!;
  const others = s.players.filter((p) => p.alive && p.id !== me.id);
  const score = (t: Player) => enemyScore(s, mem, me, t);
  const enemies = others.filter((t) => score(t) > 0).sort((a, b) => score(b) - score(a));
  const pend = s.pending;

  // ---------- 캐릭터 고르기 ----------
  if (s.phase === 'pickCharacter') {
    const offers = s.charOffers[botId] ?? [];
    return [...offers].sort((a, b) => CHAR_RANK.indexOf(a) - CHAR_RANK.indexOf(b)).map((id) => ({ type: 'pickCharacter', characterId: id }));
  }

  // ---------- 응답 ----------
  if (pend?.kind === 'store') {
    return [...pend.cards].sort(byValue).reverse().map((c) => ({ type: 'pick', cardId: c.id }));
  }
  if (pend) {
    const need: CardType = pend.kind === 'shot' ? 'dodge' : 'shot';
    const acts: Action[] = [];
    if (pend.kind === 'shot' && pend.barrelUsed < barrelCount(me)) acts.push({ type: 'useBarrel' });
    const answers = me.hand.filter((c) => canAnswerAs(me, c.type, need)).sort((a, b) => (a.type === need ? -1 : 0) - (b.type === need ? -1 : 0));
    for (const c of answers) acts.push({ type: 'respond', cardId: c.id });
    acts.push({ type: 'respond' });
    return acts;
  }

  if (s.players[s.turn].id !== me.id) return [];

  // ---------- 뽑기 단계 ----------
  if (s.phase === 'draw') {
    if (me.character === 'scout') {
      const best = [...s.drawCards].sort(byValue).reverse().slice(0, 2);
      return [{ type: 'drawChoice', cardIds: best.map((c) => c.id) }];
    }
    const acts: Action[] = [];
    if (me.character === 'junker') {
      const top = s.discard[s.discard.length - 1];
      if (top && VALUE[top.type] >= 6) acts.push({ type: 'drawChoice', source: 'discard' });
    }
    if (me.character === 'bandit') {
      for (const t of enemies) if (t.hand.length) acts.push({ type: 'drawChoice', source: t.id });
    }
    acts.push({ type: 'drawChoice', source: 'deck' });
    return acts;
  }

  // ---------- 턴 끝 버리기 ----------
  if (s.phase === 'discard') {
    const need = me.hand.length - me.hp;
    return [{ type: 'discard', cardIds: [...me.hand].sort(byValue).slice(0, need).map((c) => c.id) }];
  }

  // ---------- 플레이 단계 ----------
  const acts: Action[] = [];
  const play = (c: Card, targetId?: string, targetCardId?: string) => acts.push({ type: 'play', cardId: c.id, targetId, targetCardId });
  const hand = [...me.hand];
  const of = (t: CardType) => hand.filter((c) => c.type === t);
  const owns = (t: CardType) => me.inPlay.some((c) => c.type === t);

  // 약초꾼: 어차피 버릴 카드가 있거나 위급할 때
  if (me.character === 'herbalist' && me.hp < me.maxHp && hand.length >= 2 && (hand.length > me.hp + 1 || me.hp <= 1)) {
    acts.push({ type: 'ability', cardIds: [...hand].sort(byValue).slice(0, 2).map((c) => c.id) });
  }

  // 카드 뽑기
  for (const c of [...of('wellsfargo'), ...of('stagecoach')]) play(c);

  // 회복
  if (me.hp < me.maxHp) {
    for (const c of of('beer')) play(c);
    for (const c of of('saloon')) play(c);
  }

  // 장착
  for (const t of ['barrel', 'mustang', 'scope'] as CardType[]) {
    const c = of(t)[0];
    if (c && !owns(t)) play(c);
  }
  const weapons = hand.filter((c) => isWeapon(c.type)).sort((a, b) => CARD_DEF_MAP[b.type].range! - CARD_DEF_MAP[a.type].range!);
  const curRange = weaponRange(me);
  const hasWeapon = me.inPlay.some((c) => isWeapon(c.type));
  for (const w of weapons) {
    const r = CARD_DEF_MAP[w.type].range!;
    if (w.type === 'volcanic' ? !hasWeapon && of('shot').length >= 2 : r > curRange) {
      play(w);
      break;
    }
  }
  if (of('dynamite')[0] && !owns('dynamite') && others.length >= 2) play(of('dynamite')[0]);

  // 빼앗기 / 버리게 하기: 상대의 좋은 장착 카드 우선
  const bestCardOf = (t: Player): string | undefined => {
    const good = t.inPlay.filter((c) => c.type !== 'jail' && c.type !== 'dynamite').sort(byValue).reverse()[0];
    return good && VALUE[good.type] >= 5 ? good.id : t.hand.length ? 'hand' : good?.id;
  };
  for (const c of of('steal')) {
    const t = enemies.find((e) => distance(s.players, me.id, e.id) <= 1 && bestCardOf(e));
    if (t) play(c, t.id, bestCardOf(t));
  }
  // 내 앞의 감옥/다이너마이트는 소매치기로 못 치우므로 훼방은 적에게만
  for (const c of of('sabotage')) {
    const t = enemies.find((e) => bestCardOf(e));
    if (t) play(c, t.id, bestCardOf(t));
  }

  // 감옥
  for (const c of of('jail')) {
    const t = enemies.find((e) => e.role !== 'sheriff' && !e.inPlay.some((x) => x.type === 'jail'));
    if (t) play(c, t.id);
  }

  // 결투: 사격이 있을 때만
  const shots = of('shot');
  if (enemies.length && shots.length >= 1) for (const c of of('duel')) play(c, enemies[0].id);

  // 광역 공격: 적이 아군보다 많거나 같을 때
  const friends = others.length - enemies.length;
  if (enemies.length && enemies.length >= friends) {
    for (const c of [...of('gatling'), ...of('raid')]) play(c);
  }

  // 사격: 사거리 안의 가장 미운 적
  const inRange = enemies.filter((e) => distance(s.players, me.id, e.id) <= weaponRange(me));
  if (inRange.length) for (const c of shots) play(c, inRange[0].id);

  for (const c of of('store')) play(c);

  acts.push({ type: 'endTurn' });
  return acts;
}

const HOSTILE: CardType[] = ['shot', 'dodge', 'duel', 'jail', 'steal', 'sabotage'];

/** 행동 실행 + 공격 기록. 사람/봇 모두 이 함수를 거친다 */
export function applyWithMemory(s: GameState, mem: BotMemory, playerId: string, a: Action, apply: (s: GameState, pid: string, a: Action) => string | null): string | null {
  const card = a.type === 'play' ? s.players.find((p) => p.id === playerId)?.hand.find((c) => c.id === a.cardId) : undefined;
  const err = apply(s, playerId, a);
  if (!err && card && a.type === 'play' && a.targetId && HOSTILE.includes(card.type)) recordAttack(mem, playerId, a.targetId);
  return err;
}

/** 봇 한 걸음: 후보를 차례로 시도해 처음 성공한 행동을 돌려준다 */
export function runBotStep(s: GameState, mem: BotMemory, botId: string, apply: (s: GameState, pid: string, a: Action) => string | null): Action | null {
  for (const a of botActions(s, mem, botId)) {
    if (!applyWithMemory(s, mem, botId, a, apply)) return a;
  }
  return null;
}
