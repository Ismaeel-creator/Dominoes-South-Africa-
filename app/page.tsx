'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BoardDomino,
  Domino,
  PlaySide,
  RoomSession,
  RoomSnapshot,
  playableSides,
  playerAt,
} from '@/lib/dominoes';
import { supabase, supabaseConfigured } from '@/lib/supabaseClient';

const SESSION_KEY = 'sa-dominoes-player-session-v1';

type Notice = { kind: 'error' | 'success' | 'info'; text: string };
type ConnectionState = 'connecting' | 'live' | 'offline';
type GameAction = 'play_domino' | 'pass_domino_turn' | 'start_next_domino_round';

type CreateOrJoinResult = {
  room_id: string;
  room_code: string;
  player_id: string;
  player_index: number;
  token: string;
};

async function fetchRoomSnapshot(session: RoomSession): Promise<RoomSnapshot> {
  if (!supabase) throw new Error('Supabase configuration is unavailable. Check the public project settings.');

  const { data, error } = await supabase.rpc('get_domino_room', {
    p_room_code: session.roomCode,
    p_token: session.token,
  });

  if (error) throw error;
  if (!data || !data.room) throw new Error('That saved table could not be found.');
  return data as RoomSnapshot;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

function makeSession(result: CreateOrJoinResult, name: string): RoomSession {
  return {
    roomId: result.room_id,
    roomCode: result.room_code,
    playerId: result.player_id,
    token: result.token,
    name,
  };
}

function Pips({ value }: { value: number }) {
  const layouts: Record<number, Array<[number, number]>> = {
    0: [],
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [1, 3], [3, 1], [3, 3]],
    5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
    6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
  };

  return (
    <span className="pip-grid" aria-label={`${value} pips`}>
      {(layouts[value] ?? []).map(([row, column]) => (
        <i key={`${row}-${column}`} style={{ gridRow: row, gridColumn: column }} />
      ))}
    </span>
  );
}

function DominoFace({
  a,
  b,
  orientation = 'horizontal',
}: {
  a: number;
  b: number;
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <div className={`domino-face ${orientation}`} aria-label={`${a} and ${b}`}>
      <span className="domino-half"><Pips value={a} /></span>
      <span className="domino-divider" />
      <span className="domino-half"><Pips value={b} /></span>
    </div>
  );
}

function SmallFlag() {
  return (
    <span className="flag-mark" aria-label="South Africa">
      <i className="flag-red" />
      <i className="flag-blue" />
      <i className="flag-green" />
      <i className="flag-gold" />
    </span>
  );
}

