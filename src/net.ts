// Firebase Realtime Database 를 통한 방/게임/채팅 통신 (Socket.IO 대체)
import {
  get, limitToLast, onDisconnect, onValue, push, query, ref, remove, runTransaction, set, update,
} from 'firebase/database';
import type { Action, PlayerView } from '../shared/engine';
import { CHAT_MAX_LENGTH, type ChatMessage, type RoomInfo } from '../shared/protocol';
import { db, ensureUser, serverNow } from './firebase';
import { Host, type RoomPlayerData } from './host';

export type AckRes = { ok: boolean; error?: string; code?: string; playerId?: string };

const BOT_NAMES = ['콜트', '스미스', '웨슨', '레밍', '스펜서', '헨리', '샤프스', '데린저'];
const cleanName = (n: unknown) => String(n ?? '').trim().slice(0, 12) || '이름없음';

let current: { code: string; uid: string } | null = null;
let host: Host | null = null;
let presenceOff: (() => void) | null = null;
let lastRoom: RoomInfo | null = null;

export const currentSession = () => current;

// ---------- 접속 상태 (online) ----------
function startPresence(code: string, uid: string) {
  presenceOff?.();
  const me = ref(db, `rooms/${code}/players/${uid}/online`);
  presenceOff = onValue(ref(db, '.info/connected'), (s) => {
    if (s.val() !== true) return;
    onDisconnect(me).set(false).then(() => set(me, true)).catch(() => {});
  });
}
function stopPresence(code: string, uid: string) {
  presenceOff?.();
  presenceOff = null;
  onDisconnect(ref(db, `rooms/${code}/players/${uid}/online`)).cancel().catch(() => {});
}

// ---------- 방장 역할 ----------
/** 방 정보가 바뀔 때마다 호출: 내가 방장이면 Host 를 돌리고, 아니면 멈춘다 */
function syncHost(room: RoomInfo | null) {
  const amHost = !!room && !!current && room.hostId === current.uid;
  if (amHost && (!host || host.code !== room!.code)) {
    host?.stop();
    host = new Host(room!.code, current!.uid);
    host.start();
  } else if (!amHost && host) {
    host.stop();
    host = null;
  }
}

// ---------- 방 만들기 / 참가 ----------
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

async function addMe(code: string, uid: string, name: string) {
  const p: RoomPlayerData = { name: cleanName(name), isBot: false, online: true, joinedAt: serverNow() };
  await set(ref(db, `rooms/${code}/players/${uid}`), p);
  current = { code, uid };
  startPresence(code, uid);
}

