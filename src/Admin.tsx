import { useState } from 'react';
import type { CardInfo } from '../shared/protocol';
import CardView from './CardView';
import { useCardConfig } from './cardConfig';

const KEY_STORE = 'showdown-admin-key';

export default function Admin() {
  const { list, setList } = useCardConfig();
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORE) ?? '');
  const [authed, setAuthed] = useState(false);
  const [msg, setMsg] = useState('');

  const login = async () => {
    const r = await fetch('/api/admin/check', { headers: { 'x-admin-key': key } });
    if (r.ok) {
      sessionStorage.setItem(KEY_STORE, key);
      setAuthed(true);
      setMsg('');
    } else setMsg('관리자 키가 올바르지 않습니다.');
  };

  const call = async (url: string, init: RequestInit) => {
    const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), 'x-admin-key': key } });
    const body = await r.json();
    if (!r.ok) return setMsg(body.error ?? '오류');
    setList(body);
    setMsg('저장했습니다.');
  };

  if (!authed) {
    return (
      <div className="center-screen">
        <div className="panel lobby">
          <h1>관리자</h1>
          <input type="password" placeholder="관리자 키" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
          <button className="primary" onClick={login}>
            들어가기
          </button>
          {msg && <p className="error">{msg}</p>}
          <p className="hint">기본 키는 admin 입니다. 서버 실행 시 ADMIN_KEY 환경변수로 바꾸세요.</p>
          <a className="admin-link" href="/">
            ← 게임으로
          </a>
        </div>
      </div>
    );
  }

  const groups: [string, CardInfo[]][] = [
    ['갈색 카드 (즉시 사용)', list.filter((c) => c.kind === 'card' && c.color === 'brown')],
    ['파란 카드 (장착)', list.filter((c) => c.kind === 'card' && c.color === 'blue')],
    ['캐릭터', list.filter((c) => c.kind === 'character')],
    ['역할 카드', list.filter((c) => c.kind === 'role')],
    ['카드 뒷면', list.filter((c) => c.kind === 'back')],
  ];
  const total = list.reduce((n, c) => n + (c.count ?? 0), 0);

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>카드 관리</h1>
        <span className="hint">
          카드 {total}장 · 이미지는 카드 비율 2:3 (예: 400×600) 권장, 5MB 이하 PNG/JPG/WEBP/GIF/SVG
        </span>
        {msg && <span className="toast">{msg}</span>}
        <a href="/">← 게임으로</a>
      </header>
      {groups.map(([title, items]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className="admin-grid">
            {items.map((c) => (
              <AdminCard key={c.key} c={c} call={call} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AdminCard({ c, call }: { c: CardInfo; call: (url: string, init: RequestInit) => Promise<void> }) {
  const [name, setName] = useState(c.name);
  const [desc, setDesc] = useState(c.description);
  const dirty = name !== c.name || desc !== c.description;

  const upload = (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    call(`/api/cards/${c.key}/image`, { method: 'POST', body: fd });
  };

  return (
    <div
      className="admin-card"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) upload(f);
      }}
    >
      <CardView imageKey={c.key} size="lg" />
      <div className="admin-fields">
        <div className="hint">
          {c.key}
          {c.count !== undefined && ` · ${c.count}장`}
          {c.hp !== undefined && ` · 체력 ${c.hp}`}
        </div>
        <input value={name} placeholder={c.defaultName} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <textarea value={desc} placeholder={c.defaultDescription} rows={3} maxLength={200} onChange={(e) => setDesc(e.target.value)} />
        <div className="row wrap">
          <button
            className="primary"
            disabled={!dirty}
            onClick={() => call(`/api/cards/${c.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: desc }) })}
          >
            저장
          </button>
          <label className="button">
            이미지 선택
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {c.image && <button onClick={() => call(`/api/cards/${c.key}/image`, { method: 'DELETE' })}>이미지 삭제</button>}
        </div>
        <div className="hint">이미지를 이 칸에 끌어다 놓아도 됩니다.</div>
      </div>
    </div>
  );
}
