import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { CardInfo } from '../shared/protocol';
import { socket } from './socket';

interface Ctx {
  cards: Record<string, CardInfo>;
  list: CardInfo[];
  setList: (l: CardInfo[]) => void;
  /** 로그의 [[type]] 토큰을 카드 이름으로 */
  renderTokens: (text: string) => string;
}

const CardConfigContext = createContext<Ctx>(null!);

export function CardConfigProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<CardInfo[]>([]);

  const load = useCallback(() => {
    fetch('/api/cards').then((r) => r.json()).then(setList).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    socket.on('cardsUpdated', load);
    return () => void socket.off('cardsUpdated', load);
  }, [load]);

  const cards = Object.fromEntries(list.map((c) => [c.key, c]));
  const renderTokens = (text: string) => text.replace(/\[\[([\w-]+)\]\]/g, (_, k) => cards[k]?.name ?? k);

  return <CardConfigContext.Provider value={{ cards, list, setList, renderTokens }}>{children}</CardConfigContext.Provider>;
}

export const useCardConfig = () => useContext(CardConfigContext);
