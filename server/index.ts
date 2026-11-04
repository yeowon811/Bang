import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Action, applyAction, createGame, GameState, viewFor } from '../shared/engine';
import { CARD_DEFS, IMAGE_KEYS, ImageKey, ROLE_DEFS } from '../shared/cards';
import { CHARACTERS } from '../shared/characters';
import { applyWithMemory, BotMemory, runBotStep, whoActs } from '../shared/bot';
import { CHAT_MAX_LENGTH, type CardInfo, type ChatMessage, type RoomInfo } from '../shared/protocol';

const IS_PROD = process.env.NODE_ENV === 'production';
// 개발 시 vite(5173)가 /api, /socket.io 를 이 포트로 프록시한다. 배포 시엔 PORT(호스팅이 지정) 사용.
const PORT = Number(process.env.SERVER_PORT ?? (IS_PROD ? process.env.PORT : undefined) ?? (IS_PROD ? 3000 : 3001));
const ADMIN_KEY = process.env.ADMIN_KEY ?? (IS_PROD ? '' : 'admin');
if (IS_PROD && ADMIN_KEY.length < 8) {
  console.error('❌ 배포 환경에서는 ADMIN_KEY 환경변수(8자 이상)를 반드시 설정해야 합니다.');
  process.exit(1);
}
const ROOT = process.cwd();
// 카드 설정·업로드 이미지 저장 위치. 배포 시 영구 볼륨 경로로 지정 (예: /data)
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR ?? ROOT);
const DATA_FILE = path.join(STORAGE_DIR, 'data', 'card-config.json');
const UPLOAD_DIR = path.join(STORAGE_DIR, 'uploads');
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- 카드 설정 (관리자) ----------
type Override = { name?: string; description?: string; image?: string };
let config: Record<string, Override> = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};
const saveConfig = () => fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));

function cardList(): CardInfo[] {
  const base: Omit<CardInfo, 'name' | 'description' | 'image'>[] = [];
  for (const d of CARD_DEFS) {
    base.push({ key: d.type, kind: 'card', color: d.color, count: d.count, defaultName: d.name, defaultDescription: d.description });
  }
  for (const r of ROLE_DEFS) {
    base.push({ key: `role-${r.role}`, kind: 'role', defaultName: r.name, defaultDescription: r.description });
  }
  for (const c of CHARACTERS) {
    base.push({ key: `char-${c.id}`, kind: 'character', hp: c.hp, defaultName: c.name, defaultDescription: c.description });
  }
  base.push({ key: 'back', kind: 'back', defaultName: '카드 뒷면', defaultDescription: '' });
  return base.map((b) => ({
    ...b,
    name: config[b.key]?.name || b.defaultName,
    description: config[b.key]?.description || b.defaultDescription,
    image: config[b.key]?.image ? `/uploads/${config[b.key].image}` : null,
  }));
}

const app = express();
app.use(express.json());
// 업로드 파일(SVG 포함) 안의 스크립트가 실행되지 않도록 CSP 적용
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, express.static(UPLOAD_DIR, { maxAge: '1h' }));

const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (req.header('x-admin-key') !== ADMIN_KEY) return void res.status(401).json({ error: '관리자 키가 올바르지 않습니다.' });
  next();
};
const validKey = (k: string): k is ImageKey => (IMAGE_KEYS as string[]).includes(k);

const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${req.params.key}-${Date.now()}${MIME_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in MIME_EXT),
});

function removeImage(key: string) {
  const old = config[key]?.image;
  if (old) fs.rm(path.join(UPLOAD_DIR, path.basename(old)), { force: true }, () => {});
}

app.get('/api/cards', (_req, res) => res.json(cardList()));
// 호스팅 헬스체크용
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/admin/check', requireAdmin, (_req, res) => res.json({ ok: true }));

app.put('/api/cards/:key', requireAdmin, (req, res) => {
  const key = String(req.params.key);
  if (!validKey(key)) return void res.status(404).json({ error: '없는 항목입니다.' });
  const { name, description } = req.body ?? {};
  config[key] = { ...config[key], name: String(name ?? '').slice(0, 30), description: String(description ?? '').slice(0, 200) };
  saveConfig();
  io.emit('cardsUpdated');
  res.json(cardList());
});

