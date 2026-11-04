// 방장 브라우저에서 도는 "게임 서버".
// 다른 플레이어는 rooms/{code}/actions 에 행동을 올리고, 방장이 규칙대로 처리해
// 각자 볼 수 있는 화면(views/{uid})만 써 준다. 봇·제한 시간·연결 끊김 대행도 여기서 처리.
import { get, onChildAdded, onValue, ref, remove, update } from 'firebase/database';
import { db, serverNow } from './firebase';
import { Action, applyAction, createGame, GameState, viewFor } from '../shared/engine';
import { applyWithMemory, BotMemory, runBotStep, whoActs } from '../shared/bot';

const BOT_DELAY = 900; // 봇 행동 간격
const OFFLINE_GRACE = 20000; // 연결이 끊긴 사람을 봇이 대신하기까지
const TURN_TIMEOUT = 60000; // 내 턴 제한 시간
const RESPONSE_TIMEOUT = 20000; // 응답·선택 제한 시간
const MIN_TURN_LEFT = 10000; // 응답 대기 후 내 턴으로 돌아왔을 때 최소 남은 시간

export interface RoomPlayerData {
  name: string;
  isBot: boolean;
  online?: boolean;
  joinedAt?: number;
}

type Deadline = { key: string; playerId: string; kind: 'turn' | 'response'; at: number; timer: ReturnType<typeof setTimeout> };

export class Host {
  game: GameState | null = null;
  memory: BotMemory = {};
  players: Record<string, RoomPlayerData> = {};
  private offlineSince: Record<string, number> = {};
  private proxied = new Set<string>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private deadline: Deadline | null = null;
  private turnDeadline: { turnNo: number; at: number } | null = null;
  private unsubs: (() => void)[] = [];
  private stopped = false;
  private base: string;

  constructor(
    public code: string,
    public uid: string,
  ) {
    this.base = `rooms/${code}`;
  }

  async start() {
    // 방장이 새로고침해도 이어서 진행
    const saved = await get(ref(db, `${this.base}/state`));
    if (saved.exists()) {
      try {
        const s = JSON.parse(saved.val());
        this.game = s.game;
        this.memory = s.memory ?? {};
        this.proxied = new Set(s.proxied ?? []);
      } catch {
        /* 깨진 상태는 무시 */
      }
    }
    if (this.stopped) return;
    this.unsubs.push(onValue(ref(db, `${this.base}/players`), (s) => this.onPlayers(s.val() ?? {})));
    this.unsubs.push(onChildAdded(ref(db, `${this.base}/actions`), (s) => this.onAction(s.key!, s.val())));
  }

