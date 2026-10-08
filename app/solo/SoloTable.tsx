'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Domino, PlaySide } from '@/lib/dominoes';
import {
  dealNextSoloHand,
  passSoloTurn,
  playSoloTile,
  runSoloCpuTurn,
  SoloGame,
  startSoloGame,
} from '@/lib/soloGame';

const PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
};

function PipPattern({ value }: { value: number }) {
  return (
    <span className="pip-grid" aria-label={`${value} pips`}>
      {(PIP_LAYOUTS[value] ?? []).map(([row, column]) => (
        <i key={`${row}-${column}`} style={{ gridRow: row, gridColumn: column }} />
      ))}
    </span>
  );
}

function SoloTile({ tile, vertical = false }: { tile: Domino; vertical?: boolean }) {
  return (
    <div className={`domino-face ${vertical ? 'vertical' : 'horizontal'}`} aria-label={`${tile.a} and ${tile.b}`}>
      <span className="domino-half"><PipPattern value={tile.a} /></span>
      <span className="domino-divider" />
      <span className="domino-half"><PipPattern value={tile.b} /></span>
    </div>
  );
}

function CpuAvatar({ playerIndex }: { playerIndex: number }) {
  return <span className={`solo-avatar ${playerIndex === 2 ? 'solo-avatar-teammate' : 'solo-avatar-cpu'}`}>{playerIndex === 0 ? 'Y' : 'CPU'}</span>;
}

function getSides(tile: Domino, left: number, right: number): PlaySide[] {
  const sides: PlaySide[] = [];
  if (tile.a === left || tile.b === left) sides.push('left');
  if (tile.a === right || tile.b === right) sides.push('right');
  return sides;
}