app.post('/api/cards/:key/image', requireAdmin, upload.single('image'), (req, res) => {
  const key = String(req.params.key);
  if (!validKey(key)) return void res.status(404).json({ error: '없는 항목입니다.' });
  if (!req.file) return void res.status(400).json({ error: 'PNG/JPG/WEBP/GIF/SVG 이미지(5MB 이하)만 올릴 수 있습니다.' });
  removeImage(key);
  config[key] = { ...config[key], image: req.file.filename };
  saveConfig();
  io.emit('cardsUpdated');
  res.json(cardList());
});

app.delete('/api/cards/:key/image', requireAdmin, (req, res) => {
  const key = String(req.params.key);
  if (!validKey(key)) return void res.status(404).json({ error: '없는 항목입니다.' });
  removeImage(key);
  if (config[key]) delete config[key].image;
  saveConfig();
  io.emit('cardsUpdated');
  res.json(cardList());
});

// 빌드된 클라이언트 서빙 (npm run build 후 npm start)
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// ---------- 방 / 게임 ----------
interface RoomPlayer {
  id: string;
  name: string;
  socketId: string | null;
  isBot: boolean;
  /** 게임 중 연결이 끊긴 시각 (재접속 시 null) */
  offlineSince: number | null;
  /** 연결이 끊겨 봇이 대신 플레이 중 */
  proxied: boolean;
}
interface Room {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  game: GameState | null;
  memory: BotMemory; // 봇이 참고하는 공격 기록
  botTimer: ReturnType<typeof setTimeout> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  /** 지금 행동해야 하는 사람의 제한 시간 (playerId '*' = 캐릭터 고르기 중인 모두) */
  deadline: { key: string; playerId: string; kind: 'turn' | 'response'; at: number; timer: ReturnType<typeof setTimeout> } | null;
  chat: ChatMessage[]; // 최근 채팅 (재접속 시 다시 보내줌)
  /** 턴 전체 제한 시간 (응답 대기 후 돌아와도 이어서 계산) */
  turnDeadline: { turnNo: number; at: number } | null;
}

const rooms = new Map<string, Room>();
const httpServer = createServer(app);
const io = new Server(httpServer);
const BOT_DELAY = Number(process.env.BOT_DELAY ?? 900); // 봇 행동 간격(ms) — 사람이 따라볼 수 있게
const OFFLINE_GRACE = Number(process.env.OFFLINE_GRACE ?? 20000); // 연결이 끊긴 사람을 봇이 대신하기까지 대기(ms)
const TURN_TIMEOUT = Number(process.env.TURN_TIMEOUT ?? 60000); // 내 턴(카드 내기) 제한 시간
const RESPONSE_TIMEOUT = Number(process.env.RESPONSE_TIMEOUT ?? 20000); // 응답/선택/버리기 제한 시간
const MIN_TURN_LEFT = 10000; // 응답 대기 후 내 턴으로 돌아왔을 때 최소 남은 시간
const EMPTY_ROOM_TTL = 5 * 60 * 1000; // 게임 중 아무도 접속해 있지 않을 때 방을 지우기까지
const BOT_NAMES = ['콜트', '스미스', '웨슨', '레밍', '스펜서', '헨리', '샤프스', '데린저'];

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code: string;
  do code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(code));
  return code;
}

function roomInfo(r: Room): RoomInfo {
  return {
    code: r.code,
    hostId: r.hostId,
    started: !!r.game,
    players: r.players.map((p) => ({ id: p.id, name: p.name, connected: !!p.socketId, isBot: p.isBot, proxied: p.proxied })),
    deadline: r.deadline ? { playerId: r.deadline.playerId, kind: r.deadline.kind, remainingMs: Math.max(0, r.deadline.at - Date.now()) } : null,
  };
}

function broadcast(r: Room) {
  updateDeadline(r);
  const info = roomInfo(r);
  for (const p of r.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('room', info);
    if (r.game) io.to(p.socketId).emit('game', viewFor(r.game, p.id));
  }
  scheduleBots(r);
}

