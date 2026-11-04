// 게임 이벤트 애니메이션 — 서버가 보낸 공개 이벤트(view.events)를 순서대로 테이블 위에 그린다.
// 좌석 위치는 data-pid 속성이 붙은 .seat-pos 요소에서 읽는다.
import { RefObject, useEffect, useRef, useState } from 'react';
import type { CardType } from '../shared/cards';
import type { GameEvent, PublicPlayer } from '../shared/engine';
import { useCardConfig } from './cardConfig';

const ICON: Record<CardType, string> = {
  shot: '🔫', dodge: '🛡️', beer: '🍺', saloon: '🎉', stagecoach: '🐎', wellsfargo: '💰',
  steal: '🫳', sabotage: '💢', store: '🏪', raid: '🏹', duel: '⚔️', gatling: '💥',
  barrel: '🛢️', scope: '🔭', mustang: '🐴', jail: '🔒', dynamite: '🧨',
  volcanic: '🔫', schofield: '🔫', remington: '🔫', carbine: '🔫', winchester: '🔫',
};

type Pt = { x: number; y: number };
type Fx =
  | { id: number; kind: 'banner'; at: Pt; text: string; tone: 'bad' | 'good' | 'info' | 'turn' | 'plain' }
  | { id: number; kind: 'proj'; from: Pt; to: Pt; content: 'bullet' | string }
  | { id: number; kind: 'big'; at: Pt; text: string };

/** id를 뺀 Fx (유니온의 각 경우마다 Omit 적용) */
type FxInput = Fx extends infer F ? (F extends Fx ? Omit<F, 'id'> : never) : never;

const STEP_MS = 380; // 이벤트 사이 간격
const LIFE_MS = 1600; // 효과가 화면에 남는 시간

