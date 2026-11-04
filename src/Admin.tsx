import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { get, ref, remove, set, update } from 'firebase/database';
import type { CardInfo } from '../shared/protocol';
import CardView from './CardView';
import { useCardConfig } from './cardConfig';
import { ADMIN_EMAILS, auth, db, serverNow } from './firebase';

const isAdmin = (u: User | null) => !!u?.email && u.emailVerified && ADMIN_EMAILS.includes(u.email);

/** 이미지를 카드 비율에 맞게 줄이고 WEBP 로 압축한 data URL (DB 저장용) */
async function shrinkImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있습니다.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.'));
      i.src = url;
    });
    const scale = Math.min(1, 400 / img.naturalWidth, 600 / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const data = canvas.toDataURL('image/webp', q);
      if (data.length < 1_400_000) return data;
    }
    throw new Error('이미지가 너무 큽니다.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Admin() {
  const { list } = useCardConfig();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [msg, setMsg] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((x) => (x === m ? '' : x)), 3000);
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      setMsg('로그인 실패: ' + String((e as Error).message ?? e).slice(0, 100));
    }
  };

  /** 하루 넘게 지난 방 정리 (무료 저장 용량 관리) */
  const cleanRooms = async () => {
    try {
      const idx = (await get(ref(db, 'roomIndex'))).val() ?? {};
      const old = Object.entries(idx).filter(([, t]) => serverNow() - Number(t) > 24 * 3600 * 1000);
      for (const [code] of old) {
        await remove(ref(db, `rooms/${code}`));
        await remove(ref(db, `roomIndex/${code}`));
      }
      flash(`오래된 방 ${old.length}개를 정리했습니다.`);
    } catch (e) {
      setMsg('정리 실패: ' + String((e as Error).message ?? e).slice(0, 100));
    }
  };

  if (!isAdmin(user)) {
    return (
      <div className="center-screen">
        <div className="panel lobby">
          <h1>관리자</h1>
          {user && !user.isAnonymous && <p className="error">{user.email} 계정은 관리자가 아닙니다.</p>}
          <button className="primary" onClick={login}>
            Google 계정으로 로그인
          </button>
          {user && !user.isAnonymous && <button onClick={() => signOut(auth)}>로그아웃</button>}
          {msg && <p className="error">{msg}</p>}
          <p className="hint">지정된 관리자 Google 계정만 카드 설정을 바꿀 수 있습니다.</p>
          <a className="admin-link" href="#/">
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
        <span className="hint">카드 {total}장 · 이미지는 자동으로 400×600 이하로 줄여 저장됩니다</span>
        {msg && <span className="toast">{msg}</span>}
        <button onClick={cleanRooms}>오래된 방 정리</button>
        <button onClick={() => signOut(auth)}>로그아웃 ({user!.email})</button>
        <a href="#/">← 게임으로</a>
      </header>
      {groups.map(([title, items]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className="admin-grid">
            {items.map((c) => (
              <AdminCard key={c.key} c={c} flash={flash} onError={setMsg} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AdminCard({ c, flash, onError }: { c: CardInfo; flash: (m: string) => void; onError: (m: string) => void }) {
  const [name, setName] = useState(c.name);
  const [desc, setDesc] = useState(c.description);
  const [busy, setBusy] = useState(false);
  const dirty = name !== c.name || desc !== c.description;
  const path = `config/cards/${c.key}`;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      flash(ok);
    } catch (e) {
      onError('실패: ' + String((e as Error).message ?? e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File) => run(async () => set(ref(db, `${path}/image`), await shrinkImage(file)), `${c.name} 이미지를 저장했습니다.`);

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
          <button className="primary" disabled={!dirty || busy} onClick={() => run(() => update(ref(db, path), { name, description: desc }), '저장했습니다.')}>
            저장
          </button>
          <label className="button">
            {busy ? '저장 중…' : '이미지 선택'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {c.image && (
            <button disabled={busy} onClick={() => run(() => remove(ref(db, `${path}/image`)), '이미지를 삭제했습니다.')}>
              이미지 삭제
            </button>
          )}
        </div>
        <div className="hint">이미지를 이 칸에 끌어다 놓아도 됩니다.</div>
      </div>
    </div>
  );
}