/** 지금 행동할 사람이 봇(또는 연결이 끊긴 사람)이면 잠시 뒤 봇이 한 걸음 진행 */
function scheduleBots(r: Room) {
  if (!r.game || r.botTimer || r.game.phase === 'over') return;
  // 접속한 사람이 아무도 없으면 일시정지 (누군가 돌아오면 broadcast로 재개)
  if (!r.players.some((x) => x.socketId)) return;
  // 캐릭터 고르기: 모든 봇이 한꺼번에 고른다
  if (r.game.phase === 'pickCharacter') {
    const offers = r.game.charOffers;
    if (!r.players.some((p) => p.isBot && offers[p.id])) return;
    r.botTimer = setTimeout(() => {
      r.botTimer = null;
      if (!r.game || rooms.get(r.code) !== r) return;
      for (const p of r.players) if (p.isBot && r.game.charOffers[p.id]) runBotStep(r.game, r.memory, p.id, applyAction);
      broadcast(r);
    }, BOT_DELAY);
    return;
  }
  const actor = r.players.find((p) => p.id === whoActs(r.game!));
  if (!actor || (!actor.isBot && actor.socketId)) return;
  const delay = actor.isBot || actor.proxied ? BOT_DELAY : Math.max(BOT_DELAY, (actor.offlineSince ?? Date.now()) + OFFLINE_GRACE - Date.now());
  r.botTimer = setTimeout(() => {
    r.botTimer = null;
    if (!r.game || rooms.get(r.code) !== r) return;
    if (whoActs(r.game) !== actor.id || (!actor.isBot && actor.socketId)) return scheduleBots(r);
    if (!actor.isBot && !actor.proxied) {
      actor.proxied = true;
      r.game.log.push(`📴 ${actor.name}의 연결이 끊겨 봇이 대신 플레이합니다.`);
    }
    if (!runBotStep(r.game, r.memory, actor.id, applyAction)) console.error(`[${r.code}] ${actor.name}: 봇이 할 수 있는 행동 없음`);
    broadcast(r);
  }, delay);
}

// ---------- 제한 시간 ----------
/** 지금 기다리는 결정을 구분하는 키 (같은 결정이면 타이머를 다시 시작하지 않는다) */
function decisionKey(s: GameState): { key: string; actor: string; kind: 'turn' | 'response' } | null {
  const actor = whoActs(s);
  if (!actor) return null;
  const p = s.pending;
  if (p) {
    const extra = p.kind === 'store' ? p.cards.length : p.kind === 'duel' ? '' : `${p.attackerId}:${p.queue.length}`;
    return { key: `${p.kind}:${actor}:${extra}:${s.turnNo}`, actor, kind: 'response' };
  }
  return { key: `${s.phase}:${actor}:${s.turnNo}`, actor, kind: s.phase === 'play' ? 'turn' : 'response' };
}

function clearDeadline(r: Room) {
  if (r.deadline) clearTimeout(r.deadline.timer);
  r.deadline = null;
}

function updateDeadline(r: Room) {
  // 캐릭터 고르기: 모두에게 하나의 제한 시간
  if (r.game?.phase === 'pickCharacter') {
    if (r.deadline?.key === 'pick') return;
    clearDeadline(r);
    const at = Date.now() + RESPONSE_TIMEOUT;
    r.deadline = { key: 'pick', playerId: '*', kind: 'response', at, timer: setTimeout(() => onPickTimeout(r), RESPONSE_TIMEOUT) };
    return;
  }
  const d = r.game && r.game.phase !== 'over' ? decisionKey(r.game) : null;
  const p = d && r.players.find((x) => x.id === d.actor);
  // 봇·연결 끊긴 사람은 scheduleBots가 처리
  if (!d || !p || p.isBot || !p.socketId) return clearDeadline(r);
  if (r.deadline?.key === d.key) return;
  clearDeadline(r);
  let at = Date.now() + (d.kind === 'turn' ? TURN_TIMEOUT : RESPONSE_TIMEOUT);
  if (d.kind === 'turn') {
    const turnNo = r.game!.turnNo;
    if (r.turnDeadline?.turnNo === turnNo) at = Math.max(r.turnDeadline.at, Date.now() + MIN_TURN_LEFT);
    else r.turnDeadline = { turnNo, at };
  }
  const key = d.key;
  r.deadline = { key, playerId: p.id, kind: d.kind, at, timer: setTimeout(() => onTimeout(r, key), at - Date.now()) };
}

/** 시간 초과: 내 턴이면 턴 종료, 응답/선택이면 봇 로직으로 대신 처리 */
function onTimeout(r: Room, key: string) {
  r.deadline = null;
  const s = r.game;
  if (!s || rooms.get(r.code) !== r) return;
  const d = decisionKey(s);
  if (!d || d.key !== key) return broadcast(r);
  const p = r.players.find((x) => x.id === d.actor)!;
  s.log.push(`⏱ ${p.name} 시간 초과 — 자동으로 진행합니다.`);
  if (d.kind === 'turn') applyWithMemory(s, r.memory, p.id, { type: 'endTurn' }, applyAction);
  for (let i = 0; i < 10; i++) {
    const now = decisionKey(s);
    if (!now || now.actor !== p.id || (now.key !== key && s.phase !== 'discard')) break;
    if (!runBotStep(s, r.memory, p.id, applyAction)) break;
  }
  broadcast(r);
}