export default function FxLayer({ events, players, containerRef }: { events: GameEvent[]; players: PublicPlayer[]; containerRef: RefObject<HTMLDivElement | null> }) {
  const { cards } = useCardConfig();
  const [fx, setFx] = useState<Fx[]>([]);
  const lastSeq = useRef<number | null>(null);
  const queue = useRef<GameEvent[]>([]);
  const running = useRef(false);
  const nextId = useRef(1);
  const latest = useRef({ players, cards });
  latest.current = { players, cards };

  useEffect(() => {
    const maxSeq = events.length ? events[events.length - 1].seq : 0;
    // 처음 들어왔을 때(새로고침·재접속)는 지난 이벤트를 다시 재생하지 않는다
    if (lastSeq.current === null) {
      lastSeq.current = maxSeq;
      return;
    }
    const fresh = events.filter((e) => e.seq > lastSeq.current!);
    if (!fresh.length) return;
    lastSeq.current = maxSeq;
    queue.current.push(...fresh);
    if (!running.current) pump();
  }, [events]);

  function pump() {
    const e = queue.current.shift();
    if (!e) {
      running.current = false;
      return;
    }
    running.current = true;
    // 밀린 이벤트가 많으면 빨리 감기
    const delay = queue.current.length > 6 ? 120 : STEP_MS;
    play(e);
    setTimeout(pump, delay);
  }

  function center(): Pt {
    const c = containerRef.current;
    return c ? { x: c.clientWidth / 2, y: c.clientHeight / 2 } : { x: 0, y: 0 };
  }
  function seatEl(pid: string) {
    return containerRef.current?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(pid)}"]`) ?? null;
  }
  function seatPt(pid: string): Pt {
    const c = containerRef.current;
    const el = seatEl(pid);
    if (!c || !el) return center();
    const cr = c.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
  }
  function flash(pid: string, cls: 'fx-hit' | 'fx-heal' | 'fx-turn') {
    const seat = seatEl(pid)?.querySelector<HTMLElement>('.seat');
    if (!seat) return;
    seat.classList.remove(cls);
    void seat.offsetWidth; // 애니메이션 다시 시작
    seat.classList.add(cls);
    setTimeout(() => seat.classList.remove(cls), 900);
  }
  function add(f: FxInput, life = LIFE_MS) {
    const id = nextId.current++;
    setFx((list) => [...list, { ...f, id } as Fx]);
    setTimeout(() => setFx((list) => list.filter((x) => x.id !== id)), life);
  }

  function play(e: GameEvent) {
    const { players, cards } = latest.current;
    const name = (t: CardType) => cards[t]?.name ?? t;
    const pname = (id: string) => players.find((p) => p.id === id)?.name ?? '';
    const others = (id: string) => players.filter((p) => p.alive && p.id !== id).map((p) => p.id);

    switch (e.type) {
      case 'turn':
        flash(e.to, 'fx-turn');
        add({ kind: 'banner', at: center(), text: `${pname(e.to)}의 차례`, tone: 'turn' }, 1300);
        break;
      case 'play': {
        const eff = e.as ?? e.card;
        const from = seatPt(e.from);
        add({ kind: 'banner', at: from, text: `${ICON[e.card]} ${name(e.card)}${e.as ? ` → ${name(e.as)}` : ''}`, tone: 'plain' });
        if (eff === 'shot' && e.to) add({ kind: 'proj', from, to: seatPt(e.to), content: 'bullet' }, 700);
        else if (eff === 'gatling') for (const id of others(e.from)) add({ kind: 'proj', from, to: seatPt(id), content: 'bullet' }, 700);
        else if (eff === 'raid') for (const id of others(e.from)) add({ kind: 'proj', from, to: seatPt(id), content: '🏹' }, 700);
        else if (e.to) add({ kind: 'proj', from, to: seatPt(e.to), content: ICON[eff] }, 700);
        break;
      }
      case 'damage':
        flash(e.to, 'fx-hit');
        add({ kind: 'banner', at: seatPt(e.to), text: `💔 -${e.amount}`, tone: 'bad' });
        break;
      case 'heal':
        flash(e.to, 'fx-heal');
        add({ kind: 'banner', at: seatPt(e.to), text: `❤️ +${e.amount}`, tone: 'good' });
        break;
      case 'dodge':
        add({ kind: 'banner', at: seatPt(e.to), text: e.card === 'barrel' ? `🛢️ ${name('barrel')}로 막음!` : `💨 빗나감! (${name(e.card)})`, tone: 'info' });
        break;
      case 'barrelFail':
        add({ kind: 'banner', at: seatPt(e.to), text: `🛢️ ${name('barrel')} 실패`, tone: 'plain' });
        break;
      case 'death':
        flash(e.to, 'fx-hit');
        add({ kind: 'big', at: seatPt(e.to), text: '💀' }, 1800);
        break;
      case 'explode':
        flash(e.to, 'fx-hit');
        add({ kind: 'big', at: seatPt(e.to), text: '💥' }, 1400);
        break;
      case 'jailSkip':
        add({ kind: 'big', at: seatPt(e.to), text: '🔒' }, 1400);
        add({ kind: 'banner', at: seatPt(e.to), text: '감옥: 턴 건너뜀', tone: 'bad' });
        break;
      case 'jailEscape':
        add({ kind: 'banner', at: seatPt(e.to), text: '🔓 탈출!', tone: 'good' });
        break;
      case 'steal':
        add({ kind: 'proj', from: seatPt(e.from), to: seatPt(e.to), content: e.card ? ICON[e.card] : '🂠' }, 700);
        add({ kind: 'banner', at: seatPt(e.to), text: e.card ? `🫳 ${name(e.card)} 빼앗음` : '🫳 손패 1장 빼앗음', tone: 'info' });
        break;
      case 'discard':
        add({ kind: 'proj', from: seatPt(e.to), to: center(), content: ICON[e.card] }, 700);
        add({ kind: 'banner', at: seatPt(e.to), text: `${name(e.card)} 버려짐`, tone: 'bad' });
        break;
      case 'pick':
        add({ kind: 'proj', from: center(), to: seatPt(e.to), content: ICON[e.card] }, 700);
        break;
    }
  }

  return (
    <div className="fx-layer" aria-hidden>
      {fx.map((f) => {
        if (f.kind === 'banner')
          return (
            <div key={f.id} className={`fx-banner fx-${f.tone}`} style={{ left: f.at.x, top: f.at.y }}>
              {f.text}
            </div>
          );
        if (f.kind === 'big')
          return (
            <div key={f.id} className="fx-big" style={{ left: f.at.x, top: f.at.y }}>
              {f.text}
            </div>
          );
        const dx = f.to.x - f.from.x;
        const dy = f.to.y - f.from.y;
        const rot = `${Math.atan2(dy, dx)}rad`;
        const style = { left: f.from.x, top: f.from.y, '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': rot } as React.CSSProperties;
        return f.content === 'bullet' ? (
          <div key={f.id} className="fx-proj fx-bullet" style={style} />
        ) : (
          <div key={f.id} className="fx-proj fx-emoji" style={{ ...style, '--rot': '0rad' } as React.CSSProperties}>
            {f.content}
          </div>
        );
      })}
    </div>
  );
}