export default function SoloTable() {
  const [playerName, setPlayerName] = useState('You');
  const [game, setGame] = useState<SoloGame>(() => startSoloGame('You'));
  const [notice, setNotice] = useState('');

  const currentPlayer = game.players[game.currentTurn];
  const myTurn = game.status === 'playing' && game.currentTurn === 0;
  const cpuThinking = game.status === 'playing' && game.currentTurn !== 0;

  const playableTileCount = useMemo(
    () => game.hands[0].filter((tile) => getSides(tile, game.leftValue, game.rightValue).length > 0).length,
    [game],
  );

  useEffect(() => {
    if (!cpuThinking) return;
    const timer = window.setTimeout(() => {
      setGame((previous) => runSoloCpuTurn(previous));
    }, 720);
    return () => window.clearTimeout(timer);
  }, [cpuThinking, game.currentTurn, game.passCount, game.board.length, game.round]);

  function newGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGame(startSoloGame(playerName));
    setNotice('');
  }

  function play(tileId: number, side: PlaySide) {
    setGame((previous) => playSoloTile(previous, 0, { tileId, side }));
  }

  function pass() {
    setGame((previous) => passSoloTurn(previous, 0));
  }

  function nextHand() {
    setGame((previous) => dealNextSoloHand(previous));
  }

  const isWash = game.lastMessage.toLowerCase().includes('wash');

  return (
    <main className="app-shell game-shell solo-shell">
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />
      <header className="topbar game-topbar solo-topbar">
        <Link className="brand" href="/" aria-label="Back to SA Dominoes home">
          <span className="flag-mark" aria-hidden="true"><i className="flag-red" /><i className="flag-blue" /><i className="flag-green" /><i className="flag-gold" /></span>
          <span className="brand-wordmark">SA<span>DOMINOES</span></span>
        </Link>
        <div className="solo-nav-label"><span className="solo-mode-dot" /> PRACTICE TABLE <span>·</span> NO ROOM CODE</div>
        <Link className="button button-quiet button-small solo-back-link" href="/">← MULTIPLAYER</Link>
      </header>

      <div className="game-content solo-content">
        <section className="game-heading solo-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> SINGLE PLAYER <span className="eyebrow-divider">/</span> THREE CPU OPPONENTS</div>
            <h1>Four seats. You call the plays.</h1>
            <p>Your CPU partner takes seat 3. Beat the two CPU opponents to 100.</p>
          </div>
          <div className="solo-mode-pill"><span>1P</span><i>VS</i><span>CPU</span></div>
        </section>

        {notice && <div className="notice notice-info solo-notice" role="status">{notice}</div>}

        <div className="score-strip">
          <div className="score-team score-team-a">
            <div className="score-label"><span className="score-swatch" /> TEAM A <small>YOU + CPU PARTNER</small></div>
            <strong>{game.teamAScore}</strong><span className="score-unit">PTS</span>
          </div>
          <div className="score-center"><span>FIRST TO</span><b>100</b></div>
          <div className="score-team score-team-b">
            <div className="score-label"><span className="score-swatch" /> TEAM B <small>2 CPU OPPONENTS</small></div>
            <strong>{game.teamBScore}</strong><span className="score-unit">PTS</span>
          </div>
        </div>

        <div className="table-grid solo-table-grid">
          <div className="table-column">
            <section className="panel seats-panel solo-seats-panel" aria-label="Solo game players">
              <div className="panel-heading">
                <div><span className="section-index">01</span><h2>Four seats, one human</h2></div>
                <span className="seat-count">ROUND {game.round}</span>
              </div>
              <div className="seats-grid">
                {game.players.map((player) => {
                  const isCurrent = game.status === 'playing' && game.currentTurn === player.index;
                  return (
                    <div className={`seat-card team-${player.team.toLowerCase()} ${player.index === 0 ? 'is-me' : ''} ${isCurrent ? 'is-turn' : ''}`} key={player.index}>
                      <div className="seat-topline">
                        <span className="seat-number">SEAT 0{player.index + 1}</span>
                        <div className="seat-badges">
                          {game.dealerIndex === player.index && <span className="dealer-badge">DEALER</span>}
                          <span className={`team-tag team-tag-${player.team.toLowerCase()}`}>TEAM {player.team}</span>
                        </div>
                      </div>
                      <div className="seat-person">
                        <CpuAvatar playerIndex={player.index} />
                        <div className="seat-name-wrap">
                          <strong>{player.name}</strong>
                          <span>{player.index === 0 ? 'YOU · HUMAN' : player.index === 2 ? 'YOUR CPU PARTNER' : 'CPU OPPONENT'}</span>
                        </div>
                        {isCurrent && <span className="turn-dot" title="Current turn" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel board-panel solo-board-panel" aria-label="Solo domino board">
              <div className="panel-heading board-heading">
                <div><span className="section-index">02</span><h2>The board</h2></div>
                {game.status === 'playing' && <span className="passes-count">PASSES <b>{game.passCount} / 4</b></span>}
              </div>
              <div className="board-felt">
                <div className="felt-grain" />
                <div className="board-row-wrap">
                  <div className="board-end-marker"><span>OPEN END</span><b>{game.leftValue}</b><i>← LEFT</i></div>
                  <div className="board-scroll" aria-label={`${game.board.length} dominoes on the board`}>
                    <div className="board-row">
                      {game.board.map((tile, index) => (
                        <div className="board-tile-wrap" key={`${tile.id}-${index}`}><SoloTile tile={tile} /></div>
                      ))}
                    </div>
                  </div>
                  <div className="board-end-marker board-end-right"><span>OPEN END</span><b>{game.rightValue}</b><i>RIGHT →</i></div>
                </div>
                <div className="felt-caption"><span>SOLO TABLE</span><i /><span>DOUBLE-SIX SET</span></div>
              </div>
              <div className="last-callout"><span className="callout-icon">✳</span><p>{game.lastMessage}</p></div>
            </section>

            {game.status === 'playing' && (
              <section className={`turn-banner ${myTurn ? 'turn-banner-mine' : ''}`} aria-live="polite">
                <div className="turn-indicator"><span className="turn-indicator-dot" /><div><small>{myTurn ? 'YOUR TURN' : 'CPU THINKING'}</small><strong>{myTurn ? game.players[0].name : currentPlayer.name}</strong></div></div>
                <div className="turn-guidance">{myTurn ? 'Match either open end with a tile from your hand.' : 'The table is moving. Your hand stays private.'}</div>
                {myTurn && playableTileCount === 0 && <button className="button button-outline pass-button" type="button" onClick={pass}>PASS TURN <span>→</span></button>}
                {cpuThinking && <span className="cpu-thinking-dots" aria-label="CPU is thinking"><i /><i /><i /></span>}
              </section>
            )}

            <section className="panel hand-panel solo-hand-panel">
              <div className="panel-heading hand-heading">
                <div><span className="section-index">03</span><h2>Your hand <span className="hand-count">({game.hands[0].length})</span></h2></div>
                <span className="hand-private"><span>●</span> PRIVATE TO YOU</span>
              </div>
              {game.hands[0].length > 0 ? (
                <div className="hand-list">
                  {game.hands[0].map((tile) => {
                    const sides = getSides(tile, game.leftValue, game.rightValue);
                    const playable = myTurn && sides.length > 0;
                    return (
                      <div className={`hand-card ${playable ? 'hand-card-playable' : ''} ${myTurn && sides.length === 0 ? 'hand-card-muted' : ''}`} key={tile.id}>
                        <SoloTile tile={tile} vertical />
                        {myTurn ? (
                          sides.length > 0 ? (
                            <div className="tile-actions">
                              {sides.map((side) => (
                                <button key={side} type="button" onClick={() => play(tile.id, side)} aria-label={`Play ${tile.a} ${tile.b} on the ${side}`}>
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
              ) : <div className="empty-hand">You played your last tile. Scoring the hand…</div>}
              {myTurn && playableTileCount > 0 && <p className="hand-footnote">Play a highlighted tile to the left or right. Legal moves are checked before they land.</p>}
              {myTurn && playableTileCount === 0 && <p className="hand-footnote">No legal tile matches. Pass to keep the hand moving.</p>}
            </section>

            {(game.status === 'round_over' || game.status === 'finished') && (
              <section className={`round-result ${isWash ? 'round-result-wash' : ''}`}>
                <div className="result-mark">{game.status === 'finished' ? '🏆' : isWash ? '≋' : '✓'}</div>
                <div className="result-copy">
                  <span>{game.status === 'finished' ? 'MATCH COMPLETE' : isWash ? 'SAME COUNT = WASH' : 'HAND SCORED'}</span>
                  <strong>{game.lastMessage}</strong>
                  <p>{game.status === 'finished' ? `Team ${game.winner} wins the match.` : 'The scores are in. The next deal is ready when you are.'}</p>
                </div>
                {game.status === 'round_over' ? (
                  <button className="button button-lime" type="button" onClick={nextHand}>DEAL NEXT HAND <span>↗</span></button>
                ) : (
                  <button className="button button-outline" type="button" onClick={() => setGame(startSoloGame(playerName))}>REMATCH <span>↻</span></button>
                )}
              </section>
            )}
          </div>

          <aside className="sidebar solo-sidebar">
            <section className="panel solo-control-panel">
              <div className="sidebar-label">PRACTICE SETUP</div>
              <h2>Ready for<br /><em>another round?</em></h2>
              <form onSubmit={newGame} className="solo-name-form">
                <label className="field-label" htmlFor="solo-player-name">YOUR NAME</label>
                <input id="solo-player-name" className="text-input" value={playerName} onChange={(event) => setPlayerName(event.target.value.slice(0, 24))} maxLength={24} placeholder="Your name" />
                <button className="button button-lime full-width" type="submit">NEW GAME <span>↻</span></button>
              </form>
              <div className="solo-benefit"><span>⚡</span><p>Practice offline against three CPU seats. No account, room code, or Supabase connection needed.</p></div>
            </section>

            <section className="panel rules-panel">
              <div className="sidebar-label">SOLO TABLE RULES</div>
              <h3>Same rules.<br /><em>New rivals.</em></h3>
              <ul className="rules-list">
                <li><span>01</span><div><strong>Four seats</strong><small>You + three CPU players · seven tiles each</small></div></li>
                <li><span>02</span><div><strong>Teams stay opposite</strong><small>You and seat 3 are Team A; seats 2 and 4 are Team B</small></div></li>
                <li><span>03</span><div><strong>Block or go out</strong><small>Lower combined pip count scores the difference</small></div></li>
                <li className="wash-rule"><span>04</span><div><strong>Same count = WASH</strong><small>No points; the dealer keeps the deal</small></div></li>
              </ul>
              <div className="first-to-note"><span>WIN CONDITION</span><strong>FIRST TEAM TO 100</strong></div>
            </section>
            <Link className="button button-quiet full-width solo-back-full" href="/">BACK TO MULTIPLAYER <span>↗</span></Link>
          </aside>
        </div>
        <footer className="game-footer"><span>SA DOMINOES · SOLO PRACTICE</span><span>YOU + CPU PARTNER VS CPU DUO</span></footer>
      </div>
    </main>
  );
}
