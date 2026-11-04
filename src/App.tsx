import { useEffect, useState } from 'react';
import type { PlayerView } from '../shared/engine';
import type { ChatMessage, RoomInfo } from '../shared/protocol';
import { addBot, claimHostIfAbandoned, createRoom, joinRoom, leaveRoom, rejoin, removeBot, startGame, watchChat, watchRoom, watchView } from './net';
import Game from './Game';
import Chat from './Chat';

// 탭마다 다른 플레이어로 테스트할 수 있도록 sessionStorage 사용
const SESSION = 'showdown-session';
type Session = { code: string; playerId: string };
const loadSession = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION) ?? 'null');
  } catch {
    return null;
  }
};

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('showdown-name') ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);

  const save = (s: Session | null) => {
    setSession(s);
    if (s) sessionStorage.setItem(SESSION, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION);
  };

  // 새로고침 시 이전 방으로 복귀
  const [ready, setReady] = useState(!loadSession());
  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    rejoin(s.code).then((res) => {
      if (!res.ok) save(null);
      setReady(true);
    });
  }, []);

  // 방 / 내 화면 / 채팅 구독
  useEffect(() => {
    if (!session || !ready) return;
    const offs = [
      watchRoom(session.code, (r) => {
        if (!r) {
          // 방이 사라짐
          save(null);
          setRoom(null);
          setView(null);
          setChat([]);
          return;
        }
        setRoom(r);
        if (!r.started) setView(null);
        claimHostIfAbandoned(r);
      }),
      watchView(session.code, session.playerId, setView),
      watchChat(session.code, setChat),
    ];
    return () => offs.forEach((o) => o());
  }, [session?.code, session?.playerId, ready]);

  const enter = async (event: 'createRoom' | 'joinRoom') => {
    setError('');
    if (!name.trim()) return setError('이름을 입력하세요.');
    localStorage.setItem('showdown-name', name.trim());
    setBusy(true);
    const res = event === 'createRoom' ? await createRoom(name) : await joinRoom(code, name);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? '오류');
    save({ code: res.code!, playerId: res.playerId! });
  };

  const leave = () => {
    leaveRoom();
    save(null);
    setRoom(null);
    setView(null);
    setChat([]);
  };

  const myName = room?.players.find((p) => p.id === session?.playerId)?.name ?? name;

  if (session && room && view) {
    return <Game view={view} room={room} chat={chat} myName={myName} onLeave={leave} />;
  }

  if (session && (!ready || (room && room.started && !view))) {
    return (
      <div className="center-screen">
        <div className="panel lobby">
          <h2>게임 불러오는 중…</h2>
          {room && !room.players.find((p) => p.id === room.hostId)?.connected && <p className="hint">방장의 연결을 기다리는 중입니다.</p>}
          <button onClick={leave}>나가기</button>
        </div>
      </div>
    );
  }

  if (session && room) {
    const isHost = room.hostId === session.playerId;
    const n = room.players.length;
    return (
      <div className="center-screen">
        <div className="panel lobby">
          <h1>대기실</h1>
          <p className="room-code">
            방 코드 <b>{room.code}</b>
          </p>
          <ul className="lobby-players">
            {room.players.map((p) => (
              <li key={p.id}>
                {p.name} {p.id === room.hostId && '👑'} {p.id === session.playerId && '(나)'} {!p.isBot && !p.connected && '📴'}
                {p.isBot && isHost && (
                  <button className="mini" title="봇 빼기" onClick={() => removeBot(p.id)}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && (
            <button disabled={n >= 7} onClick={async () => {
              const r = await addBot();
              if (!r.ok) setError(r.error ?? '');
            }}>
              🤖 봇 추가
            </button>
          )}
          <p className="hint">
            {n}/7명 · 정식 규칙은 4~7명 {n < 4 && n >= 2 && '(지금은 테스트 모드로 시작됩니다)'}
          </p>
          {error && <p className="error">{error}</p>}
          <div className="row">
            {isHost ? (
              <button
                className="primary"
                disabled={n < 2}
                onClick={async () => {
                  const r = await startGame();
                  if (!r.ok) setError(r.error ?? '');
                }}
              >
                게임 시작
              </button>
            ) : (
              <span className="hint">방장이 시작하기를 기다리는 중…</span>
            )}
            <button onClick={leave}>나가기</button>
          </div>
          <Chat messages={chat} me={session.playerId} myName={myName} className="lobby-chat" />
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="panel lobby">
        <h1>🤠 황야의 결투</h1>
        <p className="hint">숨은 역할 · 거리 기반 총격전 카드 게임</p>
        <input placeholder="이름" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={busy} onClick={() => enter('createRoom')}>
          방 만들기
        </button>
        <div className="row">
          <input placeholder="방 코드" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button disabled={busy} onClick={() => enter('joinRoom')}>참가</button>
        </div>
        {error && <p className="error">{error}</p>}
        <a className="admin-link" href="#/admin">
          관리자 화면
        </a>
      </div>
    </div>
  );
}