export async function createRoom(name: string): Promise<AckRes> {
  try {
    const user = await ensureUser();
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      const tx = await runTransaction(ref(db, `rooms/${code}/meta`), (cur) =>
        cur ? undefined : { hostUid: user.uid, started: false, createdAt: serverNow() },
      );
      if (!tx.committed) continue;
      await addMe(code, user.uid, name);
      await set(ref(db, `roomIndex/${code}`), serverNow()).catch(() => {});
      return { ok: true, code, playerId: user.uid };
    }
    return { ok: false, error: '방 코드를 만들지 못했습니다. 다시 시도해 주세요.' };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function joinRoom(code: string, name: string): Promise<AckRes> {
  try {
    const user = await ensureUser();
    code = String(code ?? '').toUpperCase();
    const meta = (await get(ref(db, `rooms/${code}/meta`))).val();
    if (!meta) return { ok: false, error: '방을 찾을 수 없습니다.' };
    const players = (await get(ref(db, `rooms/${code}/players`))).val() ?? {};
    if (players[user.uid]) {
      await addMe(code, user.uid, players[user.uid].name);
      return { ok: true, code, playerId: user.uid };
    }
    if (meta.started) return { ok: false, error: '이미 시작된 게임입니다.' };
    if (Object.keys(players).length >= 7) return { ok: false, error: '방이 가득 찼습니다. (최대 7명)' };
    await addMe(code, user.uid, name);
    return { ok: true, code, playerId: user.uid };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function rejoin(code: string): Promise<AckRes> {
  try {
    const user = await ensureUser();
    const p = (await get(ref(db, `rooms/${code}/players/${user.uid}`))).val();
    if (!p) return { ok: false, error: '이전 게임을 찾을 수 없습니다.' };
    current = { code, uid: user.uid };
    startPresence(code, user.uid);
    return { ok: true, code, playerId: user.uid };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function leaveRoom() {
  if (!current) return;
  const { code, uid } = current;
  const room = lastRoom;
  stopPresence(code, uid);
  host?.stop();
  host = null;
  current = null;
  try {
    if (room && !room.started) {
      if (room.hostId === uid) {
        const next = room.players.find((p) => !p.isBot && p.id !== uid && p.connected);
        if (next) await update(ref(db, `rooms/${code}/meta`), { hostUid: next.id });
        else {
          // 사람이 아무도 없으면 방 삭제
          await remove(ref(db, `roomIndex/${code}`)).catch(() => {});
          await remove(ref(db, `rooms/${code}`));
          return;
        }
      }
      await remove(ref(db, `rooms/${code}/players/${uid}`));
    } else {
      // 게임 중에는 자리를 유지 (재접속 / 봇 대행)
      await set(ref(db, `rooms/${code}/players/${uid}/online`), false);
    }
  } catch {
    /* 나가기는 실패해도 무시 */
  }
}

// ---------- 방장 전용 ----------
export async function addBot(): Promise<AckRes> {
  if (!current || !lastRoom || lastRoom.hostId !== current.uid) return { ok: false, error: '방장만 봇을 추가할 수 있습니다.' };
  if (lastRoom.players.length >= 7) return { ok: false, error: '방이 가득 찼습니다. (최대 7명)' };
  const used = new Set(lastRoom.players.map((p) => p.name));
  const name = BOT_NAMES.map((n) => `🤖 ${n}`).find((n) => !used.has(n)) ?? `🤖 봇${lastRoom.players.length}`;
  const id = `bot-${Math.random().toString(36).slice(2, 10)}`;
  await set(ref(db, `rooms/${current.code}/players/${id}`), { name, isBot: true, joinedAt: serverNow() });
  return { ok: true };
}

export async function removeBot(id: string): Promise<AckRes> {
  if (!current || !id.startsWith('bot-')) return { ok: false };
  await remove(ref(db, `rooms/${current.code}/players/${id}`));
  return { ok: true };
}

export async function startGame(): Promise<AckRes> {
  if (!host) return { ok: false, error: '방장만 시작할 수 있습니다.' };
  const err = await host.startGame();
  return err ? { ok: false, error: err } : { ok: true };
}

export function restartToLobby() {
  host?.backToLobby();
}

// ---------- 게임 행동 ----------
/** 행동을 올리고 방장의 처리 결과를 기다린다 */
export async function sendAction(a: Action): Promise<AckRes> {
  if (!current) return { ok: false, error: '방에 들어가 있지 않습니다.' };
  const { code, uid } = current;
  const id = Math.random().toString(36).slice(2, 12);
  return new Promise<AckRes>((resolve) => {
    let done = false;
    const finish = (r: AckRes) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(t);
      resolve(r);
    };
    const off = onValue(ref(db, `rooms/${code}/feedback/${uid}`), (s) => {
      const v = s.val();
      if (v?.id === id) finish({ ok: !!v.ok, error: v.error || undefined });
    });
    const t = setTimeout(() => finish({ ok: false, error: '방장의 응답이 없습니다. 방장의 연결을 기다리는 중…' }), 8000);
    push(ref(db, `rooms/${code}/actions`), { uid, id, a: JSON.stringify(a), at: serverNow() }).catch((e) => finish({ ok: false, error: friendly(e) }));
  });
}

// ---------- 채팅 ----------
let lastChatAt = 0;
export async function sendChat(text: string, name: string): Promise<AckRes> {
  if (!current) return { ok: false, error: '방에 들어가 있지 않습니다.' };
  const t = String(text ?? '').trim().slice(0, CHAT_MAX_LENGTH);
  if (!t) return { ok: false, error: '내용을 입력하세요.' };
  if (Date.now() - lastChatAt < 500) return { ok: false, error: '조금 천천히 보내주세요.' };
  lastChatAt = Date.now();
  try {
    await push(ref(db, `rooms/${current.code}/chat`), { uid: current.uid, name, text: t, at: serverNow() });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

// ---------- 구독 ----------
/** 방 정보 (메타 + 참가자 + 제한 시간) */
export function watchRoom(code: string, cb: (r: RoomInfo | null) => void): () => void {
  let meta: { hostUid: string; started: boolean } | null = null;
  let players: Record<string, RoomPlayerData> = {};
  let pub: { deadline?: { playerId: string; kind: 'turn' | 'response'; endsAt: number }; proxied?: Record<string, boolean> } = {};
  let gotMeta = false;
  const emit = () => {
    if (!gotMeta) return;
    if (!meta) {
      lastRoom = null;
      syncHost(null);
      return cb(null);
    }
    const room: RoomInfo = {
      code,
      hostId: meta.hostUid,
      started: !!meta.started,
      players: Object.entries(players)
        .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
        .map(([id, p]) => ({ id, name: p.name, isBot: !!p.isBot, connected: !p.isBot && p.online !== false, proxied: !!pub.proxied?.[id] })),
      deadline: pub.deadline ? { playerId: pub.deadline.playerId, kind: pub.deadline.kind, remainingMs: Math.max(0, pub.deadline.endsAt - serverNow()) } : null,
    };
    lastRoom = room;
    syncHost(room);
    cb(room);
  };
  const offs = [
    onValue(ref(db, `rooms/${code}/meta`), (s) => {
      gotMeta = true;
      meta = s.val();
      emit();
    }),
    onValue(ref(db, `rooms/${code}/players`), (s) => {
      players = s.val() ?? {};
      emit();
    }),
    onValue(ref(db, `rooms/${code}/public`), (s) => {
      pub = s.val() ?? {};
      emit();
    }),
  ];
  return () => offs.forEach((o) => o());
}

/** 방장이 연결이 끊긴 상태로 대기실에 남아 있으면 내가 방장을 넘겨받는다 */
export async function claimHostIfAbandoned(room: RoomInfo) {
  if (!current || room.started) return;
  const hostP = room.players.find((p) => p.id === room.hostId);
  if (hostP && hostP.connected) return;
  const firstOnline = room.players.find((p) => !p.isBot && p.connected);
  if (firstOnline?.id !== current.uid) return;
  await update(ref(db, `rooms/${room.code}/meta`), { hostUid: current.uid }).catch(() => {});
}

export function watchView(code: string, uid: string, cb: (v: PlayerView | null) => void): () => void {
  return onValue(ref(db, `rooms/${code}/views/${uid}`), (s) => {
    const v = s.val();
    if (!v) return cb(null);
    try {
      cb(JSON.parse(v));
    } catch {
      cb(null);
    }
  });
}

export function watchChat(code: string, cb: (msgs: ChatMessage[]) => void): () => void {
  return onValue(
    query(ref(db, `rooms/${code}/chat`), limitToLast(100)),
    (s) => {
      const list: ChatMessage[] = [];
      s.forEach((c) => {
        const v = c.val();
        list.push({ id: c.key!, playerId: v.uid, name: v.name, text: v.text, at: v.at });
      });
      cb(list);
    },
    () => cb([]),
  );
}

function friendly(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (msg.includes('PERMISSION_DENIED') || msg.includes('permission')) return '권한이 없습니다. (데이터베이스 보안 규칙을 확인하세요)';
  if (msg.includes('auth/operation-not-allowed') || msg.includes('admin-restricted')) return 'Firebase 익명 로그인이 꺼져 있습니다. 콘솔에서 사용 설정하세요.';
  return '연결 오류: ' + msg.slice(0, 120);
}
