import { useEffect, useRef, useState } from 'react';
import { CARD_DEF_MAP, CardType, isWeapon } from '../shared/cards';
import { barrelCount, canAnswerAs, distance, PlayerView, PublicPlayer, weaponRange } from '../shared/engine';
import type { ChatMessage, RoomInfo } from '../shared/protocol';
import Chat from './Chat';
import FxLayer from './Fx';
import CardView from './CardView';
import { useCardConfig } from './cardConfig';
import { sendAction, socket } from './socket';

const ROLE_KO = { sheriff: '보안관', deputy: '부관', outlaw: '무법자', renegade: '배신자' } as const;
const WINNER_KO = { law: '보안관 팀 승리!', outlaws: '무법자 팀 승리!', renegade: '배신자 승리!' } as const;

type Targeting = { cardId: string; kind: 'player' | 'playerCard'; type: CardType } | { kind: 'banditDraw' } | null;
/** 손패에서 여러 장 고르는 모드: 턴 끝 버리기 / 약초꾼 능력 */
type MultiSelect = 'discard' | 'herb' | null;

export default function Game({ view, room, chat, onLeave }: { view: PlayerView; room: RoomInfo; chat: ChatMessage[]; onLeave: () => void }) {
  const { cards, renderTokens } = useCardConfig();
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [picker, setPicker] = useState<{ cardId: string; target: PublicPlayer } | null>(null);
  /** 자세히 보기 중인 플레이어 */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [herbMode, setHerbMode] = useState(false);
  const [scoutSel, setScoutSel] = useState<string[]>([]);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // 제한 시간: 서버가 보낸 남은 시간으로 로컬 종료 시각 계산 (시계 차이 무시)
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setEndsAt(room.deadline ? Date.now() + room.deadline.remainingMs : null);
  }, [room]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = (id: string) => {
    const d = room.deadline;
    const mine = d && (d.playerId === id || (d.playerId === '*' && view.players.find((p) => p.id === id)?.picking));
    return mine && endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : undefined;
  };
  const mySeconds = secondsLeft(view.me);

  const me = view.players.find((p) => p.id === view.me)!;
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const cardName = (t: CardType) => cards[t]?.name ?? t;
  const charName = (p: PublicPlayer) => cards[`char-${p.character}`]?.name ?? p.character;
  const pend = view.pending;
  const isMyTurn = view.turnPlayerId === me.id && me.alive;
  const myTurn = isMyTurn && view.phase === 'play' && !pend;
  const drawing = isMyTurn && view.phase === 'draw' && !pend;
  const discarding = isMyTurn && view.phase === 'discard';
  const discardNeed = view.myHand.length - me.hp;
  const multi: MultiSelect = herbMode ? 'herb' : discarding ? 'discard' : null;
  const canHerb = me.character === 'herbalist' && me.alive && !view.winner && me.hp < me.maxHp && view.myHand.length >= 2;

  // 내가 응답해야 하는 상황: 필요한 카드 종류
  let need: CardType | null = null;
  if (pend?.kind === 'shot' && pend.targetId === me.id) need = 'dodge';
  if (pend?.kind === 'raid' && pend.targetId === me.id) need = 'shot';
  if (pend?.kind === 'duel' && pend.responderId === me.id) need = 'shot';
  const answers = (t: CardType) => !!need && canAnswerAs(me, t, need);
  /** 내 턴에 낼 때의 실제 효과 (쌍권총: 회피 → 사격) */
  const playAs = (t: CardType): CardType => (t === 'dodge' && me.character === 'twinguns' ? 'shot' : t);

  useEffect(() => {
    setTargeting(null);
    setPicker(null);
    setSelected([]);
    setHerbMode(false);
    setScoutSel([]);
  }, [view.turnPlayerId, view.phase, !!pend]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view.log.length]);

  const act = async (a: Parameters<typeof sendAction>[0]) => {
    const res = await sendAction(a);
    setError(res.ok ? '' : res.error ?? '오류');
    setTargeting(null);
    setPicker(null);
    if (res.ok) {
      setSelected([]);
      setHerbMode(false);
    }
  };

  const onHandClick = (cardId: string, type: CardType) => {
    if (multi) {
      setSelected((s) => (s.includes(cardId) ? s.filter((x) => x !== cardId) : [...s, cardId]));
      return;
    }
    if (need) {
      if (answers(type)) act({ type: 'respond', cardId });
      return;
    }
    if (!myTurn) return;
    if (targeting && 'cardId' in targeting && targeting.cardId === cardId) return setTargeting(null);
    const eff = playAs(type);
    const def = CARD_DEF_MAP[eff];
    if (def.target === 'none') act({ type: 'play', cardId });
    else setTargeting({ cardId, kind: def.target, type: eff });
  };

  const onSeatClick = (p: PublicPlayer) => {
    // 대상 고르는 중이 아니면 자세히 보기
    if (!targeting) return setDetailId(p.id);
    if (!p.alive || p.id === me.id) return;
    if (targeting.kind === 'banditDraw') {
      if (p.handCount > 0) act({ type: 'drawChoice', source: p.id });
      return;
    }
    if (targeting.kind === 'player') act({ type: 'play', cardId: targeting.cardId, targetId: p.id });
    else setPicker({ cardId: targeting.cardId, target: p });
  };

  // 나를 기준으로 시계 방향 좌석 순서
  const myIdx = view.players.findIndex((p) => p.id === me.id);
  const others = [...view.players.slice(myIdx + 1), ...view.players.slice(0, myIdx)];
  const range = weaponRange(me);

  /** 연결 상태 표시 (사람만) */
  const seatStatus = (id: string): string | undefined => {
    const rp = room.players.find((x) => x.id === id);
    if (!rp || rp.isBot || rp.connected) return undefined;
    return rp.proxied ? '🤖 봇이 대신 플레이 중' : '📴 연결 끊김 — 잠시 후 봇이 대신합니다';
  };

  const canTargetSeat = (p: PublicPlayer, d: number) => {
    if (!targeting || !p.alive) return false;
    if (targeting.kind === 'banditDraw') return p.handCount > 0;
    if (targeting.type === 'shot') return d <= range;
    if (targeting.type === 'steal') return d <= 1;
    if (targeting.type === 'jail') return p.role !== 'sheriff';
    return true;
  };

  // 테이블 둘레 좌석 배치: 나는 맨 아래, 다음 차례(시계 방향)는 내 왼쪽부터
  const ordered = [me, ...others];
  const seatPos = (k: number) => {
    const theta = Math.PI / 2 + (k * 2 * Math.PI) / ordered.length;
    return { left: `${50 + 38 * Math.cos(theta)}%`, top: `${51 + 33 * Math.sin(theta)}%` };
  };

  return (
    <div className="game">
      <div className="table-area">
        <div className="felt-wrap" ref={tableRef}>
          <div className="felt" />
          {ordered.map((p, k) => {
            const isMe = p.id === me.id;
            const d = !isMe && p.alive && me.alive ? distance(view.players, me.id, p.id) : 0;
            return (
              <div key={p.id} data-pid={p.id} className={isMe ? 'seat-pos seat-pos-me' : 'seat-pos'} style={seatPos(k)}>
                <Seat
                  p={p}
                  turn={view.turnPlayerId === p.id}
                  isMe={isMe}
                  dist={isMe || !me.alive ? undefined : d}
                  inRange={!isMe && me.alive && p.alive && d <= range}
                  canTarget={!isMe && canTargetSeat(p, d)}
                  status={isMe ? undefined : seatStatus(p.id)}
                  seconds={secondsLeft(p.id)}
                  onClick={() => onSeatClick(p)}
                />
              </div>
            );
          })}

          <div className="table-center">
            <div className="piles">
              <div className="pile">
                <CardView imageKey="back" size="md" />
                <span>덱 {view.deckCount}</span>
              </div>
              <div className="pile">
                {view.discardTop ? <CardView card={view.discardTop} size="md" /> : <div className="card card-md empty" />}
                <span>버린 카드</span>
              </div>
            </div>
            <div className="prompt">
              {view.winner ? (
                <div className="winner">
                  🏆 {WINNER_KO[view.winner]}
                  {room.hostId === me.id && <button onClick={() => socket.emit('restartToLobby')}>대기실로</button>}
                  <button onClick={onLeave}>나가기</button>
                </div>
              ) : (
                <div className="prompt-line">
                  <PromptText />
                  {mySeconds !== undefined && <Timer seconds={mySeconds} kind={room.deadline!.kind} />}
                </div>
              )}
              {drawing && <DrawChoice />}
              {error && <div className="error">{error}</div>}
            </div>
          </div>

          <FxLayer events={view.events} players={view.players} containerRef={tableRef} />

          {view.phase === 'pickCharacter' && (
            <div className="table-overlay">
              <div className="char-pick">
                {view.myOffers.length ? (
                  <>
                    <h2>캐릭터를 고르세요</h2>
                    <div className="row wrap center-row">
                      {view.myOffers.map((id) => {
                        const info = cards[`char-${id}`];
                        return (
                          <div key={id} className="char-option" onClick={() => act({ type: 'pickCharacter', characterId: id })}>
                            <CardView imageKey={`char-${id}`} size="xl" />
                            <div className="char-option-text">
                              <b>{info?.name ?? id}</b>
                              <span className="hp-label">
                                체력 {info?.hp}
                                {me.role === 'sheriff' && ' (+1 보안관)'}
                              </span>
                              <p>{info?.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <h2>다른 플레이어가 고르는 중… ({view.players.filter((p) => p.picking).length}명 남음)</h2>
                )}
              </div>
            </div>
          )}

          {pend?.kind === 'store' && (
            <div className="table-overlay">
              <div className="store">
                <b>{cardName('store')}</b> — {pend.order[0] === me.id ? '가져갈 카드를 고르세요' : `${nameOf(pend.order[0])}이(가) 고르는 중`}
                <div className="row wrap center-row">
                  {pend.cards.map((c) => (
                    <CardView key={c.id} card={c} size="xl" highlight={pend.order[0] === me.id} onClick={pend.order[0] === me.id ? () => act({ type: 'pick', cardId: c.id }) : undefined} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="hand-area">
          <div className="hand">
            {view.myHand.map((c) => {
              const usable = multi ? true : need ? answers(c.type) : myTurn;
              return (
                <CardView
                  key={c.id}
                  card={c}
                  size="xl"
                  selected={(targeting && 'cardId' in targeting && targeting.cardId === c.id) || selected.includes(c.id)}
                  highlight={answers(c.type)}
                  dim={!usable}
                  onClick={() => onHandClick(c.id, c.type)}
                />
              );
            })}
            {view.myHand.length === 0 && <span className="hint">손패 없음</span>}
          </div>
          <div className="actions">
            {myTurn && !herbMode && (
              <button className="primary" onClick={() => act({ type: 'endTurn' })}>
                턴 종료
              </button>
            )}
            {targeting && <button onClick={() => setTargeting(null)}>취소</button>}
            {discarding && !herbMode && (
              <button className="primary" disabled={selected.length !== discardNeed} onClick={() => act({ type: 'discard', cardIds: selected })}>
                {discardNeed}장 버리기 ({selected.length}/{discardNeed})
              </button>
            )}
            {pend?.kind === 'shot' && need && !herbMode && pend.barrelUsed < barrelCount(me) && (
              <button onClick={() => act({ type: 'useBarrel' })}>
                {cardName('barrel')} 판정 ({barrelCount(me) - pend.barrelUsed}회)
              </button>
            )}
            {need && !herbMode && (
              <button className="danger" onClick={() => act({ type: 'respond' })}>
                피해 받기
              </button>
            )}
            {canHerb && !herbMode && (
              <button
                onClick={() => {
                  setSelected([]);
                  setHerbMode(true);
                }}
              >
                🌿 능력: 2장 버리고 회복
              </button>
            )}
            {herbMode && (
              <>
                <button className="primary" disabled={selected.length !== 2} onClick={() => act({ type: 'ability', cardIds: selected })}>
                  2장 버리고 회복 ({selected.length}/2)
                </button>
                <button
                  onClick={() => {
                    setHerbMode(false);
                    setSelected([]);
                  }}
                >
                  취소
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <aside className="side">
        <div className="side-head">
          <span>방 {room.code}</span>
          <button onClick={onLeave}>나가기</button>
        </div>
        <div className="log" ref={logRef}>
          {view.log.map((l, i) => (
            <div key={i} className={l.startsWith('──') ? 'log-turn' : ''}>
              {renderTokens(l)}
            </div>
          ))}
        </div>
        <Chat messages={chat} me={me.id} className="game-chat" />
      </aside>

      {detailId && <PlayerDetail />}

      {picker && (
        <div className="modal" onClick={() => setPicker(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h3>{picker.target.name}의 어떤 카드?</h3>
            <div className="row wrap">
              {picker.target.handCount > 0 && (
                <div className="pick-hand" onClick={() => act({ type: 'play', cardId: picker.cardId, targetId: picker.target.id, targetCardId: 'hand' })}>
                  <CardView imageKey="back" size="xl" />
                  <span>손패에서 무작위 ({picker.target.handCount}장)</span>
                </div>
              )}
              {picker.target.inPlay.map((c) => (
                <CardView key={c.id} card={c} size="xl" highlight onClick={() => act({ type: 'play', cardId: picker.cardId, targetId: picker.target.id, targetCardId: c.id })} />
              ))}
            </div>
            <button onClick={() => setPicker(null)}>취소</button>
          </div>
        </div>
      )}
    </div>
  );

  /** 뽑기 단계에서 선택이 필요한 캐릭터용 UI */
  function DrawChoice() {
    if (me.character === 'scout') {
      return (
        <div className="draw-choice">
          <div className="row">
            {view.drawCards.map((c) => (
              <CardView
                key={c.id}
                card={c}
                size="lg"
                selected={scoutSel.includes(c.id)}
                onClick={() => setScoutSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : s.length < 2 ? [...s, c.id] : s))}
              />
            ))}
          </div>
          <button className="primary" disabled={scoutSel.length !== 2} onClick={() => act({ type: 'drawChoice', cardIds: scoutSel })}>
            이 2장 가져가기
          </button>
        </div>
      );
    }
    if (me.character === 'junker') {
      return (
        <div className="row wrap">
          <button className="primary" onClick={() => act({ type: 'drawChoice', source: 'discard' })}>
            버린 카드 맨 위 + 덱 1장
          </button>
          <button onClick={() => act({ type: 'drawChoice', source: 'deck' })}>덱에서 2장</button>
        </div>
      );
    }
    if (me.character === 'bandit') {
      return (
        <div className="row wrap">
          <button className={targeting?.kind === 'banditDraw' ? 'primary' : ''} onClick={() => setTargeting(targeting ? null : { kind: 'banditDraw' })}>
            {targeting?.kind === 'banditDraw' ? '빼앗을 플레이어를 클릭하세요' : '다른 플레이어 손패에서 1장 + 덱 1장'}
          </button>
          <button onClick={() => act({ type: 'drawChoice', source: 'deck' })}>덱에서 2장</button>
        </div>
      );
    }
    return null;
  }

  /** 플레이어 자세히 보기: 캐릭터·체력·장착 카드 크게, 손패는 본인만 */
  function PlayerDetail() {
    const p = view.players.find((x) => x.id === detailId);
    if (!p) return null;
    const isMe = p.id === me.id;
    const ch = p.character ? cards[`char-${p.character}`] : undefined;
    const d = !isMe && p.alive && me.alive ? distance(view.players, me.id, p.id) : 0;
    const weapon = p.inPlay.find((c) => isWeapon(c.type));
    const pr = weaponRange(p);
    return (
      <div className="modal" onClick={() => setDetailId(null)}>
        <div className="panel detail" onClick={(e) => e.stopPropagation()}>
          <div className="detail-head">
            <h2>
              {p.name}
              {isMe && ' (나)'}
            </h2>
            {p.role ? <span className={`role role-${p.role}`}>{ROLE_KO[p.role]}</span> : <span className="role role-unknown">역할 비공개</span>}
            {!p.alive && <span className="dead-label">💀 탈락</span>}
            <button onClick={() => setDetailId(null)}>닫기</button>
          </div>
          <div className="detail-main">
            <CardView imageKey={p.character ? `char-${p.character}` : 'back'} size="xl" />
            <div className="detail-info">
              <b className="detail-char">{ch?.name ?? (p.picking ? '캐릭터 고르는 중…' : '')}</b>
              <p>{ch?.description}</p>
              <div className="hp big-hp">
                {Array.from({ length: p.maxHp }, (_, i) => (
                  <span key={i} className={i < p.hp ? 'bullet full' : 'bullet'} />
                ))}
                <span className="hp-text">
                  체력 {p.hp}/{p.maxHp}
                </span>
              </div>
              <div className="detail-meta">
                <span>사거리 {pr}{weapon ? ` (${cards[weapon.type]?.name ?? weapon.type})` : ' (기본)'}</span>
                {!isMe && p.alive && <span className={d <= range ? 'in-range' : ''}>나와의 거리 {d}{d <= range ? ' · 내 사거리 안 🎯' : ''}</span>}
              </div>
            </div>
          </div>
          <h3>장착한 카드 ({p.inPlay.length})</h3>
          <div className="row wrap">
            {p.inPlay.length ? p.inPlay.map((c) => <CardView key={c.id} card={c} size="xl" />) : <span className="hint">없음</span>}
          </div>
          <h3>손패 ({isMe ? view.myHand.length : p.handCount}장)</h3>
          <div className="row wrap">
            {isMe
              ? view.myHand.map((c) => <CardView key={c.id} card={c} size="lg" />)
              : Array.from({ length: p.handCount }, (_, i) => <CardView key={i} imageKey="back" size="md" />)}
          </div>
          {!isMe && <p className="hint">손패 내용은 규칙상 본인만 볼 수 있습니다. 카드에 마우스를 올리거나 오른쪽 클릭하면 크게 볼 수 있어요.</p>}
        </div>
      </div>
    );
  }

  function PromptText() {
    if (view.phase === 'pickCharacter')
      return view.myOffers.length ? <b className="alert">캐릭터 2명 중 1명을 고르세요.</b> : <span>모두 고를 때까지 기다리는 중…</span>;
    if (!me.alive) return <span>탈락했습니다. 관전 중…</span>;
    if (herbMode) return <b className="alert">버릴 카드 2장을 고르세요.</b>;
    if (pend?.kind === 'shot') {
      if (pend.targetId !== me.id) return <span>{nameOf(pend.targetId)}의 응답을 기다리는 중…</span>;
      return (
        <b className="alert">
          {nameOf(pend.attackerId)}의 사격! {cardName('dodge')}
          {pend.needed > 1 ? ` ${pend.needed}장` : ''}을 내거나 피해를 받으세요.
        </b>
      );
    }
    if (pend?.kind === 'raid') {
      return pend.targetId === me.id ? (
        <b className="alert">
          {cardName('raid')}! {cardName('shot')}을 버리거나 피해를 받으세요.
        </b>
      ) : (
        <span>{nameOf(pend.targetId)}의 응답을 기다리는 중…</span>
      );
    }
    if (pend?.kind === 'duel') {
      return pend.responderId === me.id ? (
        <b className="alert">결투! {cardName('shot')}을 내거나 포기(피해)하세요.</b>
      ) : (
        <span>결투 중: {nameOf(pend.responderId)}의 차례</span>
      );
    }
    if (pend?.kind === 'store') return <span>{cardName('store')} 진행 중</span>;
    if (drawing) return <b className="alert">{charName(me)} 능력 — 카드를 어떻게 뽑을지 고르세요.</b>;
    if (view.phase === 'draw') return <span>{nameOf(view.turnPlayerId)}이(가) 뽑을 카드를 고르는 중…</span>;
    if (discarding) return <b className="alert">손패가 체력보다 많습니다. {discardNeed}장을 골라 버리세요.</b>;
    if (targeting) return <b className="alert">{targeting.kind === 'player' ? '대상 플레이어를 클릭하세요.' : '카드를 가져올 플레이어를 클릭하세요.'}</b>;
    if (myTurn) return <b>내 차례입니다. 카드를 내거나 턴을 종료하세요. (사거리 {range})</b>;
    return <span>{nameOf(view.turnPlayerId)}의 차례</span>;
  }
}

function Seat({
  p,
  turn,
  dist,
  inRange,
  canTarget,
  isMe,
  status,
  seconds,
  onClick,
}: {
  p: PublicPlayer;
  turn: boolean;
  dist?: number;
  inRange?: boolean;
  canTarget?: boolean;
  isMe?: boolean;
  status?: string;
  seconds?: number;
  onClick?: () => void;
}) {
  const { cards } = useCardConfig();
  const ch = p.character ? cards[`char-${p.character}`] : undefined;
  const weapon = p.inPlay.find((c) => isWeapon(c.type));
  const others = p.inPlay.filter((c) => c !== weapon);
  const cardSize = isMe ? 'sm' : 'xs';
  const cls = ['seat', turn && 'turn', !p.alive && 'dead', canTarget && 'targetable', isMe && 'me'].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick}>
      {dist !== undefined && p.alive && (
        <div className={inRange ? 'dist-tag in-range' : 'dist-tag'} title={inRange ? '내 사거리 안' : '내 사거리 밖'}>
          거리 {dist}
          {inRange && ' 🎯'}
        </div>
      )}
      <div className="seat-head">
        <span className="seat-name">
          {p.name}
          {isMe && ' (나)'}
        </span>
        {seconds !== undefined && <span className={seconds <= 5 ? 'clock urgent' : 'clock'}>⏱ {seconds}</span>}
        {p.role ? <span className={`role role-${p.role}`}>{ROLE_KO[p.role]}</span> : <span className="role role-unknown">?</span>}
      </div>
      <div className="seat-body">
        <CardView imageKey={p.character ? `char-${p.character}` : 'back'} size="sm" title={ch ? `${ch.name} (체력 ${ch.hp})
${ch.description}` : ''} />
        <div className="seat-info">
          <div className="char-name" title={ch?.description}>
            {p.character ? ch?.name ?? p.character : p.picking ? '캐릭터 고르는 중…' : ''}
          </div>
          <div className="hp-row">
          <div className="hp" title={`체력 ${p.hp}/${p.maxHp}`}>
            {Array.from({ length: p.maxHp }, (_, i) => (
              <span key={i} className={i < p.hp ? 'bullet full' : 'bullet'} />
            ))}
          </div>
          {!isMe && p.alive && (
            <div className="hand-backs" title={`손패 ${p.handCount}장`}>
              {Array.from({ length: Math.min(p.handCount, 8) }, (_, i) => (
                <span key={i} className="mini-back" />
              ))}
              <span className="hand-count">{p.handCount}</span>
            </div>
          )}
          </div>
          {!p.alive && <span className="dead-label">💀 탈락</span>}
          {p.alive && (
            <div className="in-play">
              {weapon ? (
                <CardView card={weapon} size={cardSize} />
              ) : (
                <div className={`card card-${cardSize} weapon-slot`} title="무기 없음: 기본 사거리 1">
                  기본
                  <br />
                  사거리 1
                </div>
              )}
              {others.map((c) => (
                <CardView key={c.id} card={c} size={cardSize} />
              ))}
            </div>
          )}
        </div>
      </div>
      {status && <div className="seat-status">{status}</div>}
      {isMe && ch && <div className="char-desc">{ch.description}</div>}
    </div>
  );
}

function Timer({ seconds, kind }: { seconds: number; kind: 'turn' | 'response' }) {
  return (
    <span className={seconds <= 5 ? 'timer urgent' : 'timer'} title={kind === 'turn' ? '시간이 다 되면 턴이 자동으로 끝납니다' : '시간이 다 되면 자동으로 응답합니다'}>
      ⏱ {seconds}초
    </span>
  );
}
