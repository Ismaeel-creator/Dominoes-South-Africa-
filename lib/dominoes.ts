export type Domino = {
  id: number;
  a: number;
  b: number;
};

export type BoardDomino = Domino & {
  played_by: number;
};

export type PlaySide = 'left' | 'right';

export type Room = {
  id: string;
  room_code: string;
  host_name: string;
  team_a_score: number;
  team_b_score: number;
  status: 'waiting' | 'playing' | 'round_over' | 'finished';
  board: BoardDomino[];
  current_turn: number;
  left_value: number | null;
  right_value: number | null;
  pass_count: number;
  dealer_index: number;
  round_number: number;
  last_message: string;
  created_at: string;
  updated_at: string;
};

export type RoomPlayer = {
  id: string;
  player_index: number;
  name: string;
  team: 'A' | 'B';
  hand_count: number;
  is_online: boolean;
};

export type RoomSnapshot = {
  room: Room;
  players: RoomPlayer[];
  my_hand: Domino[];
  my_player_index: number;
  my_player_id: string;
};

export type RoomSession = {
  roomId: string;
  roomCode: string;
  playerId: string;
  token: string;
  name: string;
};

export function playableSides(tile: Domino, room: Room): PlaySide[] {
  if (room.left_value === null || room.right_value === null) return [];

  const sides: PlaySide[] = [];
  if (tile.a === room.left_value || tile.b === room.left_value) sides.push('left');
  if (tile.a === room.right_value || tile.b === room.right_value) sides.push('right');
  return sides;
}

export function pipTotal(hand: Domino[]): number {
  return hand.reduce((total, tile) => total + tile.a + tile.b, 0);
}

export function playerAt(players: RoomPlayer[], index: number): RoomPlayer | undefined {
  return players.find((player) => player.player_index === index);
}
