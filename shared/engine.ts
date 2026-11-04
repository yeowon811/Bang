// 규칙 엔진 — 서버가 상태를 보유하고, 모든 행동은 applyAction으로만 바뀐다.
// 로그의 [[카드타입]] / [[char-캐릭터]] 토큰은 클라이언트에서 관리자가 설정한 이름으로 바뀐다.

import { Card, CardType, CARD_DEF_MAP, Role, buildDeck, isWeapon } from './cards';
import { CHARACTERS, CHAR_MAP, CharId } from './characters';

export interface Player {
  id: string;
  name: string;
  role: Role;
  character: CharId;
  hp: number;
  maxHp: number;
  hand: Card[];
  inPlay: Card[]; // 장착한 파란 카드 (무기 포함, 감옥/다이너마이트 포함)
  alive: boolean;
}

export type Pending =
  | { kind: 'shot'; attackerId: string; targetId: string; queue: string[]; needed: number; barrelUsed: number }
  | { kind: 'raid'; attackerId: string; targetId: string; queue: string[] }
  | { kind: 'duel'; attackerId: string; targetId: string; responderId: string }
  | { kind: 'store'; cards: Card[]; order: string[] };

export type Winner = 'law' | 'outlaws' | 'renegade';

export interface GameState {
  players: Player[]; // 좌석 순서
  deck: Card[];
  discard: Card[];
  turn: number; // 현재 차례 플레이어 index
  turnNo: number; // 지금까지 시작된 턴 수 (타이머 구분용)
  /** pickCharacter: 게임 시작 전 캐릭터 고르기 / draw: 뽑기 방법을 골라야 하는 캐릭터의 뽑기 단계 */
  phase: 'pickCharacter' | 'draw' | 'play' | 'discard' | 'over';
  /** 캐릭터 고르기 단계에서 아직 안 고른 플레이어에게 제시된 2명 */
  charOffers: Record<string, CharId[]>;
  /** 정찰병: 뽑기 단계에서 본 3장 (본인에게만 공개) */
  drawCards: Card[];
  shotsPlayed: number;
  pending: Pending | null;
  winner: Winner | null;
  log: string[];
}

export type Action =
  | { type: 'play'; cardId: string; targetId?: string; targetCardId?: string } // targetCardId: 카드 id 또는 'hand'
  | { type: 'respond'; cardId?: string } // cardId 없으면 피해를 받는다
  | { type: 'useBarrel' }
  | { type: 'pick'; cardId: string }
  | { type: 'endTurn' }
  | { type: 'discard'; cardIds: string[] }
  /** 뽑기 단계 선택. source: 'deck' | 'discard' | 플레이어 id, cardIds: 정찰병이 고른 2장 */
  | { type: 'drawChoice'; source?: string; cardIds?: string[] }
  /** 약초꾼: 카드 2장 버리고 회복 */
  | { type: 'ability'; cardIds: string[] }
  /** 게임 시작 전 캐릭터 고르기 */
  | { type: 'pickCharacter'; characterId: CharId };

// ---------- 랜덤 (테스트에서 교체 가능) ----------
let rng: () => number = Math.random;
export const setRng = (fn: () => number) => (rng = fn);

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 거리 (클라이언트에서도 사용) ----------
export interface SeatLike {
  id: string;
  alive: boolean;
  character?: string | null;
  inPlay: { type: CardType }[];
}

const has = (p: SeatLike, t: CardType) => p.inPlay.some((c) => c.type === t);

export function distance(players: SeatLike[], fromId: string, toId: string): number {
  const alive = players.filter((p) => p.alive);
  const a = alive.findIndex((p) => p.id === fromId);
  const b = alive.findIndex((p) => p.id === toId);
  if (a < 0 || b < 0 || a === b) return 0;
  const cw = (b - a + alive.length) % alive.length;
  let d = Math.min(cw, alive.length - cw);
  if (has(alive[b], 'mustang')) d += 1;
  if (alive[b].character === 'dust') d += 1;
  if (has(alive[a], 'scope')) d -= 1;
  if (alive[a].character === 'hawkeye') d -= 1;
  return Math.max(1, d);
}

export function weaponRange(p: SeatLike): number {
  const w = p.inPlay.find((c) => isWeapon(c.type));
  return w ? CARD_DEF_MAP[w.type].range! : 1;
}

