// 카드·캐릭터·역할의 이름/설명/이미지. 기본값은 shared/ 정의, 관리자가 바꾼 값은 Firebase config/cards 에서.
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { CARD_DEFS, ROLE_DEFS } from '../shared/cards';
import { CHARACTERS } from '../shared/characters';
import type { CardInfo } from '../shared/protocol';
import { db } from './firebase';

export type CardOverride = { name?: string; description?: string; image?: string };

export function buildCardList(overrides: Record<string, CardOverride>): CardInfo[] {
  const base: Omit<CardInfo, 'name' | 'description' | 'image'>[] = [
    ...CARD_DEFS.map((d) => ({ key: d.type, kind: 'card' as const, color: d.color, count: d.count, defaultName: d.name, defaultDescription: d.description })),
    ...ROLE_DEFS.map((r) => ({ key: `role-${r.role}`, kind: 'role' as const, defaultName: r.name, defaultDescription: r.description })),
    ...CHARACTERS.map((c) => ({ key: `char-${c.id}`, kind: 'character' as const, hp: c.hp, defaultName: c.name, defaultDescription: c.description })),
    { key: 'back', kind: 'back' as const, defaultName: '카드 뒷면', defaultDescription: '' },
  ];
  return base.map((b) => ({
    ...b,
    name: overrides[b.key]?.name || b.defaultName,
    description: overrides[b.key]?.description || b.defaultDescription,
    image: overrides[b.key]?.image || null,
  }));
}

interface Ctx {
  cards: Record<string, CardInfo>;
  list: CardInfo[];
  /** 로그의 [[type]] 토큰을 카드 이름으로 */
  renderTokens: (text: string) => string;
}

const CardConfigContext = createContext<Ctx>(null!);

export function CardConfigProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, CardOverride>>({});

  useEffect(
    () =>
      onValue(
        ref(db, 'config/cards'),
        (s) => setOverrides(s.val() ?? {}),
        () => setOverrides({}),
      ),
    [],
  );

  const list = useMemo(() => buildCardList(overrides), [overrides]);
  const cards = useMemo(() => Object.fromEntries(list.map((c) => [c.key, c])), [list]);
  const renderTokens = (text: string) => text.replace(/\[\[([\w-]+)\]\]/g, (_, k) => cards[k]?.name ?? k);

  return <CardConfigContext.Provider value={{ cards, list, renderTokens }}>{children}</CardConfigContext.Provider>;
}

export const useCardConfig = () => useContext(CardConfigContext);