/** 캐릭터 고르기 시간 초과: 아직 안 고른 사람은 봇 선호 순서로 자동 선택 */
function onPickTimeout(r: Room) {
  r.deadline = null;
  const s = r.game;
  if (!s || rooms.get(r.code) !== r || s.phase !== 'pickCharacter') return;
  const late = r.players.filter((p) => s.charOffers[p.id]);
  if (late.length) s.log.push(`⏱ 시간 초과 — ${late.map((p) => p.name).join(', ')}의 캐릭터를 자동으로 골랐습니다.`);
  for (const p of late) if (s.charOffers[p.id]) runBotStep(s, r.memory, p.id, applyAction);
  broadcast(r);
}

function stopBots(r: Room) {
  if (r.botTimer) clearTimeout(r.botTimer);
  r.botTimer = null;
  clearDeadline(r);
}

type Ack = (res: { ok: boolean; error?: string; code?: string; playerId?: string }) => void;
const cleanName = (n: unknown) => String(n ?? '').trim().slice(0, 12) || '이름없음';
const human = (id: string, name: unknown): RoomPlayer => ({ id, name: cleanName(name), socketId: null, isBot: false, offlineSince: null, proxied: false });

io.on('connection', (socket: Socket) => {
  let room: Room | null = null;
  let playerId: string | null = null;

  const attach = (r: Room, p: RoomPlayer) => {
    room = r;
    playerId = p.id;
    p.socketId = socket.id;
    p.offlineSince = null;
    if (r.cleanupTimer) clearTimeout(r.cleanupTimer);
    r.cleanupTimer = null;
    if (p.proxied && r.game) r.game.log.push(`🔌 ${p.name}이(가) 돌아왔습니다. 다시 직접 플레이합니다.`);
    p.proxied = false;
    socket.emit('chatHistory', r.chat);
    broadcast(r);
  };
  const isHostInLobby = () => !!room && room.hostId === playerId && !room.game;

  socket.on('createRoom', ({ name }, ack: Ack) => {
    const code = newCode();
    const p = human(crypto.randomUUID(), name);
    const r: Room = { code, hostId: p.id, players: [p], game: null, memory: {}, botTimer: null, cleanupTimer: null, deadline: null, turnDeadline: null, chat: [] };
    rooms.set(code, r);
    attach(r, p);
    ack({ ok: true, code, playerId: p.id });
  });

  socket.on('joinRoom', ({ code, name }, ack: Ack) => {
    const r = rooms.get(String(code ?? '').toUpperCase());
    if (!r) return ack({ ok: false, error: '방을 찾을 수 없습니다.' });
    if (r.game) return ack({ ok: false, error: '이미 시작된 게임입니다.' });
    if (r.players.length >= 7) return ack({ ok: false, error: '방이 가득 찼습니다. (최대 7명)' });
    const p = human(crypto.randomUUID(), name);
    r.players.push(p);
    attach(r, p);
    ack({ ok: true, code: r.code, playerId: p.id });
  });

  socket.on('rejoin', ({ code, playerId: pid }, ack: Ack) => {
    const r = rooms.get(String(code ?? ''));
    const p = r?.players.find((x) => x.id === pid && !x.isBot);
    if (!r || !p) return ack({ ok: false, error: '이전 게임을 찾을 수 없습니다.' });
    attach(r, p);
    ack({ ok: true, code: r.code, playerId: p.id });
  });

  socket.on('leaveRoom', () => leave());

  let lastChatAt = 0;
  socket.on('chat', ({ text }: { text?: unknown }, ack?: Ack) => {
    if (!room || !playerId) return ack?.({ ok: false, error: '방에 들어가 있지 않습니다.' });
    const t = String(text ?? '').trim().slice(0, CHAT_MAX_LENGTH);
    if (!t) return ack?.({ ok: false, error: '내용을 입력하세요.' });
    const now = Date.now();
    if (now - lastChatAt < 500) return ack?.({ ok: false, error: '조금 천천히 보내주세요.' });
    lastChatAt = now;
    const p = room.players.find((x) => x.id === playerId)!;
    const msg: ChatMessage = { id: crypto.randomUUID(), playerId: p.id, name: p.name, text: t, at: now };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();
    for (const x of room.players) if (x.socketId) io.to(x.socketId).emit('chat', msg);
    ack?.({ ok: true });
  });

  socket.on('addBot', (_: unknown, ack: Ack) => {
    if (!isHostInLobby()) return ack({ ok: false, error: '대기실에서 방장만 봇을 추가할 수 있습니다.' });
    const r = room!;
    if (r.players.length >= 7) return ack({ ok: false, error: '방이 가득 찼습니다. (최대 7명)' });
    const used = new Set(r.players.map((p) => p.name));
    const name = BOT_NAMES.map((n) => `🤖 ${n}`).find((n) => !used.has(n)) ?? `🤖 봇${r.players.length}`;
    r.players.push({ id: `bot-${crypto.randomUUID()}`, name, socketId: null, isBot: true, offlineSince: null, proxied: false });
    broadcast(r);
    ack({ ok: true });
  });

  socket.on('removeBot', ({ id }, ack: Ack) => {
    if (!isHostInLobby()) return ack({ ok: false, error: '대기실에서 방장만 봇을 뺄 수 있습니다.' });
    room!.players = room!.players.filter((p) => !(p.isBot && p.id === id));
    broadcast(room!);
    ack({ ok: true });
  });

  socket.on('startGame', (_: unknown, ack: Ack) => {
    if (!room || room.hostId !== playerId) return ack({ ok: false, error: '방장만 시작할 수 있습니다.' });
    if (room.players.length < 2) return ack({ ok: false, error: '2명 이상 필요합니다.' });
    // 좌석 순서를 섞는다
    const seats = [...room.players].sort(() => Math.random() - 0.5).map((p) => ({ id: p.id, name: p.name }));
    room.game = createGame(seats);
    room.memory = {};
    for (const p of room.players) p.proxied = false;
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('restartToLobby', () => {
    if (!room || room.hostId !== playerId || !room.game || room.game.phase !== 'over') return;
    stopBots(room);
    room.game = null;
    room.players = room.players.filter((p) => p.socketId || p.isBot);
    broadcast(room);
  });

  socket.on('action', (action: Action, ack: Ack) => {
    if (!room?.game || !playerId) return ack({ ok: false, error: '진행 중인 게임이 없습니다.' });
    const err = applyWithMemory(room.game, room.memory, playerId, action, applyAction);
    if (err) return ack({ ok: false, error: err });
    broadcast(room);
    ack({ ok: true });
  });

  function leave() {
    const r = room;
    if (!r || !playerId) return;
    const p = r.players.find((x) => x.id === playerId);
    if (p && p.socketId === socket.id) {
      p.socketId = null;
      if (r.game) p.offlineSince = Date.now();
    }
    // 대기실에서는 나가면 명단에서 제거, 게임 중에는 재접속을 위해 자리 유지
    if (!r.game) r.players = r.players.filter((x) => x.id !== playerId);
    const humans = r.players.filter((x) => !x.isBot);
    if (r.hostId === playerId && humans.length) r.hostId = (humans.find((x) => x.socketId) ?? humans[0]).id;
    if (!r.players.some((x) => x.socketId)) {
      stopBots(r);
      if (!r.game) rooms.delete(r.code);
      // 게임 중엔 새로고침/재접속을 기다렸다가 아무도 안 돌아오면 정리
      else r.cleanupTimer ??= setTimeout(() => rooms.get(r.code) === r && !r.players.some((x) => x.socketId) && rooms.delete(r.code), EMPTY_ROOM_TTL);
    } else broadcast(r);
    room = null;
    playerId = null;
  }

  socket.on('disconnect', () => leave());
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있습니다.`);
    console.error('   이미 실행 중인 게임 서버(다른 터미널 창)가 있는지 확인하고 종료한 뒤 다시 실행하세요.');
    console.error(`   Windows에서 찾기: netstat -ano | findstr :${PORT}\n`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}  [${IS_PROD ? 'production' : 'development'}] 저장 위치: ${STORAGE_DIR}  관리자 키: ${ADMIN_KEY === 'admin' ? '기본값 admin' : '환경변수'}`);
});

// 종료 신호 시 정리 (호스팅 재배포 시)
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