/** 엄폐물 판정 가능 횟수 (엄폐물 카드 + 그림자 피에르 능력) */
export const barrelCount = (p: SeatLike) => (has(p, 'barrel') ? 1 : 0) + (p.character === 'shadow' ? 1 : 0);

/** 쌍권총 메이는 사격/회피를 바꿔 쓸 수 있다 */
export function canAnswerAs(p: { character?: string | null }, cardType: CardType, need: CardType): boolean {
  if (cardType === need) return true;
  const pair: CardType[] = ['shot', 'dodge'];
  return p.character === 'twinguns' && pair.includes(cardType) && pair.includes(need);
}

// ---------- 역할 배분 ----------
export function rolesFor(count: number): Role[] {
  const table: Record<number, Role[]> = {
    2: ['sheriff', 'outlaw'], // 테스트용
    3: ['sheriff', 'outlaw', 'renegade'], // 테스트용
    4: ['sheriff', 'renegade', 'outlaw', 'outlaw'],
    5: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy'],
    6: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy'],
    7: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy', 'deputy'],
  };
  const roles = table[count];
  if (!roles) throw new Error('인원은 2~7명이어야 합니다.');
  return [...roles];
}

/** fixedCharacters를 주면 고르기 없이 바로 시작 (테스트용) */
export function createGame(seats: { id: string; name: string }[], fixedCharacters?: CharId[]): GameState {
  const roles = shuffle(rolesFor(seats.length));
  const pool = shuffle(CHARACTERS.map((c) => c.id));
  const state: GameState = {
    players: seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      role: roles[i],
      character: fixedCharacters?.[i] ?? pool[i * 2],
      hp: 0,
      maxHp: 0,
      hand: [],
      inPlay: [],
      alive: true,
    })),
    deck: shuffle(buildDeck()),
    discard: [],
    turn: 0,
    turnNo: 0,
    phase: 'pickCharacter',
    charOffers: {},
    drawCards: [],
    shotsPlayed: 0,
    pending: null,
    winner: null,
    log: [],
  };
  if (fixedCharacters) {
    beginGame(state);
  } else {
    // 1인당 2명씩 제시 (최대 7명 × 2 = 14명 ≤ 16명)
    state.players.forEach((p, i) => (state.charOffers[p.id] = [pool[i * 2], pool[i * 2 + 1]]));
    log(state, '각자 캐릭터 2명 중 1명을 고르세요.');
  }
  return state;
}

/** 캐릭터가 모두 정해진 뒤: 체력·손패를 정하고 보안관부터 시작 */
function beginGame(state: GameState) {
  for (const p of state.players) {
    p.maxHp = CHAR_MAP[p.character].hp + (p.role === 'sheriff' ? 1 : 0);
    p.hp = p.maxHp;
    for (let i = 0; i < p.hp; i++) p.hand.push(draw(state));
  }
  state.turn = state.players.findIndex((p) => p.role === 'sheriff');
  log(state, `게임 시작! 보안관은 ${state.players[state.turn].name}입니다.`);
  startTurn(state);
  emptyHandCheck(state);
}

// ---------- 내부 도우미 ----------
function log(s: GameState, msg: string) {
  s.log.push(msg);
  if (s.log.length > 200) s.log.shift();
}

const cardName = (t: CardType) => `[[${t}]]`;
const charName = (p: Player) => `[[char-${p.character}]]`;
const getP = (s: GameState, id?: string) => s.players.find((p) => p.id === id);
const aliveCount = (s: GameState) => s.players.filter((p) => p.alive).length;
const current = (s: GameState) => s.players[s.turn];
/** 함수 호출로 phase가 바뀐 뒤 확인용 (TS 타입 좁히기 회피) */
export const isOver = (s: GameState) => s.phase === 'over';

function draw(s: GameState): Card {
  if (s.deck.length === 0) {
    s.deck = shuffle(s.discard);
    s.discard = [];
    log(s, '버린 카드 더미를 섞어 덱을 다시 만들었습니다.');
  }
  const c = s.deck.pop();
  if (!c) throw new Error('덱에 카드가 없습니다.');
  return c;
}

const SUIT_KO = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' } as const;
const rankLabel = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);
const cardLabel = (c: Card) => `${SUIT_KO[c.suit]}${rankLabel(c.rank)}`;

