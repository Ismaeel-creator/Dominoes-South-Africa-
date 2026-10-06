-- SA Dominoes multiplayer (four seats, two teams, private hands, automatic WASH scoring)
-- Run this complete file in the Supabase SQL Editor.
-- The older prototype stored every hand in domino_room_players. This migration removes
-- that public column and moves all new hands/tokens into a table clients cannot read.

create table if not exists public.domino_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_name text not null,
  team_a_score integer not null default 0,
  team_b_score integer not null default 0,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'round_over', 'finished')),
  board jsonb not null default '[]'::jsonb,
  current_turn integer not null default 0 check (current_turn between 0 and 3),
  left_value integer check (left_value between 0 and 6),
  right_value integer check (right_value between 0 and 6),
  pass_count integer not null default 0 check (pass_count between 0 and 4),
  dealer_index integer not null default 0 check (dealer_index between 0 and 3),
  round_number integer not null default 0,
  last_message text not null default 'Waiting for players...',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add columns when upgrading from the small first-pass schema.
alter table public.domino_rooms add column if not exists left_value integer;
alter table public.domino_rooms add column if not exists right_value integer;
alter table public.domino_rooms add column if not exists pass_count integer not null default 0;
alter table public.domino_rooms add column if not exists dealer_index integer not null default 0;
alter table public.domino_rooms add column if not exists round_number integer not null default 0;
alter table public.domino_rooms add column if not exists updated_at timestamptz not null default now();

create table if not exists public.domino_room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.domino_rooms(id) on delete cascade,
  player_index integer not null check (player_index between 0 and 3),
  name text not null,
  team text not null check (team in ('A', 'B')),
  hand_count integer not null default 0 check (hand_count between 0 and 7),
  is_online boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (room_id, player_index)
);

-- Add public roster fields when upgrading the prototype table.
alter table public.domino_room_players add column if not exists hand_count integer not null default 0;
alter table public.domino_room_players add column if not exists is_online boolean not null default true;
alter table public.domino_room_players add column if not exists joined_at timestamptz not null default now();

-- The previous sample populated empty seats as fake "Waiting..." players. Remove those
-- placeholders so joins can claim genuinely vacant seats. Invalid legacy rows are not seats.
delete from public.domino_room_players
where name = 'Waiting...'
   or room_id is null
   or player_index is null
   or player_index not between 0 and 3;

update public.domino_room_players
set team = case when player_index in (0, 2) then 'A' else 'B' end
where team is null or team not in ('A', 'B');

-- Do not expose tile values through the public roster, even if the old prototype schema exists.
alter table public.domino_room_players drop column if exists hand;

create unique index if not exists domino_room_players_room_seat_idx
  on public.domino_room_players(room_id, player_index);
create index if not exists domino_rooms_room_code_idx
  on public.domino_rooms(room_code);

-- Capability token + hand are private. Browser clients can only obtain their own hand via RPC.
create table if not exists public.domino_private_players (
  player_id uuid primary key references public.domino_room_players(id) on delete cascade,
  access_token uuid not null unique default gen_random_uuid(),
  hand jsonb not null default '[]'::jsonb
);

alter table public.domino_rooms enable row level security;
alter table public.domino_room_players enable row level security;
alter table public.domino_private_players enable row level security;

-- Remove the permissive policies from the copy-paste prototype if they exist.
drop policy if exists "Allow all" on public.domino_rooms;
drop policy if exists "Allow all" on public.domino_room_players;
drop policy if exists "Room rows are readable" on public.domino_rooms;
drop policy if exists "Player roster is readable" on public.domino_room_players;

create policy "Room rows are readable"
  on public.domino_rooms for select to anon, authenticated using (true);
create policy "Player roster is readable"
  on public.domino_room_players for select to anon, authenticated using (true);

-- Public state is read-only from the browser. All writes go through validated RPC functions.
revoke all on table public.domino_rooms from public, anon, authenticated;
revoke all on table public.domino_room_players from public, anon, authenticated;
grant select on table public.domino_rooms to anon, authenticated;
grant select on table public.domino_room_players to anon, authenticated;
revoke all on table public.domino_private_players from public, anon, authenticated;

