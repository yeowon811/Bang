import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { get, ref, remove, set, update } from 'firebase/database';
import type { CardInfo } from '../shared/protocol';
import { IMAGE_KEYS } from '../shared/cards';
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

/**
 * 이전(서버 버전) 데이터 가져오기: card-config.json 과 uploads 폴더의 이미지들을 한 번에 선택하면
 * 이름·설명·이미지를 Firebase 로 옮긴다.
 */
async function importLegacy(files: File[], onProgress: (msg: string) => void): Promise<string> {
  const json = files.find((f) => f.name.endsWith('.json'));
  if (!json) throw new Error('card-config.json 파일을 이미지와 함께 선택하세요.');
  const cfg: Record<string, { name?: string; description?: string; image?: string }> = JSON.parse(await json.text());
  const images = new Map(files.filter((f) => f.type.startsWith('image/')).map((f) => [f.name, f]));
  const entries = Object.entries(cfg).filter(([k]) => (IMAGE_KEYS as string[]).includes(k));
  let names = 0;
  let imgs = 0;
  const missing: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [key, v] = entries[i];
    onProgress(`가져오는 중… ${i + 1}/${entries.length} (${key})`);
    const patch: Record<string, string> = {};
    if (v.name) patch.name = v.name;
    if (v.description) patch.description = v.description;
    if (v.image) {
      const file = images.get(v.image);
      if (file) patch.image = await shrinkImage(file);
      else missing.push(v.image);
    }
    if (!Object.keys(patch).length) continue;
    await update(ref(db, `config/cards/${key}`), patch);
    if (patch.name || patch.description) names++;
    if (patch.image) imgs++;
  }
  return `가져오기 완료: 이름/설명 ${names}개, 이미지 ${imgs}개${missing.length ? ` (찾지 못한 이미지 ${missing.length}개)` : ''}`;
}

export default function Admin() {
  const { list } = useCardConfig();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [msg, setMsg] = useState('');
  const [importing, setImporting] = useState('');

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
        <label className="button" title="card-config.json 과 이미지 파일들을 함께 선택">
          {importing || '이전 데이터 가져오기'}
          <input
            type="file"
            multiple
            accept=".json,image/*"
            hidden
            disabled={!!importing}
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (!files.length) return;
              try {
                const result = await importLegacy(files, setImporting);
                flash(result);
              } catch (err) {
                setMsg('가져오기 실패: ' + String((err as Error).message ?? err).slice(0, 120));
              } finally {
                setImporting('');
              }
            }}
          />
        </label>
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