/** 판정: 덱 맨 위 카드를 공개 후 버림. 네잎 클로버는 2장 중 유리한 쪽(good)을 쓴다 */
function drawCheck(s: GameState, p: Player, reason: string, good: (c: Card) => boolean): Card {
  const c1 = draw(s);
  s.discard.push(c1);
  if (p.character !== 'clover') {
    log(s, `판정(${reason}): ${cardLabel(c1)}`);
    return c1;
  }
  const c2 = draw(s);
  s.discard.push(c2);
  const chosen = good(c1) ? c1 : good(c2) ? c2 : c1;
  log(s, `판정(${reason}): ${cardLabel(c1)}, ${cardLabel(c2)} → ${charName(p)} 능력으로 ${cardLabel(chosen)} 사용`);
  return chosen;
}

const isHeart = (c: Card) => c.suit === 'hearts';
const explodes = (c: Card) => c.suit === 'spades' && c.rank >= 2 && c.rank <= 9;

function takeFromHand(p: Player, cardId: string): Card | undefined {
  const i = p.hand.findIndex((c) => c.id === cardId);
  return i >= 0 ? p.hand.splice(i, 1)[0] : undefined;
}

function takeRandomFromHand(p: Player): Card {
  return p.hand.splice(Math.floor(rng() * p.hand.length), 1)[0];
}

function takeFromPlay(p: Player, type: CardType): Card | undefined {
  const i = p.inPlay.findIndex((c) => c.type === type);
  return i >= 0 ? p.inPlay.splice(i, 1)[0] : undefined;
}

function nextAliveIndex(s: GameState, from: number): number {
  for (let k = 1; k <= s.players.length; k++) {
    const i = (from + k) % s.players.length;
    if (s.players[i].alive) return i;
  }
  return from;
}

/** from 다음 사람부터 시계 방향으로 살아있는 다른 플레이어 id */
function othersInOrder(s: GameState, fromId: string): string[] {
  const start = s.players.findIndex((p) => p.id === fromId);
  const ids: string[] = [];
  for (let k = 1; k < s.players.length; k++) {
    const p = s.players[(start + k) % s.players.length];
    if (p.alive) ids.push(p.id);
  }
  return ids;
}

/** 맨손의 제니: 손패가 0장이면 1장 뽑기 */
function emptyHandCheck(s: GameState) {
  if (isOver(s)) return;
  for (const p of s.players) {
    if (p.alive && p.character === 'emptyhand' && p.hand.length === 0) {
      p.hand.push(draw(s));
      log(s, `${p.name}: ${charName(p)} 능력으로 카드 1장을 뽑았습니다.`);
    }
  }
}

function damage(s: GameState, target: Player, amount: number, attackerId: string | null) {
  target.hp -= amount;
  log(s, `${target.name}이(가) 피해 ${amount}를 받았습니다. (체력 ${Math.max(0, target.hp)})`);
  // 쓰러지기 직전: 위스키 → 약초꾼 능력 순으로 자동 사용
  while (target.hp <= 0) {
    const beer = aliveCount(s) > 2 ? target.hand.find((c) => c.type === 'beer') : undefined;
    if (beer) {
      takeFromHand(target, beer.id);
      s.discard.push(beer);
      target.hp += 1;
      log(s, `${target.name}이(가) ${cardName('beer')}로 버텼습니다! (체력 ${target.hp})`);
    } else if (target.character === 'herbalist' && target.hand.length >= 2) {
      s.discard.push(...target.hand.splice(0, 2));
      target.hp += 1;
      log(s, `${target.name}이(가) ${charName(target)} 능력으로 카드 2장을 버리고 버텼습니다! (체력 ${target.hp})`);
    } else break;
  }
  if (target.hp <= 0) return kill(s, target, attackerId);

  if (target.character === 'thickskin') {
    for (let i = 0; i < amount; i++) target.hand.push(draw(s));
    log(s, `${target.name}: ${charName(target)} 능력으로 카드 ${amount}장을 뽑았습니다.`);
  }
  const attacker = getP(s, attackerId ?? undefined);
  if (target.character === 'thorns' && attacker && attacker !== target && attacker.alive) {
    let n = 0;
    for (let i = 0; i < amount && attacker.hand.length; i++, n++) target.hand.push(takeRandomFromHand(attacker));
    if (n) log(s, `${target.name}: ${charName(target)} 능력으로 ${attacker.name}의 카드 ${n}장을 가져왔습니다.`);
  }
}

