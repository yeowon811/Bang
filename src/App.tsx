import { useEffect, useState } from 'react';
import type { PlayerView } from '../shared/engine';
import type { ChatMessage, RoomInfo } from '../shared/protocol';
import { emit, socket } from './socket';
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

  const save = (s: Session | null) => {
    setSession(s);
    if (s) sessionStorage.setItem(SESSION, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION);
  };

  useEffect(() => {
    const onRoom = (r: RoomInfo) => {
      setRoom(r);
      if (!r.started) setView(null);
    };
    const onConnect = () => {
      const s = loadSession();
      if (s) emit('rejoin', s).then((res) => !res.ok && save(null));
    };
    const onChat = (m: ChatMessage) => setChat((c) => [...c.slice(-99), m]);
    socket.on('chat', onChat);
    socket.on('chatHistory', setChat);
    socket.on('room', onRoom);
    socket.on('game', setView);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('chat', onChat);
      socket.off('chatHistory', setChat);
      socket.off('room', onRoom);
      socket.off('game', setView);
      socket.off('connect', onConnect);
    };
  }, []);

  const enter = async (event: 'createRoom' | 'joinRoom') => {
    setError('');
    if (!name.trim()) return setError('이름을 입력하세요.');
    localStorage.setItem('showdown-name', name.trim());
    const res = await emit(event, { name, code });
    if (!res.ok) return setError(res.error ?? '오류');
    save({ code: res.code!, playerId: res.playerId! });
  };

  const leave = () => {
    socket.emit('leaveRoom');
    save(null);
    setRoom(null);
    setView(null);
    setChat([]);
  };

  if (session && room && view) {
    return <Game view={view} room={room} chat={chat} onLeave={leave} />;
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
                {p.name} {p.id === room.hostId && '👑'} {p.id === session.playerId && '(나)'}
                {p.isBot && isHost && (
                  <button className="mini" title="봇 빼기" onClick={() => emit('removeBot', { id: p.id })}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && (
            <button disabled={n >= 7} onClick={async () => {
              const r = await emit('addBot');
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
                  const r = await emit('startGame');
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
          <Chat messages={chat} me={session.playerId} className="lobby-chat" />
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
        <button className="primary" onClick={() => enter('createRoom')}>
          방 만들기
        </button>
        <div className="row">
          <input placeholder="방 코드" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button onClick={() => enter('joinRoom')}>참가</button>
        </div>
        {error && <p className="error">{error}</p>}
        <a className="admin-link" href="/admin">
          관리자 화면
        </a>
      </div>
    </div>
  );
}
