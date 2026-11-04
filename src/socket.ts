import { io } from 'socket.io-client';
import type { Action } from '../shared/engine';

export const socket = io();

export type AckRes = { ok: boolean; error?: string; code?: string; playerId?: string };

export function emit(event: string, payload?: unknown): Promise<AckRes> {
  return new Promise((resolve) => socket.emit(event, payload, (res: AckRes) => resolve(res)));
}

export const sendAction = (a: Action) => emit('action', a);
