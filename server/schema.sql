-- =====================================================================
-- PRANAV OS — full schema (designed once, covers all 12 pages + 10 flows)
-- Postgres 14+. Single-user system, but user_id kept for future-proofing.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- CORE: domains, goal tree
-- ---------------------------------------------------------------------
CREATE TABLE domains (
    id          SERIAL PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,          -- 'research','trading','startup','uni','tech','gym','internship'
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,                 -- plane color hex, e.g. '#3F6B52'
    floor_type  TEXT NOT NULL DEFAULT 'sessions_per_window',  -- sessions_per_window | minutes_per_window | ship_steps | ramp | none
    floor_target INT,                          -- e.g. 5 (sessions)
    floor_window_days INT DEFAULT 7,           -- rolling window
    floor_minutes INT,                         -- per-session minutes where relevant
    sort_order  INT DEFAULT 0,
    active      BOOLEAN DEFAULT TRUE
);

CREATE TABLE goals (
    id          SERIAL PRIMARY KEY,
    parent_id   INT REFERENCES goals(id) ON DELETE CASCADE,
    domain_id   INT REFERENCES domains(id),
    horizon     TEXT NOT NULL,                 -- year | quarter | month | week
    title       TEXT NOT NULL,
    detail      TEXT,
    due_date    DATE,
    status      TEXT NOT NULL DEFAULT 'active',-- active | done | dropped
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- PLANNING: days, blocks (the composition), fixed constraints
-- ---------------------------------------------------------------------
CREATE TABLE days (
    id            SERIAL PRIMARY KEY,
    date          DATE UNIQUE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'draft',  -- draft | confirmed | closed
    wake_target   TIME,
    close_target  TIME,                            -- computed by sleep engine
    energy_note   TEXT,                            -- 'light morning: 5h40 sleep'
    brief_sent_at TIMESTAMPTZ,
    confirmed_at  TIMESTAMPTZ,
    closed_at     TIMESTAMPTZ,
    tile_path     TEXT,                            -- rendered composition tile image
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE blocks (
    id           SERIAL PRIMARY KEY,
    day_id       INT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
    domain_id    INT REFERENCES domains(id),
    goal_id      INT REFERENCES goals(id),
    title        TEXT NOT NULL,
    next_action  TEXT,                          -- the smallest 2-minute entry
    start_at     TIMESTAMPTZ NOT NULL,
    end_at       TIMESTAMPTZ NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'work',  -- work | fixed | reward | nap | protocol | buffer_hold
    is_fixed     BOOLEAN DEFAULT FALSE,         -- immovable (class, meeting)
    playlist_url TEXT,
    status       TEXT NOT NULL DEFAULT 'planned', -- planned | started | done | skipped | sacrificed
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ,
    skip_reason  TEXT,
    sacrificed_to TEXT,                         -- replan note: what displaced it / where it moved
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_blocks_day ON blocks(day_id);
CREATE INDEX idx_blocks_start ON blocks(start_at);

CREATE TABLE closeouts (
    id         SERIAL PRIMARY KEY,
    block_id   INT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    stopped_at TEXT NOT NULL,                   -- 'fixed tile cache bug'
    next_step  TEXT,                            -- 'test with telangana dataset, push'
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE replans (
    id         SERIAL PRIMARY KEY,
    day_id     INT REFERENCES days(id),
    trigger    TEXT NOT NULL,                   -- user's one sentence
    diff       JSONB NOT NULL,                  -- {moved:[], sacrificed:[], added:[]}
    accepted   BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- COMMITMENTS: if-then triggers, deadlines with lead-time nudges
-- ---------------------------------------------------------------------
CREATE TABLE commitments (
    id            SERIAL PRIMARY KEY,
    domain_id     INT REFERENCES domains(id),
    title         TEXT NOT NULL,
    trigger_event TEXT,                         -- 'after dinner close' (if-then anchor)
    due_date      DATE,                         -- deadline mode
    lead_days     INT[] DEFAULT '{28,7,2}',     -- nudge schedule before due_date
    status        TEXT NOT NULL DEFAULT 'open', -- open | done | dropped
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- CAPTURE & LIBRARY (Notes/Ideas/Prompts/Reading/Reels/Files/Meetings)
-- ---------------------------------------------------------------------
CREATE TABLE inbox_items (
    id          SERIAL PRIMARY KEY,
    raw         TEXT,                           -- original text / caption
    tg_file_id  TEXT,                           -- telegram file/voice/photo id
    kind_guess  TEXT,                           -- classifier output
    routed_to   TEXT,                           -- library section / list / commitment ...
    routed_id   INT,
    triaged     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE library_items (
    id           SERIAL PRIMARY KEY,
    section      TEXT NOT NULL,                 -- note | idea | prompt | reading | reel | file | meeting
    domain_id    INT REFERENCES domains(id),
    title        TEXT NOT NULL,
    body         TEXT,
    url          TEXT,
    tg_file_id   TEXT,
    tags         TEXT[] DEFAULT '{}',
    est_minutes  INT,                           -- reading time estimate
    idea_status  TEXT,                          -- raw | reviewed | scheduled | killed (ideas only)
    resurface_at TIMESTAMPTZ,                   -- when it comes back
    surfaced_ct  INT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_library_section ON library_items(section);

CREATE TABLE meetings (
    id            SERIAL PRIMARY KEY,
    library_id    INT REFERENCES library_items(id),
    name          TEXT NOT NULL,
    started_at    TIMESTAMPTZ DEFAULT now(),
    ended_at      TIMESTAMPTZ,
    summary       TEXT,
    action_items  JSONB DEFAULT '[]'            -- [{text, mine, done, block_id}]
);

-- ---------------------------------------------------------------------
-- LISTS with contextual firing
-- ---------------------------------------------------------------------
CREATE TABLE lists (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,                  -- 'going-home', 'weekly-buy'
    fire_rule   TEXT,                           -- natural language: 'when a home trip enters the plan'
    fire_kind   TEXT DEFAULT 'manual',          -- manual | plan_event | weekly_day
    fire_param  TEXT,                           -- e.g. 'saturday' for weekly_day
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE list_items (
    id       SERIAL PRIMARY KEY,
    list_id  INT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text     TEXT NOT NULL,
    checked  BOOLEAN DEFAULT FALSE,
    sort     INT DEFAULT 0
);

-- ---------------------------------------------------------------------
-- SLEEP & ENERGY & WAKE PROTOCOL
-- ---------------------------------------------------------------------
CREATE TABLE sleep_logs (
    id         SERIAL PRIMARY KEY,
    date       DATE UNIQUE NOT NULL,            -- the morning's date
    slept_at   TIMESTAMPTZ,
    woke_at    TIMESTAMPTZ,
    hours      NUMERIC(4,2),
    debt_after NUMERIC(5,2),                    -- rolling ledger after this night
    nap_minutes INT DEFAULT 0
);

CREATE TABLE protocol_steps (
    id       SERIAL PRIMARY KEY,
    sort     INT NOT NULL,
    text     TEXT NOT NULL,                     -- 'drink water', '10 pushups'
    active   BOOLEAN DEFAULT TRUE,
    essential BOOLEAN DEFAULT FALSE             -- survives the shortened low-sleep protocol
);

CREATE TABLE protocol_runs (
    id         SERIAL PRIMARY KEY,
    date       DATE UNIQUE NOT NULL,
    steps_done INT DEFAULT 0,
    steps_total INT NOT NULL,
    completed  BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ
);

CREATE TABLE energy_observations (
    id         SERIAL PRIMARY KEY,
    hour       INT NOT NULL,                    -- 0-23
    kind       TEXT NOT NULL,                   -- deep_done | deep_failed | shallow_done
    weight     NUMERIC(3,2) DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- EXECUTION: nudges, check-ins, reward protocol (netflix/eating)
-- ---------------------------------------------------------------------
CREATE TABLE nudges (
    id          SERIAL PRIMARY KEY,
    block_id    INT REFERENCES blocks(id),
    kind        TEXT NOT NULL,                  -- block_start | escalation | checkin | list_fire | deadline | protocol | close
    message     TEXT NOT NULL,
    sent_at     TIMESTAMPTZ DEFAULT now(),
    response    TEXT,                           -- what he replied (null = ignored)
    responded_at TIMESTAMPTZ
);
CREATE INDEX idx_nudges_kind ON nudges(kind);

CREATE TABLE reward_sessions (
    id           SERIAL PRIMARY KEY,
    kind         TEXT NOT NULL DEFAULT 'netflix',
    committed    TEXT NOT NULL,                 -- '2 episodes'
    committed_min INT NOT NULL,                 -- 100
    started_at   TIMESTAMPTZ DEFAULT now(),
    checkin_at   TIMESTAMPTZ,                   -- when the check-in fired
    outcome      TEXT                           -- stopped | extended | ignored
);

-- ---------------------------------------------------------------------
-- FINANCE
-- ---------------------------------------------------------------------
CREATE TABLE finance_entries (
    id         SERIAL PRIMARY KEY,
    amount     NUMERIC(12,2) NOT NULL,
    category   TEXT NOT NULL,                   -- food | transport | subscriptions | ...
    note       TEXT,
    spent_on   DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE subscriptions (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    amount      NUMERIC(12,2),
    renews_on   DATE,
    period      TEXT DEFAULT 'monthly',
    active      BOOLEAN DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- VAULT (values encrypted app-side with a key NOT stored in this DB)
-- ---------------------------------------------------------------------
CREATE TABLE vault_entries (
    id          SERIAL PRIMARY KEY,
    label       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'pointer',-- pointer (to Bitwarden) | encrypted
    pointer     TEXT,                           -- 'Bitwarden > telangana-staging'
    ciphertext  BYTEA,                          -- AES-GCM, app-side key
    nonce       BYTEA,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vault_access_log (
    id        SERIAL PRIMARY KEY,
    entry_id  INT REFERENCES vault_entries(id),
    accessed_at TIMESTAMPTZ DEFAULT now(),
    surface   TEXT                              -- bot | cockpit
);

-- ---------------------------------------------------------------------
-- INTELLIGENCE: rules/preferences, learned patterns, decisions
-- ---------------------------------------------------------------------
CREATE TABLE rules (
    id          SERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,                  -- preference | learned | config
    rule_text   TEXT NOT NULL,                  -- 'no hard work before 11'
    source      TEXT NOT NULL DEFAULT 'explicit',-- explicit | pattern_approved
    approved_at TIMESTAMPTZ DEFAULT now(),
    active      BOOLEAN DEFAULT TRUE
);

CREATE TABLE pattern_proposals (
    id          SERIAL PRIMARY KEY,
    observation TEXT NOT NULL,                  -- 'tech-learning died both times after 22:00'
    proposal    TEXT NOT NULL,                  -- 'move it to the 13:00 class gap'
    status      TEXT NOT NULL DEFAULT 'pending',-- pending | approved | rejected
    decided_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE decisions (
    id         SERIAL PRIMARY KEY,
    topic      TEXT NOT NULL,                   -- 'newsletter stack'
    decision   TEXT NOT NULL,
    context    TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- REVIEWS
-- ---------------------------------------------------------------------
CREATE TABLE reviews (
    id          SERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,                  -- weekly | monthly | quarterly
    period_start DATE NOT NULL,
    period_end  DATE NOT NULL,
    scorecard   JSONB,                          -- floors snapshot
    notes       TEXT,
    completed   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- CHAT MEMORY (bot + talk room share this)
-- ---------------------------------------------------------------------
CREATE TABLE chat_messages (
    id         BIGSERIAL PRIMARY KEY,
    surface    TEXT NOT NULL DEFAULT 'bot',     -- bot | talk
    role       TEXT NOT NULL,                   -- user | assistant | system_event
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_chat_created ON chat_messages(created_at);

-- ---------------------------------------------------------------------
-- SETTINGS: key/value (owner_chat_id, cadence prefs, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- SEED: the 7 domains with plane colors + default floors
-- ---------------------------------------------------------------------
INSERT INTO domains (slug, name, color, floor_type, floor_target, floor_window_days, floor_minutes, sort_order) VALUES
('internship','Internship',   '#8C3A2E', 'none',                NULL, 7,  NULL, 1),
('research',  'Masters & Research','#3F6B52','sessions_per_window',3, 7,  90,  2),
('trading',   'Trading',      '#3E5F86', 'sessions_per_window', 5,  7,  60,  3),
('startup',   'Startup',      '#8A6642', 'ship_steps',          4,  7,  NULL,4),
('uni',       'University',   '#565C66', 'none',                NULL,7,  NULL,5),
('tech',      'Tech Learning','#A5822B', 'sessions_per_window', 5,  7,  35,  6),
('gym',       'Gym / Health', '#6E4A72', 'ramp',                7,  7,  NULL,7);

