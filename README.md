# SA Dominoes Multiplayer

A real-time, four-player South African dominoes room built with Next.js and Supabase. Players sit in alternating teams (A: seats 1 and 3; B: seats 2 and 4), play a double-six set, and race to 100. A blocked hand is scored automatically: the team with the lower combined pip count earns the difference; equal counts are a **WASH** with no points, and the dealer stays.

## Run locally

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/migrations/202610050001_multiplayer_dominoes.sql`](supabase/migrations/202610050001_multiplayer_dominoes.sql).
3. Copy `.env.example` to `.env.local` and set the project URL and **publishable** key:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   Legacy anon keys are also accepted. Never use a secret/service-role key in the browser or a `NEXT_PUBLIC_` variable.

4. Install and start the app:

   ```bash
   npm install
   npm run dev
   ```

   Open `http://localhost:3000`.

Without the two Supabase environment variables, the landing page remains viewable but room actions stay disabled and show the setup instructions.

## Deploy to Vercel

Import this repository into Vercel, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` under **Project Settings → Environment Variables**, then deploy. Run the SQL migration against the same Supabase project first. No server-side secrets are needed by the app.

## What is implemented

- Create a room and join by a shareable `SA####` code; copy/share invites or send directly through WhatsApp. The fourth seat starts the hand.
- Four seats, fixed A/B partnerships, a double-six deck, seven tiles dealt per player, and highest-double opening play.
- Valid left/right placement and server-validated passes; four consecutive passes block the hand.
- Private hands: only the player's own tiles are returned from the token-checked RPC. Room/roster tables expose only the public board, score, names, and tile counts.
- Supabase Realtime refreshes the room and roster for every player.
- Going out or blocking ends a hand. Lower combined team pips score the difference; equal counts produce a no-points WASH. First team to 100 wins.
- On a WASH, the same dealer deals again. Otherwise the dealer rotates. Seat 1 (the host) starts the next hand.
- The room session is saved in the current browser so a player can resume after refreshing or returning to the lobby.

## Security notes

All browser writes use SQL RPC functions that check a per-player UUID capability token and validate the current turn, tile, endpoints, and pass. Direct writes to the room/roster tables are revoked. The private hand/token table has RLS enabled, no client policies, and is intentionally excluded from Realtime. The migration also drops the old prototype's public `hand` column.

The earlier prototype schema did not have resumable private player sessions. If you already have active rooms created by that prototype, finish or discard them before running this migration; create a fresh room with the upgraded app. The app is anonymous (no account sign-in), so treat room codes as invitations and avoid using personal/sensitive names.