-- Realtime only publishes the safe room + roster tables. Never add the private hand table.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'The supabase_realtime publication was not found.';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'domino_rooms'
  ) then
    execute 'alter publication supabase_realtime add table public.domino_rooms';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'domino_room_players'
  ) then
    execute 'alter publication supabase_realtime add table public.domino_room_players';
  end if;
end $$;

-- Internal deal routine: shuffle the double-six set, hand out seven tiles each, and
-- open with the highest double. Its execute permission is revoked below.
create or replace function public.deal_domino_round(p_room_id uuid, p_dealer_index integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deck jsonb;
  v_hand jsonb;
  v_player record;
  v_position integer := 0;
  v_player_count integer;
  v_starter_id uuid;
  v_starter_index integer;
  v_starter_name text;
  v_open_tile jsonb;
  v_open_id integer;
  v_next_player_name text;
  v_round_number integer;
begin
  select count(*) into v_player_count
  from public.domino_room_players
  where room_id = p_room_id;

  if v_player_count <> 4 then
    raise exception 'A hand needs four seated players.';
  end if;

  select jsonb_agg(
    jsonb_build_object('id', tiles.id, 'a', tiles.a, 'b', tiles.b)
    order by random()
  ) into v_deck
  from (
    select (row_number() over (order by left_pip.value, right_pip.value) - 1)::integer as id,
           left_pip.value as a,
           right_pip.value as b
    from generate_series(0, 6) as left_pip(value)
    cross join generate_series(0, 6) as right_pip(value)
    where left_pip.value <= right_pip.value
  ) as tiles;

  for v_player in
    select id, player_index
    from public.domino_room_players
    where room_id = p_room_id
    order by ((player_index - p_dealer_index + 4) % 4)
  loop
    select coalesce(jsonb_agg(deck_tile.value order by deck_tile.ordinality), '[]'::jsonb)
      into v_hand
    from jsonb_array_elements(v_deck) with ordinality as deck_tile(value, ordinality)
    where deck_tile.ordinality > v_position * 7
      and deck_tile.ordinality <= (v_position + 1) * 7;

    update public.domino_private_players
    set hand = v_hand
    where player_id = v_player.id;

    if not found then
      raise exception 'A player session is missing. Recreate this room and invite all four players again.';
    end if;

    update public.domino_room_players
    set hand_count = jsonb_array_length(v_hand), is_online = true
    where id = v_player.id;

    v_position := v_position + 1;
  end loop;

  -- At least one double is guaranteed in a 28-tile set shared among four players.
  select player.id, player.player_index, player.name, tile.value
    into v_starter_id, v_starter_index, v_starter_name, v_open_tile
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  cross join lateral jsonb_array_elements(secret.hand) as tile(value)
  where player.room_id = p_room_id
    and (tile.value ->> 'a')::integer = (tile.value ->> 'b')::integer
  order by (tile.value ->> 'a')::integer desc
  limit 1;

  if not found then
    raise exception 'Could not find an opening double in the dealt hands.';
  end if;

  v_open_id := (v_open_tile ->> 'id')::integer;

  update public.domino_private_players as secret
  set hand = coalesce((
    select jsonb_agg(held.value order by held.ordinality)
    from jsonb_array_elements(secret.hand) with ordinality as held(value, ordinality)
    where (held.value ->> 'id')::integer <> v_open_id
  ), '[]'::jsonb)
  where secret.player_id = v_starter_id;

  update public.domino_room_players
  set hand_count = 6
  where id = v_starter_id;

  select name into v_next_player_name
  from public.domino_room_players
  where room_id = p_room_id
    and player_index = ((v_starter_index + 1) % 4);

  select round_number + 1 into v_round_number
  from public.domino_rooms
  where id = p_room_id;

  update public.domino_rooms
  set status = 'playing',
      board = jsonb_build_array(jsonb_build_object(
        'id', v_open_id,
        'a', (v_open_tile ->> 'a')::integer,
        'b', (v_open_tile ->> 'b')::integer,
        'played_by', v_starter_index
      )),
      left_value = (v_open_tile ->> 'a')::integer,
      right_value = (v_open_tile ->> 'b')::integer,
      current_turn = ((v_starter_index + 1) % 4),
      pass_count = 0,
      dealer_index = p_dealer_index,
      round_number = v_round_number,
      last_message = format(
        'Round %s begins. %s opens with %s–%s; %s is up next.',
        v_round_number,
        v_starter_name,
        v_open_tile ->> 'a',
        v_open_tile ->> 'b',
        coalesce(v_next_player_name, 'the next player')
      ),
      updated_at = now()
  where id = p_room_id;
end;
$$;

-- Resolve one completed/blocked hand. The lower combined team pip count earns the
-- difference; equal counts are a WASH. A WASH keeps the dealer for the next hand.
create or replace function public.resolve_domino_round(p_room_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a_count integer;
  v_b_count integer;
  v_a_score integer;
  v_b_score integer;
  v_dealer integer;
  v_delta integer := 0;
  v_wash boolean := false;
  v_status text;
  v_message text;
  v_context text;
begin
  select team_a_score, team_b_score, dealer_index
    into v_a_score, v_b_score, v_dealer
  from public.domino_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.';
  end if;

  select coalesce(sum((tile.value ->> 'a')::integer + (tile.value ->> 'b')::integer), 0)::integer
    into v_a_count
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  cross join lateral jsonb_array_elements(secret.hand) as tile(value)
  where player.room_id = p_room_id and player.team = 'A';

  select coalesce(sum((tile.value ->> 'a')::integer + (tile.value ->> 'b')::integer), 0)::integer
    into v_b_count
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  cross join lateral jsonb_array_elements(secret.hand) as tile(value)
  where player.room_id = p_room_id and player.team = 'B';

  v_context := case when upper(coalesce(p_reason, '')) = 'BLOCKED' then 'BLOCKED HAND' else 'HAND COMPLETE' end;

  if v_a_count = v_b_count then
    v_wash := true;
    v_message := format(
      'WASH! Both teams counted %s. Same count means no points; seat %s keeps the deal.',
      v_a_count,
      v_dealer + 1
    );
  elsif v_a_count < v_b_count then
    v_delta := v_b_count - v_a_count;
    v_a_score := v_a_score + v_delta;
    v_message := format(
      '%s — Team A wins the hand: %s vs %s pips. +%s points.',
      v_context, v_a_count, v_b_count, v_delta
    );
  else
    v_delta := v_a_count - v_b_count;
    v_b_score := v_b_score + v_delta;
    v_message := format(
      '%s — Team B wins the hand: %s vs %s pips. +%s points.',
      v_context, v_b_count, v_a_count, v_delta
    );
  end if;

  if v_a_score >= 100 or v_b_score >= 100 then
    v_status := 'finished';
    if v_a_score >= 100 then
      v_message := v_message || ' TEAM A WINS THE MATCH.';
    else
      v_message := v_message || ' TEAM B WINS THE MATCH.';
    end if;
  else
    v_status := 'round_over';
  end if;

  update public.domino_rooms
  set team_a_score = v_a_score,
      team_b_score = v_b_score,
      status = v_status,
      dealer_index = case when v_wash then v_dealer else ((v_dealer + 1) % 4) end,
      last_message = v_message,
      updated_at = now()
  where id = p_room_id;
end;
$$;

create or replace function public.create_domino_room(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_room_id uuid;
  v_player_id uuid;
  v_token uuid := gen_random_uuid();
  v_room_code text;
  v_attempt integer;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 24 then
    raise exception 'Enter a name between 1 and 24 characters.';
  end if;

  for v_attempt in 1..12 loop
    v_room_code := 'SA' || lpad((floor(random() * 10000))::integer::text, 4, '0');
    begin
      insert into public.domino_rooms (room_code, host_name, status, last_message)
      values (v_room_code, v_name, 'waiting', 'Room opened. Waiting for three more players.')
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_room_id := null;
    end;
  end loop;

  if v_room_id is null then
    raise exception 'Could not make a room code. Please try again.';
  end if;

  insert into public.domino_room_players (room_id, player_index, name, team, hand_count)
  values (v_room_id, 0, v_name, 'A', 0)
  returning id into v_player_id;

  insert into public.domino_private_players (player_id, access_token, hand)
  values (v_player_id, v_token, '[]'::jsonb);

  return jsonb_build_object(
    'room_id', v_room_id,
    'room_code', v_room_code,
    'player_id', v_player_id,
    'player_index', 0,
    'token', v_token
  );
end;
$$;

create or replace function public.join_domino_room(p_room_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_room public.domino_rooms%rowtype;
  v_player_id uuid;
  v_token uuid := gen_random_uuid();
  v_player_index integer;
  v_player_count integer;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 24 then
    raise exception 'Enter a name between 1 and 24 characters.';
  end if;

  select * into v_room
  from public.domino_rooms
  where room_code = upper(btrim(coalesce(p_room_code, '')))
  for update;

  if not found then
    raise exception 'Room not found. Check the code and try again.';
  end if;
  if v_room.status <> 'waiting' then
    raise exception 'This hand has already started. Join a room that is still waiting.';
  end if;

  select seat.index into v_player_index
  from generate_series(0, 3) as seat(index)
  where not exists (
    select 1 from public.domino_room_players as player
    where player.room_id = v_room.id and player.player_index = seat.index
  )
  order by seat.index
  limit 1;

  if v_player_index is null then
    raise exception 'Room full. All four seats are taken.';
  end if;

  insert into public.domino_room_players (room_id, player_index, name, team, hand_count)
  values (
    v_room.id,
    v_player_index,
    v_name,
    case when v_player_index in (0, 2) then 'A' else 'B' end,
    0
  )
  returning id into v_player_id;

  insert into public.domino_private_players (player_id, access_token, hand)
  values (v_player_id, v_token, '[]'::jsonb);

  select count(*) into v_player_count
  from public.domino_room_players
  where room_id = v_room.id;

  if v_player_count = 4 then
    perform public.deal_domino_round(v_room.id, 0);
  else
    update public.domino_rooms
    set last_message = format('%s joined. %s of 4 seats filled.', v_name, v_player_count),
        updated_at = now()
    where id = v_room.id;
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'room_code', v_room.room_code,
    'player_id', v_player_id,
    'player_index', v_player_index,
    'token', v_token
  );
end;
$$;

create or replace function public.get_domino_room(p_room_code text, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.domino_rooms%rowtype;
  v_player_id uuid;
  v_player_index integer;
  v_hand jsonb;
  v_players jsonb;
begin
  select * into v_room
  from public.domino_rooms
  where room_code = upper(btrim(coalesce(p_room_code, '')));

  if not found then
    raise exception 'Room not found.';
  end if;

  select player.id, player.player_index, secret.hand
    into v_player_id, v_player_index, v_hand
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  where player.room_id = v_room.id and secret.access_token = p_token;

  if not found then
    raise exception 'This player session is not valid for that room. Rejoin with a fresh seat.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', player.id,
    'player_index', player.player_index,
    'name', player.name,
    'team', player.team,
    'hand_count', player.hand_count,
    'is_online', player.is_online
  ) order by player.player_index), '[]'::jsonb)
  into v_players
  from public.domino_room_players as player
  where player.room_id = v_room.id;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'players', v_players,
    'my_hand', coalesce(v_hand, '[]'::jsonb),
    'my_player_index', v_player_index,
    'my_player_id', v_player_id
  );
