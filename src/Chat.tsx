import { FormEvent, useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, type ChatMessage } from '../shared/protocol';
import { sendChat } from './net';

const time = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

export default function Chat({ messages, me, myName, className = '' }: { messages: ChatMessage[]; me: string; myName: string; className?: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await sendChat(text, myName);
    if (res.ok) {
      setText('');
      setError('');
    } else setError(res.error ?? '전송 실패');
  };

  return (
    <div className={`chat ${className}`}>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="hint">아직 대화가 없습니다.</div>}
        {messages.map((m) => (
          <div key={m.id} className={m.playerId === me ? 'chat-msg mine' : 'chat-msg'}>
            <span className="chat-name">{m.name}</span>
            <span className="chat-text">{m.text}</span>
            <span className="chat-time">{time(m.at)}</span>
          </div>
        ))}
      </div>
      {error && <div className="error chat-error">{error}</div>}
      <form className="chat-form" onSubmit={send}>
        <input value={text} maxLength={CHAT_MAX_LENGTH} placeholder="메시지 입력 후 Enter" onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>
          보내기
        </button>
      </form>
    </div>
  );
}