  stop() {
    this.stopped = true;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.deadline) clearTimeout(this.deadline.timer);
  }

  // ---------- 방 관리 ----------
  private onPlayers(val: Record<string, RoomPlayerData>) {
    const now = serverNow();
    for (const [id, p] of Object.entries(val)) {
      if (p.isBot) continue;
      if (p.online === false) this.offlineSince[id] ??= now;
      else {
        delete this.offlineSince[id];
        if (this.proxied.delete(id) && this.game) this.game.log.push(`🔌 ${p.name}이(가) 돌아왔습니다. 다시 직접 플레이합니다.`);
      }
    }
    this.players = val;
    if (this.game) this.publish();
  }

  private isOnline = (id: string) => {
    const p = this.players[id];
    return !!p && !p.isBot && p.online !== false;
  };

  async startGame(): Promise<string | null> {
    const ids = Object.keys(this.players);
    if (ids.length < 2) return '2명 이상 필요합니다.';
    if (ids.length > 7) return '최대 7명까지 할 수 있습니다.';
    const seats = ids.sort(() => Math.random() - 0.5).map((id) => ({ id, name: this.players[id].name }));
    this.game = createGame(seats);
    this.memory = {};
    this.proxied.clear();
    this.turnDeadline = null;
    await update(ref(db, `${this.base}/meta`), { started: true });
    this.publish();
    return null;
  }

  async backToLobby() {
    if (!this.game || this.game.phase !== 'over') return;
    this.clearDeadline();
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.game = null;
    const updates: Record<string, unknown> = {
      [`${this.base}/state`]: null,
      [`${this.base}/views`]: null,
      [`${this.base}/public`]: null,
      [`${this.base}/meta/started`]: false,
    };
    // 연결이 끊긴 사람은 대기실에서 뺀다
    for (const [id, p] of Object.entries(this.players)) if (!p.isBot && p.online === false) updates[`${this.base}/players/${id}`] = null;
    await update(ref(db), updates);
  }

  // ---------- 행동 처리 ----------
  private onAction(key: string, val: { uid: string; a: string; id: string }) {
    remove(ref(db, `${this.base}/actions/${key}`));
    if (!val?.uid || !val.a) return;
    let err: string | null;
    if (!this.game) err = '진행 중인 게임이 없습니다.';
    else {
      let action: Action;
      try {
        action = JSON.parse(val.a);
      } catch {
        return;
      }
      err = applyWithMemory(this.game, this.memory, val.uid, action, applyAction);
    }
    update(ref(db, `${this.base}/feedback/${val.uid}`), { id: val.id, ok: !err, error: err ?? '' });
    if (!err) this.publish();
  }

  /** 상태 저장 + 플레이어별 화면 전송 + 봇/제한 시간 예약 */
  private publish() {
    const g = this.game;
    if (!g || this.stopped) return;
    this.updateDeadline();
    const updates: Record<string, unknown> = {
      [`${this.base}/state`]: JSON.stringify({ game: g, memory: this.memory, proxied: [...this.proxied] }),
      [`${this.base}/public`]: {
        deadline: this.deadline ? { playerId: this.deadline.playerId, kind: this.deadline.kind, endsAt: this.deadline.at } : null,
        proxied: Object.fromEntries([...this.proxied].map((id) => [id, true])),
      },
    };
    for (const p of g.players) {
      if (this.players[p.id]?.isBot) continue;
      updates[`${this.base}/views/${p.id}`] = JSON.stringify(viewFor(g, p.id));
    }
    update(ref(db), updates).catch((e) => console.error('게임 상태 저장 실패', e));
    this.scheduleBots();
  }

  // ---------- 봇 / 연결 끊긴 사람 대행 ----------
  private scheduleBots() {
    const g = this.game;
    if (!g || this.botTimer || g.phase === 'over') return;

    if (g.phase === 'pickCharacter') {
      const bots = Object.keys(g.charOffers).filter((id) => this.players[id]?.isBot);
      if (!bots.length) return;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (!this.game) return;
        for (const id of bots) if (this.game.charOffers[id]) runBotStep(this.game, this.memory, id, applyAction);
        this.publish();
      }, BOT_DELAY);
      return;
    }

    const actorId = whoActs(g);
    const actor = actorId ? this.players[actorId] : undefined;
    if (!actorId || !actor || this.isOnline(actorId)) return;
    const delay =
      actor.isBot || this.proxied.has(actorId) ? BOT_DELAY : Math.max(BOT_DELAY, (this.offlineSince[actorId] ?? serverNow()) + OFFLINE_GRACE - serverNow());
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const game = this.game;
      if (!game) return;
      if (whoActs(game) !== actorId || this.isOnline(actorId)) return this.scheduleBots();
      if (!actor.isBot && !this.proxied.has(actorId)) {
        this.proxied.add(actorId);
        game.log.push(`📴 ${actor.name}의 연결이 끊겨 봇이 대신 플레이합니다.`);
      }
      runBotStep(game, this.memory, actorId, applyAction);
      this.publish();
    }, delay);
  }

  // ---------- 제한 시간 ----------
  private decisionKey(): { key: string; actor: string; kind: 'turn' | 'response' } | null {
    const s = this.game;
    if (!s) return null;
    const actor = whoActs(s);
    if (!actor) return null;
    const p = s.pending;
    if (p) {
      const extra = p.kind === 'store' ? p.cards.length : p.kind === 'duel' ? '' : `${p.attackerId}:${p.queue.length}`;
      return { key: `${p.kind}:${actor}:${extra}:${s.turnNo}`, actor, kind: 'response' };
    }
    return { key: `${s.phase}:${actor}:${s.turnNo}`, actor, kind: s.phase === 'play' ? 'turn' : 'response' };
  }

  private clearDeadline() {
    if (this.deadline) clearTimeout(this.deadline.timer);
    this.deadline = null;
  }

  private updateDeadline() {
    const g = this.game;
    if (!g || g.phase === 'over') return this.clearDeadline();
    if (g.phase === 'pickCharacter') {
      if (this.deadline?.key === 'pick') return;
      this.clearDeadline();
      this.deadline = { key: 'pick', playerId: '*', kind: 'response', at: serverNow() + RESPONSE_TIMEOUT, timer: setTimeout(() => this.onPickTimeout(), RESPONSE_TIMEOUT) };
      return;
    }
    const d = this.decisionKey();
    // 봇·연결 끊긴 사람은 scheduleBots 가 처리
    if (!d || !this.isOnline(d.actor)) return this.clearDeadline();
    if (this.deadline?.key === d.key) return;
    this.clearDeadline();
    let at = serverNow() + (d.kind === 'turn' ? TURN_TIMEOUT : RESPONSE_TIMEOUT);
    if (d.kind === 'turn') {
      if (this.turnDeadline?.turnNo === g.turnNo) at = Math.max(this.turnDeadline.at, serverNow() + MIN_TURN_LEFT);
      else this.turnDeadline = { turnNo: g.turnNo, at };
    }
    const key = d.key;
    this.deadline = { key, playerId: d.actor, kind: d.kind, at, timer: setTimeout(() => this.onTimeout(key), at - serverNow()) };
  }

  private onPickTimeout() {
    this.deadline = null;
    const s = this.game;
    if (!s || s.phase !== 'pickCharacter') return;
    const late = Object.keys(s.charOffers);
    if (late.length) s.log.push(`⏱ 시간 초과 — ${late.map((id) => this.players[id]?.name ?? '?').join(', ')}의 캐릭터를 자동으로 골랐습니다.`);
    for (const id of late) if (s.charOffers[id]) runBotStep(s, this.memory, id, applyAction);
    this.publish();
  }

  /** 시간 초과: 내 턴이면 턴 종료, 응답/선택이면 봇 로직으로 대신 처리 */
  private onTimeout(key: string) {
    this.deadline = null;
    const s = this.game;
    if (!s) return;
    const d = this.decisionKey();
    if (!d || d.key !== key) return this.publish();
    s.log.push(`⏱ ${this.players[d.actor]?.name ?? '?'} 시간 초과 — 자동으로 진행합니다.`);
    if (d.kind === 'turn') applyWithMemory(s, this.memory, d.actor, { type: 'endTurn' }, applyAction);
    for (let i = 0; i < 10; i++) {
      const now = this.decisionKey();
      if (!now || now.actor !== d.actor || (now.key !== key && s.phase !== 'discard')) break;
      if (!runBotStep(s, this.memory, d.actor, applyAction)) break;
    }
    this.publish();
  }
}