const ROLE_KO: Record<Role, string> = { sheriff: '보안관', deputy: '부관', outlaw: '무법자', renegade: '배신자' };

function kill(s: GameState, victim: Player, attackerId: string | null) {
  victim.alive = false;
  victim.hp = 0;
  const left = [...victim.hand, ...victim.inPlay];
  victim.hand = [];
  victim.inPlay = [];
  log(s, `💀 ${victim.name} 탈락! 정체는 ${ROLE_KO[victim.role]}였습니다.`);

  const undertaker = s.players.find((p) => p.alive && p.character === 'undertaker');
  if (undertaker && left.length) {
    undertaker.hand.push(...left);
    log(s, `${undertaker.name}: ${charName(undertaker)} 능력으로 ${victim.name}의 카드 ${left.length}장을 가져왔습니다.`);
  } else s.discard.push(...left);

  const attacker = getP(s, attackerId ?? undefined);
  if (attacker && attacker.alive && attacker !== victim) {
    if (victim.role === 'outlaw') {
      for (let i = 0; i < 3; i++) attacker.hand.push(draw(s));
      log(s, `${attacker.name}이(가) 무법자 처치 보상으로 카드 3장을 받았습니다.`);
    } else if (victim.role === 'deputy' && attacker.role === 'sheriff') {
      s.discard.push(...attacker.hand, ...attacker.inPlay);
      attacker.hand = [];
      attacker.inPlay = [];
      log(s, `보안관이 부관을 쏴서 모든 카드를 잃었습니다.`);
    }
  }
  checkWin(s);
}

function checkWin(s: GameState) {
  const sheriff = s.players.find((p) => p.role === 'sheriff')!;
  const alive = s.players.filter((p) => p.alive);
  let winner: Winner | null = null;
  if (!sheriff.alive) {
    winner = alive.length === 1 && alive[0].role === 'renegade' ? 'renegade' : 'outlaws';
  } else if (!alive.some((p) => p.role === 'outlaw' || p.role === 'renegade')) {
    winner = 'law';
  }
  if (winner) {
    s.winner = winner;
    s.phase = 'over';
    s.pending = null;
    s.drawCards = [];
    const text = { law: '보안관 팀', outlaws: '무법자 팀', renegade: '배신자' }[winner];
    log(s, `🏆 게임 종료 — ${text} 승리!`);
  }
}

function startTurn(s: GameState) {
  for (let guard = 0; guard < 50 && !isOver(s); guard++) {
    const p = current(s);
    s.turnNo++;
    s.shotsPlayed = 0;
    s.pending = null;
    log(s, `── ${p.name}의 차례 ──`);

    const dyn = takeFromPlay(p, 'dynamite');
    if (dyn) {
      const c = drawCheck(s, p, cardName('dynamite'), (x) => !explodes(x));
      if (explodes(c)) {
        s.discard.push(dyn);
        log(s, `💥 ${cardName('dynamite')}이(가) 폭발했습니다!`);
        damage(s, p, 3, null);
        if (isOver(s)) return;
        if (!p.alive) {
          s.turn = nextAliveIndex(s, s.turn);
          continue;
        }
      } else {
        const next = s.players[nextAliveIndex(s, s.turn)];
        next.inPlay.push(dyn);
        log(s, `${cardName('dynamite')}이(가) ${next.name}에게 넘어갔습니다.`);
      }
    }

    const jail = takeFromPlay(p, 'jail');
    if (jail) {
      s.discard.push(jail);
      const c = drawCheck(s, p, cardName('jail'), isHeart);
      if (!isHeart(c)) {
        log(s, `${p.name}은(는) ${cardName('jail')}에 갇혀 턴을 건너뜁니다.`);
        s.turn = nextAliveIndex(s, s.turn);
        continue;
      }
      log(s, `${p.name}이(가) ${cardName('jail')}에서 탈출했습니다!`);
    }

    beginDraw(s, p);
    return;
  }
}