end;
$$;

create or replace function public.play_domino(
  p_room_code text,
  p_token uuid,
  p_tile_id integer,
  p_side text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.domino_rooms%rowtype;
  v_player_id uuid;
  v_player_index integer;
  v_player_name text;
  v_hand jsonb;
  v_new_hand jsonb;
  v_tile jsonb;
  v_tile_a integer;
  v_tile_b integer;
  v_display_a integer;
  v_display_b integer;
  v_new_left integer;
  v_new_right integer;
  v_new_board jsonb;
  v_piece jsonb;
  v_next_player text;
begin
  select * into v_room
  from public.domino_rooms
  where room_code = upper(btrim(coalesce(p_room_code, '')))
  for update;

  if not found then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'This table is not accepting moves right now.'; end if;

  select player.id, player.player_index, player.name, secret.hand
    into v_player_id, v_player_index, v_player_name, v_hand
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  where player.room_id = v_room.id and secret.access_token = p_token;

  if not found then raise exception 'Player session not recognized.'; end if;
  if v_room.current_turn <> v_player_index then raise exception 'It is not your turn yet.'; end if;
  if p_side is null or p_side not in ('left', 'right') then raise exception 'Choose the left or right end.'; end if;

  select tile.value into v_tile
  from jsonb_array_elements(v_hand) as tile(value)
  where (tile.value ->> 'id')::integer = p_tile_id;

  if not found then raise exception 'That tile is not in your hand.'; end if;

  v_tile_a := (v_tile ->> 'a')::integer;
  v_tile_b := (v_tile ->> 'b')::integer;
  v_new_left := v_room.left_value;
  v_new_right := v_room.right_value;

  if p_side = 'left' then
    if v_tile_a = v_room.left_value then
      v_display_a := v_tile_b;
      v_display_b := v_tile_a;
      v_new_left := v_tile_b;
    elsif v_tile_b = v_room.left_value then
      v_display_a := v_tile_a;
      v_display_b := v_tile_b;
      v_new_left := v_tile_a;
    else
      raise exception 'That tile does not match the left end.';
    end if;
  else
    if v_tile_a = v_room.right_value then
      v_display_a := v_tile_a;
      v_display_b := v_tile_b;
      v_new_right := v_tile_b;
    elsif v_tile_b = v_room.right_value then
      v_display_a := v_tile_b;
      v_display_b := v_tile_a;
      v_new_right := v_tile_a;
    else
      raise exception 'That tile does not match the right end.';
    end if;
  end if;

  v_piece := jsonb_build_object(
    'id', p_tile_id,
    'a', v_display_a,
    'b', v_display_b,
    'played_by', v_player_index
  );
  if p_side = 'left' then
    v_new_board := jsonb_build_array(v_piece) || v_room.board;
  else
    v_new_board := v_room.board || jsonb_build_array(v_piece);
  end if;

  select coalesce(jsonb_agg(tile.value order by tile.ordinality), '[]'::jsonb)
    into v_new_hand
  from jsonb_array_elements(v_hand) with ordinality as tile(value, ordinality)
  where (tile.value ->> 'id')::integer <> p_tile_id;

  update public.domino_private_players
  set hand = v_new_hand
  where player_id = v_player_id;

  update public.domino_room_players
  set hand_count = jsonb_array_length(v_new_hand)
  where id = v_player_id;

  select name into v_next_player
  from public.domino_room_players
  where room_id = v_room.id
    and player_index = ((v_player_index + 1) % 4);

  update public.domino_rooms
  set board = v_new_board,
      left_value = v_new_left,
      right_value = v_new_right,
      current_turn = ((v_player_index + 1) % 4),
      pass_count = 0,
      last_message = format(
        '%s played %s–%s on the %s. %s is up next.',
        v_player_name, v_tile_a, v_tile_b, upper(p_side), coalesce(v_next_player, 'Next player')
      ),
      updated_at = now()
  where id = v_room.id;

  if jsonb_array_length(v_new_hand) = 0 then
    perform public.resolve_domino_round(v_room.id, 'went out');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pass_domino_turn(p_room_code text, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.domino_rooms%rowtype;
  v_player_id uuid;
  v_player_index integer;
  v_player_name text;
  v_hand jsonb;
  v_passes integer;
  v_next_player text;
begin
  select * into v_room
  from public.domino_rooms
  where room_code = upper(btrim(coalesce(p_room_code, '')))
  for update;

  if not found then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'This hand is not in progress.'; end if;

  select player.id, player.player_index, player.name, secret.hand
    into v_player_id, v_player_index, v_player_name, v_hand
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  where player.room_id = v_room.id and secret.access_token = p_token;

  if not found then raise exception 'Player session not recognized.'; end if;
  if v_room.current_turn <> v_player_index then raise exception 'It is not your turn yet.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(v_hand) as tile(value)
    where (tile.value ->> 'a')::integer in (v_room.left_value, v_room.right_value)
       or (tile.value ->> 'b')::integer in (v_room.left_value, v_room.right_value)
  ) then
    raise exception 'You have a playable tile. Play it instead of passing.';
  end if;

  v_passes := v_room.pass_count + 1;
  if v_passes >= 4 then
    update public.domino_rooms
    set pass_count = 4,
        last_message = 'Four consecutive passes. The hand is blocked.',
        updated_at = now()
    where id = v_room.id;
    perform public.resolve_domino_round(v_room.id, 'blocked');
  else
    select name into v_next_player
    from public.domino_room_players
    where room_id = v_room.id
      and player_index = ((v_player_index + 1) % 4);

    update public.domino_rooms
    set pass_count = v_passes,
        current_turn = ((v_player_index + 1) % 4),
        last_message = format('%s cannot play and passes (%s of 4). %s is up next.', v_player_name, v_passes, coalesce(v_next_player, 'Next player')),
        updated_at = now()
    where id = v_room.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.start_next_domino_round(p_room_code text, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.domino_rooms%rowtype;
  v_player_index integer;
begin
  select * into v_room
  from public.domino_rooms
  where room_code = upper(btrim(coalesce(p_room_code, '')))
  for update;

  if not found then raise exception 'Room not found.'; end if;
  if v_room.status <> 'round_over' then raise exception 'The next hand is not ready to deal.'; end if;

  select player.player_index into v_player_index
  from public.domino_room_players as player
  join public.domino_private_players as secret on secret.player_id = player.id
  where player.room_id = v_room.id and secret.access_token = p_token;

  if not found then raise exception 'Player session not recognized.'; end if;
  if v_player_index <> 0 then raise exception 'Only the room host in seat 1 can deal the next hand.'; end if;

  perform public.deal_domino_round(v_room.id, v_room.dealer_index);
  return jsonb_build_object('ok', true);
end;
$$;

-- Do not expose internal helpers through PostgREST RPC.
revoke all on function public.deal_domino_round(uuid, integer) from public, anon, authenticated;
revoke all on function public.resolve_domino_round(uuid, text) from public, anon, authenticated;

-- Browser-facing operations are capability-checked and perform all writes transactionally.
revoke all on function public.create_domino_room(text) from public, anon, authenticated;
revoke all on function public.join_domino_room(text, text) from public, anon, authenticated;
revoke all on function public.get_domino_room(text, uuid) from public, anon, authenticated;
revoke all on function public.play_domino(text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.pass_domino_turn(text, uuid) from public, anon, authenticated;
revoke all on function public.start_next_domino_round(text, uuid) from public, anon, authenticated;

grant execute on function public.create_domino_room(text) to anon, authenticated;
grant execute on function public.join_domino_room(text, text) to anon, authenticated;
grant execute on function public.get_domino_room(text, uuid) to anon, authenticated;
grant execute on function public.play_domino(text, uuid, integer, text) to anon, authenticated;
grant execute on function public.pass_domino_turn(text, uuid) to anon, authenticated;
grant execute on function public.start_next_domino_round(text, uuid) to anon, authenticated;

-- Make the newly added RPC functions visible to PostgREST without waiting for a cache refresh.
notify pgrst, 'reload schema';
