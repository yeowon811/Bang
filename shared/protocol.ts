// 서버 ↔ 클라이언트 공용 타입

export interface CardInfo {
  key: string; // CardType | role-xxx | back
  kind: 'card' | 'role' | 'character' | 'back';
  color?: 'brown' | 'blue';
  count?: number;
  hp?: number; // 캐릭터 기본 체력
  name: string;
  description: string;
  image: string | null;
  defaultName: string;
  defaultDescription: string;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  started: boolean;
  players: { id: string; name: string; connected: boolean; isBot: boolean; proxied: boolean }[];
  /** 지금 행동할 사람의 남은 시간 (사람 플레이어만, playerId '*' = 캐릭터 고르는 모두) */
  deadline: { playerId: string; kind: 'turn' | 'response'; remainingMs: number } | null;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export const CHAT_MAX_LENGTH = 200;
