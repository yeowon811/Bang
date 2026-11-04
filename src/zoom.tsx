// 카드 확대 보기
// - 마우스: 카드 위에 잠시 올려두면 화면 왼쪽 위에 큰 미리보기
// - 오른쪽 클릭 또는 길게 누르기(모바일): 확대 창 (클릭하면 닫힘)
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import type { Card } from '../shared/cards';

export type ZoomTarget = { card?: Card; imageKey?: string };

interface Ctx {
  hover: (t: ZoomTarget | null) => void;
  open: (t: ZoomTarget) => void;
}

const ZoomContext = createContext<Ctx>({ hover: () => {}, open: () => {} });
export const useZoom = () => useContext(ZoomContext);

export function ZoomProvider({ children, render }: { children: ReactNode; render: (t: ZoomTarget, mode: 'hover' | 'modal', close: () => void) => ReactNode }) {
  const [hovered, setHovered] = useState<ZoomTarget | null>(null);
  const [opened, setOpened] = useState<ZoomTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hover = useCallback((t: ZoomTarget | null) => {
    if (timer.current) clearTimeout(timer.current);
    if (!t) return setHovered(null);
    timer.current = setTimeout(() => setHovered(t), 250);
  }, []);
  const open = useCallback((t: ZoomTarget) => {
    if (timer.current) clearTimeout(timer.current);
    setHovered(null);
    setOpened(t);
  }, []);

  return (
    <ZoomContext.Provider value={{ hover, open }}>
      {children}
      {hovered && !opened && render(hovered, 'hover', () => setHovered(null))}
      {opened && render(opened, 'modal', () => setOpened(null))}
    </ZoomContext.Provider>
  );
}