/** 뽑기 단계. 선택이 필요한 캐릭터는 phase='draw'로 멈춘다 */
function beginDraw(s: GameState, p: Player) {
  switch (p.character) {
    case 'gambler': {
      const c1 = draw(s);
      const c2 = draw(s);
      p.hand.push(c1, c2);
      const red = c2.suit === 'hearts' || c2.suit === 'diamonds';
      log(s, `${p.name}: ${charName(p)} 능력 — 두 번째 카드 ${cardLabel(c2)} 공개${red ? ', 1장 더 뽑습니다!' : ''}`);
      if (red) p.hand.push(draw(s));
      s.phase = 'play';
      return;
    }
    case 'scout':
      s.drawCards = [draw(s), draw(s), draw(s)];
      s.phase = 'draw';
      return;
    case 'bandit':
      if (s.players.some((o) => o !== p && o.alive && o.hand.length > 0)) {
        s.phase = 'draw';
        return;
      }
      break;
    case 'junker':
      if (s.discard.length > 0) {
        s.phase = 'draw';
        return;
      }
      break;
  }
  p.hand.push(draw(s), draw(s));
  s.phase = 'play';
}

function handleDrawChoice(s: GameState, me: Player, a: Extract<Action, { type: 'drawChoice' }>): string | null {
  switch (me.character) {
    case 'scout': {
      const ids = a.cardIds ?? [];
      if (ids.length !== 2 || new Set(ids).size !== 2 || !ids.every((id) => s.drawCards.some((c) => c.id === id))) return '2장을 골라야 합니다.';
      for (const c of s.drawCards) (ids.includes(c.id) ? me.hand : s.deck).push(c);
      s.drawCards = [];
      log(s, `${me.name}: ${charName(me)} 능력으로 3장 중 2장을 골랐습니다.`);
      break;
    }
    case 'junker':
      if (a.source === 'discard') {
        if (!s.discard.length) return '버린 카드가 없습니다.';
        const top = s.discard.pop()!;
        me.hand.push(top, draw(s));
        log(s, `${me.name}: ${charName(me)} 능력으로 버린 카드에서 ${cardName(top.type)}을(를) 가져왔습니다.`);
      } else if (a.source === 'deck') me.hand.push(draw(s), draw(s));
      else return '뽑을 곳을 골라야 합니다.';
      break;
    case 'bandit': {
      if (a.source === 'deck') {
        me.hand.push(draw(s), draw(s));
        break;
      }
      const t = getP(s, a.source);
      if (!t || t === me || !t.alive || !t.hand.length) return '손패가 있는 다른 플레이어를 골라야 합니다.';
      me.hand.push(takeRandomFromHand(t), draw(s));
      log(s, `${me.name}: ${charName(me)} 능력으로 ${t.name}의 손패에서 1장을 빼앗았습니다.`);
      break;
    }
    default:
      return '선택할 수 없습니다.';
  }
  s.phase = 'play';
  return null;
}

function nextTurn(s: GameState) {
  s.turn = nextAliveIndex(s, s.turn);
  startTurn(s);
}

/** 대기열의 다음 대상으로 넘어가거나 대기 상태를 끝낸다 */
function advanceQueue(s: GameState, pend: Extract<Pending, { queue: string[] }>) {
  while (pend.queue.length) {
    const next = pend.queue.shift()!;
    if (getP(s, next)?.alive) {
      pend.targetId = next;
      if (pend.kind === 'shot') {
        pend.barrelUsed = 0;
        pend.needed = 1;
      }
      return;
    }
  }
  s.pending = null;
}

/** 대기 상태 해제 후, 차례인 플레이어가 죽었다면 턴을 넘긴다 */
function afterResolve(s: GameState) {
  if (!isOver(s) && !s.pending && !current(s).alive) nextTurn(s);
}

// ---------- 행동 처리 ----------
/** 성공 시 null, 실패 시 오류 메시지 */
export function applyAction(s: GameState, playerId: string, a: Action): string | null {
  const err = dispatch(s, playerId, a);
  if (!err) emptyHandCheck(s);
  return err;
}

