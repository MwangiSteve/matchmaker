-- Matchmaker database schema (PostgreSQL 13+; works on Supabase and Neon).
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql   (safe to re-run)
--
-- Live tables the app reads and writes:
--   categories, pros, pro_services, customers, requests, jobs, reviews
-- Learning tables (the model's future training data):
--   match_impressions  which pros we showed, in what order, with what features
--   lead_responses     which shown pros replied to the lead
-- Derived:
--   pro_stats          per-pro numbers the matcher uses (rating, reply time...)

set client_min_messages = warning;

create table if not exists categories (
  slug            text primary key,            -- must match CATEGORIES in matchmaker/world.py and node/src/matcher.js
  name            text not null,
  base_price_kes  integer not null check (base_price_kes > 0)
);

insert into categories (slug, name, base_price_kes) values
  ('plumbing',         'Plumbing',          2500),
  ('electrical',       'Electrical',        3000),
  ('cleaning',         'Cleaning',          1500),
  ('painting',         'Painting',          8000),
  ('carpentry',        'Carpentry',         5000),
  ('appliance_repair', 'Appliance repair',  3500),
  ('moving',           'Moving',           10000)
on conflict (slug) do nothing;

create table if not exists pros (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  phone            text not null unique,      -- +2547XXXXXXXX
  area             text,                      -- estate, e.g. 'Kilimani'
  lat              double precision not null check (lat between -90 and 90),
  lon              double precision not null check (lon between -180 and 180),
  max_travel_min   integer not null default 60 check (max_travel_min between 10 and 240),
  verified         boolean not null default false,   -- ID / KRA PIN / licence checked
  is_active        boolean not null default true,    -- false = suspended or left
  away_until       timestamptz,                      -- pro marked themselves unavailable
  last_active_at   timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists pros_lat_lon on pros (lat, lon) where is_active;

create table if not exists pro_services (
  pro_id             uuid not null references pros(id) on delete cascade,
  category           text not null references categories(slug),
  typical_price_kes  integer check (typical_price_kes > 0),  -- null = use category base price
  primary key (pro_id, category)
);
create index if not exists pro_services_category on pro_services (category);

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text,
  phone       text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists requests (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id),
  category     text not null references categories(slug),
  area         text,
  lat          double precision not null,
  lon          double precision not null,
  urgency      text not null check (urgency in ('now', 'this_week', 'flexible')),
  budget_kes   integer not null check (budget_kes > 0),
  has_photos   boolean not null default false,
  description  text,
  created_at   timestamptz not null default now()
);
create index if not exists requests_customer on requests (customer_id);

-- One row per pro shown for a request. `features` is the exact input the
-- ranker saw, so training later uses what was known at the time.
create table if not exists match_impressions (
  request_id  uuid not null references requests(id) on delete cascade,
  pro_id      uuid not null references pros(id),
  position    smallint not null check (position >= 0),
  score       double precision not null,
  source      text not null,                -- 'model' | 'heuristic'
  features    jsonb not null,
  shown_at    timestamptz not null default now(),
  primary key (request_id, pro_id)
);
create index if not exists match_impressions_pro on match_impressions (pro_id, shown_at);

create table if not exists lead_responses (
  request_id    uuid not null,
  pro_id        uuid not null,
  quote_kes     integer check (quote_kes > 0),
  message       text,
  responded_at  timestamptz not null default now(),
  primary key (request_id, pro_id),
  foreign key (request_id, pro_id) references match_impressions(request_id, pro_id) on delete cascade
);

create table if not exists jobs (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null unique references requests(id),  -- one hire per request
  pro_id            uuid not null references pros(id),
  customer_id       uuid references customers(id),
  agreed_price_kes  integer check (agreed_price_kes > 0),
  status            text not null default 'hired'
                    check (status in ('hired', 'completed', 'cancelled', 'disputed')),
  hired_at          timestamptz not null default now(),
  completed_at      timestamptz
);
create index if not exists jobs_pro on jobs (pro_id);
create index if not exists jobs_customer on jobs (customer_id);

create table if not exists reviews (
  job_id      uuid primary key references jobs(id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now()
);

-- Per-pro stats used for matching. A plain view is fine for thousands of
-- pros; switch to a materialized view refreshed every few minutes later.
create or replace view pro_stats as
select
  p.id as pro_id,
  coalesce(j.completed, 0)::int                              as jobs_done,
  coalesce(r.n_reviews, 0)::int                              as n_reviews,
  r.avg_stars                                                as rating,
  case when j.finished > 0 then j.completed::float / j.finished end as completion_rate,
  resp.median_reply_min                                      as reply_min,
  case when imp.shown > 0 then coalesce(resp.n, 0)::float / imp.shown end as acceptance_rate,
  (extract(epoch from now() - p.last_active_at) / 86400.0)::float as last_active_days
from pros p
left join (
  select pro_id,
         count(*) filter (where status = 'completed') as completed,
         count(*) filter (where status in ('completed', 'cancelled', 'disputed')) as finished
  from jobs group by pro_id
) j on j.pro_id = p.id
left join (
  select jb.pro_id, count(*) as n_reviews, avg(rv.stars)::float as avg_stars
  from reviews rv join jobs jb on jb.id = rv.job_id group by jb.pro_id
) r on r.pro_id = p.id
left join (
  select pro_id, count(*) as shown from match_impressions group by pro_id
) imp on imp.pro_id = p.id
left join (
  select lr.pro_id, count(*) as n,
         percentile_cont(0.5) within group (
           order by greatest(extract(epoch from lr.responded_at - mi.shown_at)::float / 60.0, 1)
         ) as median_reply_min
  from lead_responses lr
  join match_impressions mi using (request_id, pro_id)
  group by lr.pro_id
) resp on resp.pro_id = p.id;