function SeatCard({
  index,
  name,
  team,
  handCount,
  isMe,
  isTurn,
  isDealer,
}: {
  index: number;
  name?: string;
  team: 'A' | 'B';
  handCount?: number;
  isMe: boolean;
  isTurn: boolean;
  isDealer: boolean;
}) {
  const occupied = Boolean(name);
  return (
    <div className={`seat-card team-${team.toLowerCase()} ${isMe ? 'is-me' : ''} ${isTurn ? 'is-turn' : ''} ${occupied ? '' : 'is-empty'}`}>
      <div className="seat-topline">
        <span className="seat-number">SEAT 0{index + 1}</span>
        <div className="seat-badges">
          {isDealer && <span className="dealer-badge">DEALER</span>}
          <span className={`team-tag team-tag-${team.toLowerCase()}`}>TEAM {team}</span>
        </div>
      </div>
      <div className="seat-person">
        <span className={`avatar team-avatar-${team.toLowerCase()} ${occupied ? '' : 'avatar-empty'}`}>
          {occupied ? name!.slice(0, 1).toUpperCase() : '+'}
        </span>
        <div className="seat-name-wrap">
          <strong>{occupied ? name : 'Open seat'}</strong>
          <span>{occupied ? (isMe ? 'You' : `${handCount ?? 0} tiles`) : 'Waiting for a player'}</span>
        </div>
        {isTurn && <span className="turn-dot" title="Current turn" />}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState<RoomSession | null>(null);
  const [savedSession, setSavedSession] = useState<RoomSession | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [notice, setNotice] = useState<Notice | null>(null);

  const storeSession = useCallback((next: RoomSession) => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSavedSession(next);
  }, []);

  useEffect(() => {
    const sharedCode = new URLSearchParams(window.location.search).get('room');
    if (sharedCode) setRoomCode(sharedCode.toUpperCase().slice(0, 6));

    let stored: RoomSession | null = null;
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) stored = JSON.parse(raw) as RoomSession;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
    }

    if (!stored || !stored.roomCode || !stored.token || !stored.roomId) {
      setCheckingSession(false);
      return;
    }

    setSavedSession(stored);
    setPlayerName(stored.name ?? '');

    if (!supabaseConfigured) {
      setCheckingSession(false);
      return;
    }

    let mounted = true;
    fetchRoomSnapshot(stored)
      .then((state) => {
        if (mounted) {
          setSnapshot(state);
          setSession(stored);
        }
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        window.localStorage.removeItem(SESSION_KEY);
        setSavedSession(null);
        setNotice({ kind: 'info', text: `Your saved table could not be restored: ${getErrorMessage(error)}` });
      })
      .finally(() => {
        if (mounted) setCheckingSession(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!session || !client) {
      setConnection('offline');
      return;
    }

    let mounted = true;
    let pending = false;
    let timeout: number | undefined;

    const refresh = async () => {
      try {
        const state = await fetchRoomSnapshot(session);
        if (mounted) setSnapshot(state);
      } catch (error) {
        if (mounted) setNotice({ kind: 'error', text: getErrorMessage(error) });
      }
    };

    const scheduleRefresh = () => {
      if (pending) return;
      pending = true;
      timeout = window.setTimeout(() => {
        pending = false;
        void refresh();
      }, 90);
    };

    const channel = client
      .channel(`domino-room-${session.roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'domino_rooms', filter: `id=eq.${session.roomId}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'domino_room_players', filter: `room_id=eq.${session.roomId}` },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (!mounted) return;
        setConnection(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'offline' : 'connecting');
      });

    void refresh();
    return () => {
      mounted = false;
      if (timeout) window.clearTimeout(timeout);
      void client.removeChannel(channel);
    };
  }, [session?.roomId, session?.token]);

  const currentPlayer = useMemo(() => {
    if (!snapshot) return undefined;
    return playerAt(snapshot.players, snapshot.room.current_turn);
  }, [snapshot]);

  const isMyTurn = Boolean(
    snapshot && snapshot.room.status === 'playing' && snapshot.room.current_turn === snapshot.my_player_index,
  );

  const myPlayableTiles = useMemo(() => {
    if (!snapshot) return [] as Domino[];
    return snapshot.my_hand.filter((tile) => playableSides(tile, snapshot.room).length > 0);
  }, [snapshot]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setNotice({ kind: 'error', text: 'Multiplayer is not configured yet. Add the Supabase settings shown below.' });
      return;
    }
    const cleanName = playerName.trim();
    if (!cleanName) return;

    setBusy(true);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc('create_domino_room', { p_name: cleanName });
      if (error) throw error;
      const next = makeSession(data as CreateOrJoinResult, cleanName);
      storeSession(next);
      const state = await fetchRoomSnapshot(next);
      setSession(next);
      setSnapshot(state);
      setRoomCode(next.roomCode);
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setNotice({ kind: 'error', text: 'Multiplayer is not configured yet. Add the Supabase settings shown below.' });
      return;
    }
    const cleanName = playerName.trim();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanName || !cleanCode) return;

    setBusy(true);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc('join_domino_room', {
        p_room_code: cleanCode,
        p_name: cleanName,
      });
      if (error) throw error;
      const next = makeSession(data as CreateOrJoinResult, cleanName);
      storeSession(next);
      const state = await fetchRoomSnapshot(next);
      setSession(next);
      setSnapshot(state);
      setRoomCode(next.roomCode);
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!savedSession) return;
    setBusy(true);
    setNotice(null);
    try {
      const state = await fetchRoomSnapshot(savedSession);
      setSession(savedSession);
      setSnapshot(state);
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    action: GameAction,
    extra: { p_tile_id?: number; p_side?: PlaySide } = {},
  ) {
    if (!session || !supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc(action, {
        p_room_code: session.roomCode,
        p_token: session.token,
        ...extra,
      });
      if (error) throw error;
      const state = await fetchRoomSnapshot(session);
      setSnapshot(state);
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function handleWhatsAppShare() {
    if (!session) return;
    const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(session.roomCode)}`;
    const message = `Join my SA Dominoes table. Room code: ${session.roomCode}\n${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  async function handleShare() {
    if (!session) return;
    const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(session.roomCode)}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'SA Dominoes room',
          text: `Join my dominoes table with code ${session.roomCode}`,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setNotice({ kind: 'success', text: 'Room invite link copied.' });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(shareUrl);
        setNotice({ kind: 'success', text: 'Room invite link copied.' });
      } catch {
        setNotice({ kind: 'error', text: 'Could not share automatically. Send the room code to your friends.' });
      }
    }
  }

  function backToLobby() {
    setSession(null);
    setSnapshot(null);
    setNotice({ kind: 'info', text: 'Your seat is saved on this device. Resume the table whenever you are ready.' });
  }

  if (checkingSession) {
    return (
      <main className="loading-screen">
        <div className="loading-brand"><SmallFlag /><span>SA DOMINOES</span></div>
        <span className="loading-spinner" />
        <p>Finding your table…</p>
      </main>
    );
  }

  if (session && snapshot) {
    const room = snapshot.room;
    const myPlayer = playerAt(snapshot.players, snapshot.my_player_index);
    const seatedPlayers = Array.from({ length: 4 }, (_, index) => playerAt(snapshot.players, index));
    const isWaiting = room.status === 'waiting';
    const isRoundOver = room.status === 'round_over';
    const isFinished = room.status === 'finished';
    const isHost = snapshot.my_player_index === 0;

    return (
      <main className="app-shell game-shell">
        <div className="ambient-glow ambient-glow-one" />
        <div className="ambient-glow ambient-glow-two" />
        <header className="topbar game-topbar">
          <a className="brand" href="/" onClick={(event) => { event.preventDefault(); backToLobby(); }}>
            <SmallFlag />
            <span className="brand-wordmark">SA<span>DOMINOES</span></span>
          </a>
          <div className="game-nav-actions">
            <div className="room-code-chip">
              <span>ROOM CODE</span>
              <strong>{room.room_code}</strong>
            </div>
            <button className="button button-quiet button-small" type="button" onClick={handleShare}>
              <span className="share-glyph" aria-hidden="true">↗</span> Invite friends
            </button>
            <button className="button button-whatsapp button-small" type="button" onClick={handleWhatsAppShare}>
              <span className="whatsapp-mark" aria-hidden="true">◉</span> WhatsApp
            </button>
            <div className={`connection-pill connection-${connection}`}>
              <i />{connection === 'live' ? 'LIVE SYNC' : connection === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
            </div>
            <button className="icon-button" type="button" aria-label="Back to lobby" title="Back to lobby" onClick={backToLobby}>×</button>
          </div>
        </header>

        <div className="game-content">
          {notice && (
            <div className={`notice notice-${notice.kind}`} role="status">
              <span>{notice.text}</span>
              <button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          <section className="game-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> PRIVATE TABLE <span className="eyebrow-divider">/</span> ROUND {Math.max(room.round_number, 1)}</div>
              <h1>{isWaiting ? 'The table is open.' : isFinished ? 'Game, set, match.' : isRoundOver ? 'Hand complete.' : 'Make your move.'}</h1>
              <p>{isWaiting ? 'Four seats. Two teams. You bring the people.' : 'A live South African table, synced for every seat.'}</p>
            </div>
            <div className={`status-badge status-${room.status}`}>
              <i />{room.status === 'round_over' ? 'HAND COMPLETE' : room.status.toUpperCase().replace('_', ' ')}
            </div>
          </section>

          <div className="score-strip">
            <div className="score-team score-team-a">
              <div className="score-label"><span className="score-swatch" /> TEAM A <small>SEATS 1 &amp; 3</small></div>
              <strong>{room.team_a_score}</strong><span className="score-unit">PTS</span>
            </div>
            <div className="score-center">
              <span>FIRST TO</span><b>100</b>
            </div>
            <div className="score-team score-team-b">
              <div className="score-label"><span className="score-swatch" /> TEAM B <small>SEATS 2 &amp; 4</small></div>
              <strong>{room.team_b_score}</strong><span className="score-unit">PTS</span>
            </div>
          </div>

          <div className="table-grid">
            <div className="table-column">
              <section className="panel seats-panel" aria-label="Players at the table">
                <div className="panel-heading">
                  <div><span className="section-index">01</span><h2>At the table</h2></div>
                  <span className="seat-count">{snapshot.players.length} / 4 SEATED</span>
                </div>
                <div className="seats-grid">
                  {seatedPlayers.map((player, index) => (
                    <SeatCard
                      key={index}
                      index={index}
                      name={player?.name}
                      team={index % 2 === 0 ? 'A' : 'B'}
                      handCount={player?.hand_count}
                      isMe={snapshot.my_player_index === index}
                      isTurn={room.status === 'playing' && room.current_turn === index}
                      isDealer={room.dealer_index === index}
                    />
                  ))}
                </div>
              </section>

              <section className="panel board-panel" aria-label="Domino board">
                <div className="panel-heading board-heading">
                  <div><span className="section-index">02</span><h2>The board</h2></div>
                  {room.status === 'playing' && <span className="passes-count">PASSES <b>{room.pass_count} / 4</b></span>}
                </div>
                <div className="board-felt">
                  <div className="felt-grain" />
                  {room.board.length > 0 ? (
                    <div className="board-row-wrap">
                      <div className="board-end-marker">
                        <span>OPEN END</span><b>{room.left_value}</b><i>← LEFT</i>
                      </div>
                      <div className="board-scroll" aria-label={`${room.board.length} dominoes on the board`}>
                        <div className="board-row">
                          {room.board.map((tile: BoardDomino, index: number) => (
                            <div className="board-tile-wrap" key={`${tile.id}-${index}`}>
                              <DominoFace a={tile.a} b={tile.b} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="board-end-marker board-end-right">
                        <span>OPEN END</span><b>{room.right_value}</b><i>RIGHT →</i>
                      </div>
                    </div>
                  ) : (
                    <div className="board-empty-state">
                      <span className="empty-board-mark"><DominoFace a={6} b={6} /></span>
                      <strong>Waiting for the full four</strong>
                      <span>The opening double will land here when every seat is filled.</span>
                    </div>
                  )}
                  <div className="felt-caption"><span>SA DOMINOES</span><i /><span>DOUBLE-SIX SET</span></div>
                </div>
                <div className="last-callout">
                  <span className="callout-icon">✳</span>
                  <p>{room.last_message}</p>
                </div>
              </section>

              {!isWaiting && !isRoundOver && !isFinished && (
                <section className={`turn-banner ${isMyTurn ? 'turn-banner-mine' : ''}`} aria-live="polite">
                  <div className="turn-indicator"><span className="turn-indicator-dot" /><div><small>{isMyTurn ? 'YOUR TURN' : 'ON THE MOVE'}</small><strong>{isMyTurn ? myPlayer?.name : currentPlayer?.name ?? `Seat ${room.current_turn + 1}`}</strong></div></div>
                  <div className="turn-guidance">{isMyTurn ? 'Choose a matching tile from your hand.' : 'Waiting for the next play…'}</div>
                  {isMyTurn && myPlayableTiles.length === 0 && (
                    <button
                      className="button button-outline pass-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction('pass_domino_turn')}
                    >
                      PASS TURN <span aria-hidden="true">→</span>
                    </button>
                  )}
                </section>
              )}

              {!isWaiting && (
                <section className="panel hand-panel">
                  <div className="panel-heading hand-heading">
                    <div><span className="section-index">03</span><h2>Your hand <span className="hand-count">({snapshot.my_hand.length})</span></h2></div>
                    <span className="hand-private"><span>●</span> ONLY YOU CAN SEE THIS</span>
                  </div>
                  {snapshot.my_hand.length > 0 ? (
                    <div className="hand-list">
                      {snapshot.my_hand.map((tile) => {
                        const sides = playableSides(tile, room);
                        const canPlay = isMyTurn && sides.length > 0 && !busy;
                        return (
                          <div className={`hand-card ${canPlay ? 'hand-card-playable' : ''} ${isMyTurn && !sides.length ? 'hand-card-muted' : ''}`} key={tile.id}>
                            <DominoFace a={tile.a} b={tile.b} orientation="vertical" />
                            {isMyTurn ? (
                              sides.length > 0 ? (
                                <div className="tile-actions">
                                  {sides.map((side) => (
                                    <button
                                      key={side}
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void runAction('play_domino', { p_tile_id: tile.id, p_side: side })}
                                      aria-label={`Play ${tile.a} ${tile.b} on the ${side}`}
                                    >
                                      {side === 'left' ? '← LEFT' : 'RIGHT →'}
                                    </button>
                                  ))}
                                </div>
                              ) : <span className="tile-no-match">NO MATCH</span>
                            ) : <span className="tile-caption">{tile.a} — {tile.b}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-hand">Your tiles will appear here when the room starts.</div>
                  )}
                  {isWaiting && <p className="hand-footnote">Your hand stays private. The room only broadcasts the number of tiles each player holds.</p>}
                  {isMyTurn && myPlayableTiles.length > 0 && <p className="hand-footnote">Pick LEFT or RIGHT on any highlighted tile to play it.</p>}
                  {isMyTurn && myPlayableTiles.length === 0 && <p className="hand-footnote">No legal play. Pass to move the table along; four passes block the hand.</p>}
                </section>
              )}

              {isWaiting && (
                <section className="waiting-note">
                  <span className="waiting-pulse" />
                  <div><strong>Waiting for {Math.max(0, 4 - snapshot.players.length)} more {4 - snapshot.players.length === 1 ? 'player' : 'players'}.</strong><span>Share the room code; the deal starts automatically at four.</span></div>
                </section>
              )}

              {(isRoundOver || isFinished) && (
                <section className={`round-result ${room.last_message.toLowerCase().includes('wash') ? 'round-result-wash' : ''}`}>
                  <div className="result-mark">{isFinished ? '🏆' : room.last_message.toLowerCase().includes('wash') ? '≋' : '✓'}</div>
                  <div className="result-copy">
                    <span>{isFinished ? 'MATCH POINT' : room.last_message.toLowerCase().includes('wash') ? 'SAME COUNT = WASH' : 'HAND SCORED'}</span>
                    <strong>{room.last_message}</strong>
                    <p>{isFinished ? 'First team to 100 wins the match.' : 'The score is locked in. Deal the next hand when your table is ready.'}</p>
                  </div>
                  {isFinished ? (
                    <span className="winner-chip">{room.team_a_score >= 100 ? 'TEAM A WINS' : 'TEAM B WINS'}</span>
                  ) : isHost ? (
                    <button className="button button-lime" type="button" disabled={busy} onClick={() => void runAction('start_next_domino_round')}>
                      DEAL NEXT HAND <span aria-hidden="true">↗</span>
                    </button>
                  ) : (
                    <span className="host-wait-label">SEAT 1 DEALS NEXT</span>
                  )}
                </section>
              )}
            </div>

            <aside className="sidebar">
              <section className="panel your-seat-panel">
                <div className="sidebar-label">YOUR SEAT</div>
                <div className="your-seat-main">
                  <span className={`avatar large-avatar team-avatar-${myPlayer?.team?.toLowerCase() ?? 'a'}`}>{myPlayer?.name.slice(0, 1).toUpperCase() ?? '•'}</span>
                  <div><strong>{myPlayer?.name ?? session.name}</strong><span>SEAT {String(snapshot.my_player_index + 1).padStart(2, '0')} <i /> TEAM {myPlayer?.team ?? 'A'}</span></div>
                </div>
                <div className="seat-detail-row"><span>DEALER</span><strong>{playerAt(snapshot.players, room.dealer_index)?.name ?? `Seat ${room.dealer_index + 1}`}</strong></div>
                <div className="seat-detail-row"><span>ROUND</span><strong>{room.round_number || '—'}</strong></div>
              </section>

              <section className="panel rules-panel">
                <div className="sidebar-label">HOUSE RULES</div>
                <h3>Keep it clean.<br /><em>Count it right.</em></h3>
                <ul className="rules-list">
                  <li><span>01</span><div><strong>Four at the table</strong><small>Double-six set · seven tiles each</small></div></li>
                  <li><span>02</span><div><strong>Partners sit opposite</strong><small>Team A: seats 1 &amp; 3 · Team B: 2 &amp; 4</small></div></li>
                  <li><span>03</span><div><strong>Blocked? Count the pips</strong><small>Lower team total takes the difference</small></div></li>
                  <li className="wash-rule"><span>04</span><div><strong>Same count = WASH</strong><small>No points. The dealer stays for the reshuffle.</small></div></li>
                </ul>
                <div className="first-to-note"><span>WIN CONDITION</span><strong>FIRST TEAM TO 100</strong></div>
              </section>

              <div className="safe-play-note"><span className="lock-glyph">⌑</span><p>Hands are private. Only your own tiles are sent to your browser.</p></div>
              {isHost && isWaiting && <div className="host-note"><span>HOST</span><p>You created this room. The hand begins automatically when all four seats are filled.</p></div>}
              <button className="button button-quiet full-width back-lobby-button" type="button" onClick={backToLobby}>BACK TO LOBBY <span aria-hidden="true">↗</span></button>
            </aside>
          </div>
          <footer className="game-footer"><span>SA DOMINOES MULTIPLAYER</span><span>PLAY FAIR. COUNT TOGETHER.</span></footer>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell landing-shell">
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />
      <header className="topbar landing-topbar">
        <a className="brand" href="/">
          <SmallFlag />
          <span className="brand-wordmark">SA<span>DOMINOES</span></span>
        </a>
        <div className="topbar-right">
          <span className="topbar-note"><i /> BUILT FOR THE TABLE</span>
          <span className="topbar-divider" />
          <span className="topbar-locale">SOUTH AFRICA</span>
        </div>
      </header>

      <div className="landing-content">
        {notice && (
          <div className={`notice landing-notice notice-${notice.kind}`} role="status">
            <span>{notice.text}</span>
            <button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        <section className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> THE PEOPLE'S GAME <span className="eyebrow-divider">/</span> LIVE MULTIPLAYER</div>
            <h1>The table<br />is <em>open.</em></h1>
            <p className="hero-description">Four players. Two teams. One table that keeps everyone in the game — wherever you are.</p>
            <div className="hero-facts">
              <div><strong>04</strong><span>PLAYERS</span></div><i />
              <div><strong>02</strong><span>TEAMS</span></div><i />
              <div><strong>100</strong><span>TO WIN</span></div>
            </div>
            <div className="hero-domino" aria-hidden="true">
              <div className="hero-domino-shadow" />
              <DominoFace a={6} b={4} orientation="vertical" />
              <span className="hero-spark spark-one">✳</span><span className="hero-spark spark-two">✦</span>
              <span className="hero-domino-caption">DOUBLE-SIX<br />SOUTH AFRICAN TABLE</span>
            </div>
            <div className="hero-footnote"><span className="live-orbit"><i /></span><span>Same count? <strong>WASH.</strong> No points, no drama.</span></div>
          </div>

          <div className="lobby-column">
            <div className="lobby-card">
              <div className="lobby-card-top">
                <div><span className="card-kicker">GET A GAME GOING</span><h2>Join the table.</h2></div>
                <span className="lobby-stamp"><SmallFlag /><b>SA<br />TABLE</b></span>
              </div>

              <label className="field-label" htmlFor="player-name">YOUR NAME</label>
              <input
                id="player-name"
                className="text-input name-input"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value.slice(0, 24))}
                placeholder="What should we call you?"
                maxLength={24}
                autoComplete="nickname"
              />

              <form onSubmit={handleCreate} className="create-form">
                <button className="button button-lime create-button" type="submit" disabled={!supabaseConfigured || busy || !playerName.trim()}>
                  <span className="create-icon">＋</span><span>CREATE A ROOM</span><span className="button-arrow">↗</span>
                </button>
                <p className="button-caption">Deal a fresh hand and invite three friends.</p>
              </form>

              <div className="form-separator"><span /> OR JOIN A ROOM <span /></div>

              <form onSubmit={handleJoin} className="join-form">
                <label className="field-label" htmlFor="room-code">ROOM CODE</label>
                <div className="join-input-row">
                  <input
                    id="room-code"
                    className="text-input code-input"
                    value={roomCode}
                    onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    placeholder="SA1234"
                    maxLength={6}
                    autoCapitalize="characters"
                    aria-label="Room code"
                  />
                  <button className="button button-light join-button" type="submit" disabled={!supabaseConfigured || busy || !playerName.trim() || !roomCode.trim()}>
                    JOIN <span aria-hidden="true">→</span>
                  </button>
                </div>
                <p className="button-caption">Get the code from the person who opened the room.</p>
              </form>

              <div className="solo-cta">
                <span className="solo-cta-badge">CPU</span>
                <div><strong>Flying solo?</strong><span>Play a full four-seat table against CPU.</span></div>
                <Link className="solo-cta-link" href="/solo">PLAY SOLO <span aria-hidden="true">↗</span></Link>
              </div>

              {busy && <div className="form-progress"><span className="loading-spinner small-spinner" /> Connecting to the table…</div>}
              {!supabaseConfigured && (
                <div className="setup-message">
                  <span className="setup-mark">i</span>
                  <p><strong>One quick setup first.</strong> Add your Supabase project URL and publishable/anon key to <code>.env.local</code>, then run the SQL migration in <code>supabase/migrations</code>.</p>
                </div>
              )}

              {savedSession && !session && (
                <div className="saved-room-card">
                  <div><span className="card-kicker">SAVED ON THIS DEVICE</span><strong>{savedSession.roomCode}</strong><small>Resume as {savedSession.name}</small></div>
                  <button className="button button-outline" type="button" disabled={!supabaseConfigured || busy} onClick={() => void handleResume()}>RESUME ↗</button>
                </div>
              )}
            </div>
            <div className="lobby-trust-row"><span><i /> PRIVATE HANDS</span><span><i /> LIVE SYNC</span><span><i /> NO APP DOWNLOAD</span></div>
          </div>
        </section>

        <section className="how-strip" aria-label="How to play">
          <div className="how-intro"><span>THE SETUP</span><strong>All the way<br />around the table.</strong></div>
          <div className="how-step"><span>01</span><div><strong>Make a room</strong><p>Host opens a private table and shares the code.</p></div></div>
          <div className="how-step"><span>02</span><div><strong>Fill four seats</strong><p>Partners sit opposite. The deal starts automatically.</p></div></div>
          <div className="how-step"><span>03</span><div><strong>Play to 100</strong><p>Block the board, count the pips, respect the WASH.</p></div></div>
        </section>

        <footer className="landing-footer"><span>MADE FOR FRIENDS, FAMILY &amp; A LITTLE FRIENDLY COMPETITION.</span><span>SA DOMINOES <i>✳</i> MULTIPLAYER</span></footer>
      </div>
    </main>
  );
}