function dispatch(s: GameState, playerId: string, a: Action): string | null {
  if (isOver(s)) return '게임이 끝났습니다.';
  const me = getP(s, playerId);
  if (!me || !me.alive) return '행동할 수 없습니다.';

  if (s.phase === 'pickCharacter') {
    if (a.type !== 'pickCharacter') return '먼저 캐릭터를 골라야 합니다.';
    const offers = s.charOffers[me.id];
    if (!offers) return '이미 골랐습니다.';
    if (!offers.includes(a.characterId)) return '제시된 캐릭터가 아닙니다.';
    me.character = a.characterId;
    delete s.charOffers[me.id];
    log(s, `${me.name}이(가) 캐릭터를 골랐습니다.`);
    if (Object.keys(s.charOffers).length === 0) {
      log(s, '모두 골랐습니다! ' + s.players.map((p) => `${p.name}: ${charName(p)}`).join(', '));
      beginGame(s);
    }
    return null;
  }

  // 약초꾼 능력은 언제든 사용 가능
  if (a.type === 'ability') {
    if (me.character !== 'herbalist') return '사용할 수 있는 능력이 없습니다.';
    if (me.hp >= me.maxHp) return '체력이 이미 가득 찼습니다.';
    if (a.cardIds.length !== 2 || new Set(a.cardIds).size !== 2 || !a.cardIds.every((id) => me.hand.some((c) => c.id === id))) return '버릴 카드 2장을 골라야 합니다.';
    for (const id of a.cardIds) s.discard.push(takeFromHand(me, id)!);
    me.hp += 1;
    log(s, `${me.name}: ${charName(me)} 능력으로 카드 2장을 버리고 체력 1을 회복했습니다.`);
    return null;
  }

  if (s.pending) return handlePending(s, me, a);

  if (current(s) !== me) return '내 차례가 아닙니다.';

  if (s.phase === 'draw') {
    if (a.type !== 'drawChoice') return '먼저 카드를 뽑아야 합니다.';
    return handleDrawChoice(s, me, a);
  }

  if (s.phase === 'discard') {
    if (a.type !== 'discard') return '버릴 카드를 골라야 합니다.';
    const need = me.hand.length - me.hp;
    if (a.cardIds.length !== need || new Set(a.cardIds).size !== need) return `${need}장을 버려야 합니다.`;
    if (!a.cardIds.every((id) => me.hand.some((c) => c.id === id))) return '손에 없는 카드입니다.';
    for (const id of a.cardIds) s.discard.push(takeFromHand(me, id)!);
    log(s, `${me.name}이(가) 카드 ${need}장을 버렸습니다.`);
    nextTurn(s);
    return null;
  }

  if (a.type === 'endTurn') {
    if (me.hand.length > me.hp) {
      s.phase = 'discard';
      return null;
    }
    nextTurn(s);
    return null;
  }
  if (a.type !== 'play') return '지금은 할 수 없는 행동입니다.';
  return playCard(s, me, a);
}

