# SA Dominoes

A South African double-six dominoes app with both a four-player realtime table and a one-player practice table against three CPU seats.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The repository is preconfigured with the project's **public** Supabase URL and publishable key, so you do not need a local environment file to use this project. `.env.example` documents the same values. To connect a different Supabase project, copy `.env.example` to `.env.local` and replace the URL/key; environment values override the defaults.

The publishable key is intended for browser use. Never add a Supabase secret/service-role key to the app, a `NEXT_PUBLIC_` variable, or Git.

## Supabase setup

In the Supabase SQL Editor, run [`supabase/migrations/202610050001_multiplayer_dominoes.sql`](supabase/migrations/202610050001_multiplayer_dominoes.sql). This creates the multiplayer tables, RLS policies, Realtime publication entries, and validated RPC operations. The private hand/token table is not exposed to clients or Realtime.

The migration removes the old prototype's public `hand` column. Discard any active rooms from that first prototype before running the migration, then create new rooms in this version.

## Game modes

- **Multiplayer:** create or join with an `SA####` code; the fourth seat starts the hand. Seats 1 and 3 are Team A; seats 2 and 4 are Team B. Hands are dealt privately and updates sync through Supabase Realtime.
- **1P vs CPU:** one human and three CPU seats, with a CPU partner opposite you. This mode runs locally in the browser and does not require Supabase, a room code, or a login.
- Both modes use the double-six set, highest-double opener, legal left/right play, and four consecutive passes to block. The lower combined team pip count scores the difference; equal counts are a WASH (no points, same dealer). First team to 100 wins.

## Vercel

Vercel recognizes the Next.js app and builds it with the checked-in `vercel.json` (`npm install`, `npm run build`). The current project's public Supabase settings have a safe client-side fallback in the app, so a Vercel build does not depend on local `.env.local`. If you deploy against a different Supabase project, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel's Environment Variables and run the SQL migration on that project first.

A push to this session branch can create a Vercel Preview Deployment if the repository is connected to Vercel. Production deployment still depends on the Vercel project's configured production branch.
