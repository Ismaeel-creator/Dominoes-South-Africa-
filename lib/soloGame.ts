import type { BoardDomino, Domino, PlaySide } from '@/lib/dominoes';

export type SoloPlayer = {
  index: number;
  name: string;
  team: 'A' | 'B';
  isCpu: boolean;
};

export type SoloStatus = 'playing' | 'round_over' | 'finished';

export type SoloGame = {
  players: SoloPlayer[];
  hands: Domino[][];
  board: BoardDomino[];
  leftValue: number;
  rightValue: number;
  currentTurn: number;
  passCount: number;
  dealerIndex: number;
  round: number;
  teamAScore: number;
  teamBScore: number;
  status: SoloStatus;
  lastMessage: string;
  winner: 'A' | 'B' | null;
};

export type SoloMove = { tileId: number; side: PlaySide };

const CPU_NAMES = ['Zola · CPU', 'Thabo · CPU', 'Amahle · CPU'];

function makeDeck(): Domino[] {
  const deck: Domino[] = [];
  let id = 0;
  for (let a = 0; a <= 6; a += 1) {
    for (let b = a; b <= 6; b += 1) {
      deck.push({ id, a, b });
      id += 1;
    }
  }
  return deck;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function getSides(tile: Domino, left: number, right: number): PlaySide[] {
  const sides: PlaySide[] = [];
  if (tile.a === left || tile.b === left) sides.push('left');
  if (tile.a === right || tile.b === right) sides.push('right');
  return sides;
}

export function soloPipTotal(hand: Domino[]): number {
  return hand.reduce((sum, tile) => sum + tile.a + tile.b, 0);
}

export function startSoloGame(
  playerName: string,
  previous?: Pick<SoloGame, 'teamAScore' | 'teamBScore' | 'dealerIndex' | 'round'>,
): SoloGame {
  const cleanName = playerName.trim().slice(0, 24) || 'You';
  const dealerIndex = previous?.dealerIndex ?? 0;
  const deck = shuffle(makeDeck());
  const hands: Domino[][] = [[], [], [], []];
  const dealOrder = [0, 1, 2, 3].sort(
    (left, right) => ((left - dealerIndex + 4) % 4) - ((right - dealerIndex + 4) % 4),
  );

  dealOrder.forEach((seat, position) => {
    hands[seat] = deck.slice(position * 7, position * 7 + 7);
  });

  let opening: { seat: number; tile: Domino } | null = null;
  for (let value = 6; value >= 0 && !opening; value -= 1) {
    for (let seat = 0; seat < 4 && !opening; seat += 1) {
      const tile = hands[seat].find((candidate) => candidate.a === value && candidate.b === value);
      if (tile) opening = { seat, tile };
    }
  }

  // Seven doubles are shared among four hands, so a double is guaranteed.
  if (!opening) throw new Error('Could not find the opening double. Please deal again.');
  hands[opening.seat] = hands[opening.seat].filter((tile) => tile.id !== opening!.tile.id);

  const players: SoloPlayer[] = [
    { index: 0, name: cleanName, team: 'A', isCpu: false },
    { index: 1, name: CPU_NAMES[0], team: 'B', isCpu: true },
    { index: 2, name: CPU_NAMES[1], team: 'A', isCpu: true },
    { index: 3, name: CPU_NAMES[2], team: 'B', isCpu: true },
  ];

  return {
    players,
    hands,
    board: [{ ...opening.tile, played_by: opening.seat }],
    leftValue: opening.tile.a,
    rightValue: opening.tile.b,
    currentTurn: (opening.seat + 1) % 4,
    passCount: 0,
    dealerIndex,
    round: previous?.round ?? 1,
    teamAScore: previous?.teamAScore ?? 0,
    teamBScore: previous?.teamBScore ?? 0,
    status: 'playing',
    lastMessage: `Round ${previous?.round ?? 1} starts — ${players[opening.seat].name} opens with ${opening.tile.a}–${opening.tile.b}.`,
    winner: null,
  };
}

function scoreHand(game: SoloGame, reason: 'blocked' | 'went out'): SoloGame {
  const teamAPips = soloPipTotal(game.hands[0]) + soloPipTotal(game.hands[2]);
  const teamBPips = soloPipTotal(game.hands[1]) + soloPipTotal(game.hands[3]);
  let teamAScore = game.teamAScore;
  let teamBScore = game.teamBScore;
  let dealerIndex = game.dealerIndex;
  let message: string;
  let winner: 'A' | 'B' | null = null;

  if (teamAPips === teamBPips) {
    message = `WASH! Both teams counted ${teamAPips}. Same count means no points; the dealer keeps the deal.`;
  } else if (teamAPips < teamBPips) {
    teamAScore += teamBPips - teamAPips;
    dealerIndex = (dealerIndex + 1) % 4;
    message = `${reason === 'blocked' ? 'BLOCKED HAND' : 'HAND COMPLETE'} — Team A wins ${teamAPips}–${teamBPips}, +${teamBPips - teamAPips} points.`;
  } else {
    teamBScore += teamAPips - teamBPips;
    dealerIndex = (dealerIndex + 1) % 4;
    message = `${reason === 'blocked' ? 'BLOCKED HAND' : 'HAND COMPLETE'} — Team B wins ${teamBPips}–${teamAPips}, +${teamAPips - teamBPips} points.`;
  }

  if (teamAScore >= 100) {
    winner = 'A';
    message += ' Team A wins the match!';
  } else if (teamBScore >= 100) {
    winner = 'B';
    message += ' Team B wins the match!';
  }

  return {
    ...game,
    teamAScore,
    teamBScore,
    dealerIndex,
    status: winner ? 'finished' : 'round_over',
    lastMessage: message,
    winner,
  };
}

export function playSoloTile(game: SoloGame, seat: number, move: SoloMove): SoloGame {
  if (game.status !== 'playing' || game.currentTurn !== seat) return game;
  const hand = game.hands[seat];
  const tile = hand.find((candidate) => candidate.id === move.tileId);
  if (!tile) return game;

  const sides = getSides(tile, game.leftValue, game.rightValue);
  if (!sides.includes(move.side)) return game;

  const nextHands = game.hands.map((playerHand, index) =>
    index === seat ? playerHand.filter((candidate) => candidate.id !== tile.id) : playerHand,
  );
  let displayA: number;
  let displayB: number;
  let leftValue = game.leftValue;
  let rightValue = game.rightValue;

  if (move.side === 'left') {
    if (tile.a === game.leftValue) {
      displayA = tile.b;
      displayB = tile.a;
      leftValue = tile.b;
    } else {
      displayA = tile.a;
      displayB = tile.b;
      leftValue = tile.a;
    }
  } else if (tile.a === game.rightValue) {
    displayA = tile.a;
    displayB = tile.b;
    rightValue = tile.b;
  } else {
    displayA = tile.b;
    displayB = tile.a;
    rightValue = tile.a;
  }

  const board: BoardDomino[] = [...game.board];
  const playedTile: BoardDomino = { id: tile.id, a: displayA, b: displayB, played_by: seat };
  if (move.side === 'left') board.unshift(playedTile);
  else board.push(playedTile);

  const next: SoloGame = {
    ...game,
    hands: nextHands,
    board,
    leftValue,
    rightValue,
    currentTurn: (seat + 1) % 4,
    passCount: 0,
    lastMessage: `${game.players[seat].name} played ${tile.a}–${tile.b} on the ${move.side}.`,
  };

  if (nextHands[seat].length === 0) return scoreHand(next, 'went out');
  return next;
}

export function passSoloTurn(game: SoloGame, seat: number): SoloGame {
  if (game.status !== 'playing' || game.currentTurn !== seat) return game;
  const hand = game.hands[seat];
  if (hand.some((tile) => getSides(tile, game.leftValue, game.rightValue).length > 0)) return game;

  const passCount = game.passCount + 1;
  if (passCount >= 4) {
    return scoreHand({ ...game, passCount: 4, lastMessage: 'Four consecutive passes. The hand is blocked.' }, 'blocked');
  }

  const nextTurn = (seat + 1) % 4;
  return {
    ...game,
    currentTurn: nextTurn,
    passCount,
    lastMessage: `${game.players[seat].name} cannot play and passes (${passCount} of 4).`,
  };
}

export function runSoloCpuTurn(game: SoloGame): SoloGame {
  const seat = game.currentTurn;
  if (game.status !== 'playing' || seat === 0) return game;

  const moves = game.hands[seat].flatMap((tile) =>
    getSides(tile, game.leftValue, game.rightValue).map((side) => ({ tile, side })),
  );
  if (moves.length === 0) return passSoloTurn(game, seat);

  // CPU prioritizes shedding high pips, with doubles as a small tie-breaker.
  moves.sort((left, right) => {
    const leftValue = left.tile.a + left.tile.b + (left.tile.a === left.tile.b ? 0.5 : 0);
    const rightValue = right.tile.a + right.tile.b + (right.tile.a === right.tile.b ? 0.5 : 0);
    return rightValue - leftValue || (left.side === right.side ? 0 : left.side === 'right' ? -1 : 1);
  });
  const chosen = moves[0];
  return playSoloTile(game, seat, { tileId: chosen.tile.id, side: chosen.side });
}

export function dealNextSoloHand(game: SoloGame): SoloGame {
  if (game.status !== 'round_over') return game;
  return startSoloGame(game.players[0].name, {
    teamAScore: game.teamAScore,
    teamBScore: game.teamBScore,
    dealerIndex: game.dealerIndex,
    round: game.round + 1,
  });
}