function playCard(s: GameState, me: Player, a: Extract<Action, { type: 'play' }>): string | null {
  const card = me.hand.find((c) => c.id === a.cardId);
  if (!card) return '손에 없는 카드입니다.';
  // 쌍권총 메이는 회피를 사격으로 쓸 수 있다
  const type: CardType = card.type === 'dodge' && me.character === 'twinguns' ? 'shot' : card.type;
  const def = CARD_DEF_MAP[type];
  const target = getP(s, a.targetId);

  // --- 검증 ---
  if (def.target !== 'none') {
    if (!target || !target.alive || target === me) return '대상을 골라야 합니다.';
  }
  switch (type) {
    case 'dodge':
      return `${cardName('dodge')}은(는) 공격받았을 때만 쓸 수 있습니다.`;
    case 'shot':
      if (s.shotsPlayed >= 1 && !has(me, 'volcanic') && me.character !== 'quickdraw') return '사격은 턴당 1번만 할 수 있습니다.';
      if (distance(s.players, me.id, target!.id) > weaponRange(me)) return '사거리 밖입니다.';
      break;
    case 'beer':
      if (me.hp >= me.maxHp) return '체력이 이미 가득 찼습니다.';
      if (aliveCount(s) <= 2) return '2명만 남으면 효과가 없습니다.';
      break;
    case 'steal':
    case 'sabotage': {
      if (type === 'steal' && distance(s.players, me.id, target!.id) > 1) return '거리 1 이내만 가능합니다.';
      const ok = a.targetCardId === 'hand' ? target!.hand.length > 0 : target!.inPlay.some((c) => c.id === a.targetCardId);
      if (!ok) return '가져갈/버릴 카드를 골라야 합니다.';
      break;
    }
    case 'jail':
      if (target!.role === 'sheriff') return '보안관에게는 걸 수 없습니다.';
      if (has(target!, 'jail')) return '이미 갇혀 있습니다.';
      break;
    case 'barrel':
    case 'scope':
    case 'mustang':
    case 'dynamite':
      if (has(me, type)) return '같은 카드는 하나만 장착할 수 있습니다.';
      break;
  }

  // --- 실행 ---
  takeFromHand(me, card.id);
  const tName = target ? ` → ${target.name}` : '';
  const asText = type !== card.type ? ` (${cardName(type)}(으)로 사용)` : '';
  log(s, `${me.name}: ${cardName(card.type)}${asText}${tName}`);

  if (def.color === 'blue') {
    if (type === 'jail') {
      target!.inPlay.push(card);
    } else {
      if (isWeapon(type)) {
        const old = me.inPlay.find((c) => isWeapon(c.type));
        if (old) {
          me.inPlay.splice(me.inPlay.indexOf(old), 1);
          s.discard.push(old);
        }
      }
      me.inPlay.push(card);
    }
    return null;
  }

  s.discard.push(card);
  switch (type) {
    case 'shot':
      s.shotsPlayed++;
      s.pending = {
        kind: 'shot',
        attackerId: me.id,
        targetId: target!.id,
        queue: [],
        needed: me.character === 'butcher' ? 2 : 1,
        barrelUsed: 0,
      };
      break;
    case 'beer':
      me.hp += 1;
      break;
    case 'saloon':
      for (const p of s.players) if (p.alive) p.hp = Math.min(p.maxHp, p.hp + 1);
      break;
    case 'stagecoach':
      me.hand.push(draw(s), draw(s));
      break;
    case 'wellsfargo':
      me.hand.push(draw(s), draw(s), draw(s));
      break;
    case 'steal':
    case 'sabotage': {
      let taken: Card;
      if (a.targetCardId === 'hand') {
        taken = takeRandomFromHand(target!);
      } else {
        const i = target!.inPlay.findIndex((c) => c.id === a.targetCardId);
        taken = target!.inPlay.splice(i, 1)[0];
      }
      if (type === 'steal') me.hand.push(taken);
      else {
        s.discard.push(taken);
        log(s, `${target!.name}의 ${cardName(taken.type)}이(가) 버려졌습니다.`);
      }
      break;
    }
    case 'store': {
      const n = aliveCount(s);
      const cards = Array.from({ length: n }, () => draw(s));
      s.pending = { kind: 'store', cards, order: [me.id, ...othersInOrder(s, me.id)] };
      break;
    }
    case 'raid':
    case 'gatling': {
      const queue = othersInOrder(s, me.id);
      const first = queue.shift()!;
      s.pending =
        type === 'raid'
          ? { kind: 'raid', attackerId: me.id, targetId: first, queue }
          : { kind: 'shot', attackerId: me.id, targetId: first, queue, needed: 1, barrelUsed: 0 };
      break;
    }
    case 'duel':
      s.pending = { kind: 'duel', attackerId: me.id, targetId: target!.id, responderId: target!.id };
      break;
  }
  return null;
}

