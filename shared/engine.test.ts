// 1) 캐릭터 능력별 시나리오 테스트
// 2) 무작위 플레이어끼리 수천 판을 돌려 엔진이 멈추거나 카드가 사라지지 않는지 확인
import { Action, applyAction, createGame, GameState, distance, isOver } from './engine';
import { buildDeck, Card, CardType } from './cards';
import { CharId } from './characters';

const TOTAL = buildDeck().length;

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`);
}
function ok(err: string | null, msg: string) {
  if (err) throw new Error(`❌ ${msg}: ${err}`);
}

// ---------- 시나리오 테스트 ----------
let fake = 0;
const mk = (type: CardType, suit: Card['suit'] = 'clubs', rank = 10): Card => ({ id: `t${fake++}`, type, suit, rank });

/** 고정 캐릭터로 게임을 만들고 p0의 플레이 단계로 맞춘다 (역할은 p0=보안관) */
function setup(chars: CharId[]): GameState {
  const s = createGame(chars.map((_, i) => ({ id: `p${i}`, name: `P${i}` })), chars);
  const roles = s.players.map((p) => p.role);
  const sheriffIdx = roles.indexOf('sheriff');
  [roles[0], roles[sheriffIdx]] = [roles[sheriffIdx], roles[0]];
  s.players.forEach((p, i) => {
    p.role = roles[i];
    p.maxHp = 4 + (i === 0 ? 1 : 0);
    p.hp = p.maxHp;
    p.hand = [];
    p.inPlay = [];
  });
  s.turn = 0;
  s.phase = 'play';
  s.pending = null;
  s.drawCards = [];
  s.shotsPlayed = 0;
  return s;
}
const P = (s: GameState, i: number) => s.players[i];

{
  // 백정: 회피 2장 필요
  const s = setup(['butcher', 'gambler', 'clover']);
  P(s, 0).hand = [mk('shot')];
  P(s, 1).hand = [mk('dodge'), mk('dodge')];
  ok(applyAction(s, 'p0', { type: 'play', cardId: P(s, 0).hand[0].id, targetId: 'p1' }), '백정 사격');
  ok(applyAction(s, 'p1', { type: 'respond', cardId: P(s, 1).hand[0].id }), '회피 1');
  assert(s.pending?.kind === 'shot', '백정: 회피 1장으로는 부족해야 함');
  ok(applyAction(s, 'p1', { type: 'respond', cardId: P(s, 1).hand[0].id }), '회피 2');
  assert(!s.pending && P(s, 1).hp === 4, '백정: 회피 2장이면 막혀야 함');
}
{
  // 쌍권총: 회피를 사격으로, 사격을 회피로
  const s = setup(['twinguns', 'twinguns', 'clover']);
  P(s, 0).hand = [mk('dodge')];
  P(s, 1).hand = [mk('shot')];
  ok(applyAction(s, 'p0', { type: 'play', cardId: P(s, 0).hand[0].id, targetId: 'p1' }), '회피를 사격으로');
  ok(applyAction(s, 'p1', { type: 'respond', cardId: P(s, 1).hand[0].id }), '사격을 회피로');
  assert(!s.pending && P(s, 1).hp === 4, '쌍권총 응답');
}
{
  // 오뚝이: 피해 시 카드 뽑기 / 가시덤불: 공격자 카드 빼앗기
  const s = setup(['gambler', 'thickskin', 'thorns']);
  P(s, 0).hand = [mk('shot'), mk('beer')];
  ok(applyAction(s, 'p0', { type: 'play', cardId: P(s, 0).hand[0].id, targetId: 'p1' }), '사격');
  ok(applyAction(s, 'p1', { type: 'respond' }), '피해 받기');
  assert(P(s, 1).hand.length === 1, '오뚝이: 1장 뽑아야 함');
  s.shotsPlayed = 0;
  P(s, 0).hand.push(mk('shot'));
  const shot = P(s, 0).hand.find((c) => c.type === 'shot')!;
  ok(applyAction(s, 'p0', { type: 'play', cardId: shot.id, targetId: 'p2' }), '사격2');
  ok(applyAction(s, 'p2', { type: 'respond' }), '피해 받기2');
  assert(P(s, 2).hand.some((c) => c.type === 'beer') && P(s, 0).hand.length === 0, '가시덤불: 공격자 카드를 가져와야 함');
}
{
  // 장의사: 탈락자 카드 가져오기
  const s = setup(['gambler', 'clover', 'undertaker', 'scout']);
  P(s, 0).hand = [mk('shot')];
  P(s, 1).hp = 1;
  P(s, 1).hand = [mk('stagecoach'), mk('duel')];
  ok(applyAction(s, 'p0', { type: 'play', cardId: P(s, 0).hand[0].id, targetId: 'p1' }), '사격');
  ok(applyAction(s, 'p1', { type: 'respond' }), '피해');
  assert(!P(s, 1).alive && P(s, 2).hand.length === 2, '장의사: 2장을 가져와야 함');
}
{
  // 먼지바람 / 매의 눈 거리
  const s = setup(['gambler', 'dust', 'clover', 'hawkeye']);
  assert(distance(s.players, 'p0', 'p1') === 2, '먼지바람: 거리 +1');
  assert(distance(s.players, 'p0', 'p2') === 2, '기본 거리 2');
  // p3→p1: 자리 거리 2, 먼지바람 +1, 매의 눈 -1 = 2
  assert(distance(s.players, 'p3', 'p1') === 2, '매의 눈과 먼지바람 상쇄');
  s.players[3].character = 'hawkeye';
  s.players[1].character = 'gambler';
  assert(distance(s.players, 'p3', 'p1') === 1, '매의 눈: 거리 -1');
}
{
  // 정찰병: 3장 보고 2장
  const s = setup(['gambler', 'scout', 'clover']);
  ok(applyAction(s, 'p0', { type: 'endTurn' }), '턴 종료');
  assert(s.phase === 'draw' && s.drawCards.length === 3, '정찰병: 뽑기 선택 단계');
  const pick = s.drawCards.slice(0, 2).map((c) => c.id);
  ok(applyAction(s, 'p1', { type: 'drawChoice', cardIds: pick }), '정찰병 선택');
  assert(s.phase === 'play' && P(s, 1).hand.length === 2, '정찰병: 2장 획득');
}
{
  // 노상강도: 다른 사람 손패에서
  const s = setup(['gambler', 'bandit', 'clover']);
  P(s, 2).hand = [mk('beer')];
  ok(applyAction(s, 'p0', { type: 'endTurn' }), '턴 종료');
  ok(applyAction(s, 'p1', { type: 'drawChoice', source: 'p2' }), '노상강도 선택');
  assert(P(s, 1).hand.some((c) => c.type === 'beer') && P(s, 2).hand.length === 0, '노상강도: 빼앗기');
}
{
  // 약초꾼: 2장 버리고 회복 / 맨손: 0장이면 뽑기
  const s = setup(['herbalist', 'emptyhand', 'clover']);
  P(s, 0).hp = 2;
  P(s, 0).hand = [mk('duel'), mk('store')];
  ok(applyAction(s, 'p0', { type: 'ability', cardIds: P(s, 0).hand.map((c) => c.id) }), '약초꾼');
  assert(P(s, 0).hp === 3, '약초꾼: 회복');
  P(s, 0).hand = [mk('shot')];
  P(s, 1).hand = [mk('dodge')];
  ok(applyAction(s, 'p0', { type: 'play', cardId: P(s, 0).hand[0].id, targetId: 'p1' }), '사격');
  ok(applyAction(s, 'p1', { type: 'respond', cardId: P(s, 1).hand[0].id }), '회피');
  assert(P(s, 1).hand.length === 1, '맨손: 0장이 되면 1장 뽑기');
}
{
  // 그림자: 엄폐물 내장 (카드 엄폐물과 합쳐 2번)
  const s = setup(['gambler', 'shadow', 'clover']);
  P(s, 0).hand = [mk('shot')];
  P(s, 1).inPlay = [mk('barrel')];
  ok(applyAction(s, 'p0', { type: 'play', cardId: P(s, 0).hand[0].id, targetId: 'p1' }), '사격');
  s.deck.push(mk('beer', 'spades'), mk('beer', 'spades')); // 두 번 다 실패하도록
  ok(applyAction(s, 'p1', { type: 'useBarrel' }), '엄폐물 1');
  ok(applyAction(s, 'p1', { type: 'useBarrel' }), '엄폐물 2 (능력)');
  assert(applyAction(s, 'p1', { type: 'useBarrel' }) !== null, '그림자: 3번째는 불가');
}
console.log('✅ 캐릭터 능력 시나리오 테스트 통과');

{
  // 캐릭터 고르기: 제시된 2명 중에서만, 모두 고르면 시작
  const s = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }]);
  assert(s.phase === 'pickCharacter' && Object.keys(s.charOffers).length === 4, '고르기 단계로 시작');
  const all = Object.values(s.charOffers).flat();
  assert(new Set(all).size === 8, '제시된 캐릭터는 모두 달라야 함');
  assert(applyAction(s, 'a', { type: 'pickCharacter', characterId: s.charOffers.b[0] }) !== null, '남의 후보는 못 고름');
  assert(applyAction(s, 'a', { type: 'endTurn' }) !== null, '고르기 전엔 다른 행동 불가');
  const want: Record<string, CharId> = {};
  for (const id of ['a', 'b', 'c']) {
    want[id] = s.charOffers[id][1];
    ok(applyAction(s, id, { type: 'pickCharacter', characterId: want[id] }), `${id} 고르기`);
  }
  assert(s.phase === 'pickCharacter', '한 명 남으면 아직 시작 안 함');
  ok(applyAction(s, 'd', { type: 'pickCharacter', characterId: s.charOffers.d[0] }), 'd 고르기');
  assert(s.phase !== 'pickCharacter' && s.players.every((p) => p.hp > 0 && p.hand.length >= p.hp - 0), '모두 고르면 게임 시작');
  for (const id of ['a', 'b', 'c']) assert(s.players.find((p) => p.id === id)!.character === want[id], '고른 캐릭터 적용');
  console.log('✅ 캐릭터 고르기 테스트 통과');
}

// ---------- 무작위 시뮬레이션 ----------
function countCards(s: GameState): number {
  let n = s.deck.length + s.discard.length + s.drawCards.length;
  for (const p of s.players) n += p.hand.length + p.inPlay.length;
  if (s.pending?.kind === 'store') n += s.pending.cards.length;
  return n;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 현재 행동해야 하는 플레이어와 가능한 후보 행동 목록 (actions[0]은 항상 유효해야 함) */
function candidates(s: GameState): { pid: string; actions: Action[] } {
  if (s.phase === 'pickCharacter') {
    const pid = Object.keys(s.charOffers)[0];
    return { pid, actions: s.charOffers[pid].map((id) => ({ type: 'pickCharacter', characterId: id }) as Action) };
  }
  const p = s.pending;
  if (p) {
    if (p.kind === 'store') return { pid: p.order[0], actions: p.cards.map((c) => ({ type: 'pick', cardId: c.id })) };
    const pid = p.kind === 'duel' ? p.responderId : p.targetId;
    const me = s.players.find((x) => x.id === pid)!;
    const acts: Action[] = [{ type: 'respond' }];
    for (const c of me.hand) acts.push({ type: 'respond', cardId: c.id });
    if (p.kind === 'shot') acts.push({ type: 'useBarrel' });
    if (me.hand.length >= 2) acts.push({ type: 'ability', cardIds: [me.hand[0].id, me.hand[1].id] });
    return { pid, actions: acts };
  }
  const me = s.players[s.turn];
  if (s.phase === 'draw') {
    if (me.character === 'scout') return { pid: me.id, actions: [{ type: 'drawChoice', cardIds: s.drawCards.slice(0, 2).map((c) => c.id) }] };
    const acts: Action[] = [{ type: 'drawChoice', source: 'deck' }, { type: 'drawChoice', source: 'discard' }];
    for (const o of s.players) acts.push({ type: 'drawChoice', source: o.id });
    return { pid: me.id, actions: acts };
  }
  if (s.phase === 'discard') {
    const need = me.hand.length - me.hp;
    return { pid: me.id, actions: [{ type: 'discard', cardIds: me.hand.slice(0, need).map((c) => c.id) }] };
  }
  const acts: Action[] = [{ type: 'endTurn' }];
  if (me.hand.length >= 2) acts.push({ type: 'ability', cardIds: [me.hand[0].id, me.hand[1].id] });
  for (const c of me.hand) {
    for (const t of s.players) {
      if (!t.alive) continue;
      acts.push({ type: 'play', cardId: c.id, targetId: t.id, targetCardId: 'hand' });
      for (const ic of t.inPlay) acts.push({ type: 'play', cardId: c.id, targetId: t.id, targetCardId: ic.id });
    }
    acts.push({ type: 'play', cardId: c.id });
  }
  return { pid: me.id, actions: acts };
}

let finished = 0;
const winners: Record<string, number> = {};
for (let g = 0; g < 3000; g++) {
  const n = 2 + (g % 6);
  const s = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })));
  for (let step = 0; step < 5000 && !isOver(s); step++) {
    const { pid, actions } = candidates(s);
    let done = false;
    for (let tries = 0; tries < 30 && !done; tries++) {
      const a = Math.random() < 0.15 ? actions[0] : pick(actions);
      done = applyAction(s, pid, a) === null;
    }
    if (!done) {
      const err = applyAction(s, pid, actions[0]);
      if (err) throw new Error(`막힘: ${err} ${JSON.stringify(s.pending)} ${s.phase} ${s.players[s.turn].character}`);
    }
    if (countCards(s) !== TOTAL) throw new Error(`카드 수 불일치: ${countCards(s)}`);
    if (!isOver(s) && !s.players[s.turn].alive) throw new Error('죽은 플레이어의 차례');
    for (const p of s.players) if (p.alive && p.character === 'emptyhand' && !isOver(s)) assert(p.hand.length > 0, '맨손: 손패 0장 유지됨');
  }
  if (isOver(s)) {
    finished++;
    winners[s.winner!] = (winners[s.winner!] ?? 0) + 1;
  }
}

console.log(`✅ 3000판 시뮬레이션 통과 — 종료된 판 ${finished}, 승리 분포`, winners);
