// 봇끼리만 게임을 돌려 항상 끝나는지, 막히지 않는지 확인
import { applyAction, createGame, isOver } from './engine';
import { BotMemory, runBotStep, whoActs } from './bot';

let finished = 0;
let totalSteps = 0;
const winners: Record<string, number> = {};
const GAMES = 1500;
for (let g = 0; g < GAMES; g++) {
  const n = 4 + (g % 4);
  const s = createGame(Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}` })));
  const mem: BotMemory = {};
  let step = 0;
  for (; step < 3000 && !isOver(s); step++) {
    const pid = whoActs(s)!;
    const a = runBotStep(s, mem, pid, applyAction);
    if (!a) throw new Error(`봇이 할 행동이 없음: phase=${s.phase} pending=${JSON.stringify(s.pending)}`);
  }
  totalSteps += step;
  if (isOver(s)) {
    finished++;
    winners[s.winner!] = (winners[s.winner!] ?? 0) + 1;
  }
}
console.log(`✅ 봇 전용 ${GAMES}판: 종료 ${finished}판, 평균 ${Math.round(totalSteps / GAMES)}행동, 승리 분포`, winners);
if (finished < GAMES) throw new Error(`❌ 끝나지 않은 판 ${GAMES - finished}`);