function handlePending(s: GameState, me: Player, a: Action): string | null {
  const pend = s.pending!;

  if (pend.kind === 'store') {
    if (pend.order[0] !== me.id) return '내가 고를 차례가 아닙니다.';
    if (a.type !== 'pick') return '카드를 하나 골라야 합니다.';
    const i = pend.cards.findIndex((c) => c.id === a.cardId);
    if (i < 0) return '없는 카드입니다.';
    const [c] = pend.cards.splice(i, 1);
    me.hand.push(c);
    log(s, `${me.name}이(가) ${cardName('store')}에서 ${cardName(c.type)}을(를) 가져갔습니다.`);
    pend.order.shift();
    while (pend.order.length && !getP(s, pend.order[0])?.alive) pend.order.shift();
    if (!pend.cards.length || !pend.order.length) {
      s.discard.push(...pend.cards);
      s.pending = null;
    }
    return null;
  }

  if (pend.kind === 'duel') {
    if (pend.responderId !== me.id) return '상대의 응답을 기다리는 중입니다.';
    if (a.type !== 'respond') return '사격을 내거나 피해를 받아야 합니다.';
    const other = pend.responderId === pend.targetId ? pend.attackerId : pend.targetId;
    if (a.cardId) {
      const c = me.hand.find((x) => x.id === a.cardId);
      if (!c || !canAnswerAs(me, c.type, 'shot')) return '결투에는 사격만 낼 수 있습니다.';
      takeFromHand(me, c.id);
      s.discard.push(c);
      log(s, `${me.name}이(가) 결투에서 ${cardName(c.type)}을(를) 냈습니다.`);
      pend.responderId = other;
      return null;
    }
    s.pending = null;
    damage(s, me, 1, other);
    afterResolve(s);
    return null;
  }

  // shot / raid
  if (pend.targetId !== me.id) return '다른 플레이어의 응답을 기다리는 중입니다.';

  if (a.type === 'useBarrel') {
    if (pend.kind !== 'shot') return '지금은 엄폐물을 쓸 수 없습니다.';
    if (pend.barrelUsed >= barrelCount(me)) return '더 이상 판정할 수 없습니다.';
    pend.barrelUsed++;
    const c = drawCheck(s, me, cardName('barrel'), isHeart);
    if (isHeart(c)) {
      pend.needed--;
      log(s, `${me.name}이(가) ${cardName('barrel')} 덕분에 피했습니다!${pend.needed > 0 ? ` (회피 ${pend.needed}장 더 필요)` : ''}`);
      if (pend.needed <= 0) {
        advanceQueue(s, pend);
        afterResolve(s);
      }
    }
    return null;
  }

  if (a.type !== 'respond') return '응답해야 합니다.';
  const need: CardType = pend.kind === 'shot' ? 'dodge' : 'shot';
  if (a.cardId) {
    const c = me.hand.find((x) => x.id === a.cardId);
    if (!c || !canAnswerAs(me, c.type, need)) return `${cardName(need)}만 낼 수 있습니다.`;
    takeFromHand(me, c.id);
    s.discard.push(c);
    if (pend.kind === 'shot' && --pend.needed > 0) {
      log(s, `${me.name}이(가) ${cardName(c.type)}을(를) 냈습니다. (${pend.needed}장 더 필요)`);
      return null;
    }
    log(s, `${me.name}이(가) ${cardName(c.type)}(으)로 막았습니다.`);
  } else {
    damage(s, me, 1, pend.attackerId);
    if (isOver(s)) return null;
  }
  advanceQueue(s, pend);
  afterResolve(s);
  return null;
}

// ---------- 플레이어별 시점 (숨은 정보 제거) ----------
export interface PublicPlayer {
  id: string;
  name: string;
  role: Role | null;
  /** 캐릭터 고르기 중인 다른 플레이어는 null */
  character: CharId | null;
  /** 아직 캐릭터를 고르는 중 */
  picking: boolean;
  hp: number;
  maxHp: number;
  alive: boolean;
  handCount: number;
  inPlay: Card[];
}

export interface PlayerView {
  me: string;
  myHand: Card[];
  players: PublicPlayer[];
  turnPlayerId: string;
  phase: GameState['phase'];
  /** 정찰병 본인에게만 보이는 3장 */
  drawCards: Card[];
  /** 캐릭터 고르기 단계에서 나에게 제시된 2명 (골랐으면 빈 배열) */
  myOffers: CharId[];
  shotsPlayed: number;
  pending: Pending | null;
  deckCount: number;
  discardTop: Card | null;
  winner: Winner | null;
  log: string[];
}

export function viewFor(s: GameState, playerId: string): PlayerView {
  const over = s.phase === 'over';
  return {
    me: playerId,
    myHand: getP(s, playerId)?.hand ?? [],
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      role: over || !p.alive || p.id === playerId || p.role === 'sheriff' ? p.role : null,
      character: s.phase === 'pickCharacter' && (p.id !== playerId || s.charOffers[p.id]) ? null : p.character,
      picking: !!s.charOffers[p.id],
      hp: p.hp,
      maxHp: p.maxHp,
      alive: p.alive,
      handCount: p.hand.length,
      inPlay: p.inPlay,
    })),
    turnPlayerId: current(s).id,
    phase: s.phase,
    drawCards: current(s).id === playerId ? s.drawCards : [],
    myOffers: s.charOffers[playerId] ?? [],
    shotsPlayed: s.shotsPlayed,
    pending: s.pending,
    deckCount: s.deck.length,
    discardTop: s.discard[s.discard.length - 1] ?? null,
    winner: s.winner,
    log: s.log.slice(-60),
  };
}
