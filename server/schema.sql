CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY);
INSERT INTO schema_version VALUES (2) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login text NOT NULL UNIQUE,
  name text NOT NULL,
  department text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('employee','manager','hr','director')),
  manager_id integer REFERENCES users(id),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CHECK (manager_id IS NULL OR manager_id <> id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS plans (
  year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2200),
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'открыт' CHECK (status IN ('открыт','согласован_кадрами','утвержден')),
  hr_by integer REFERENCES users(id),
  hr_at timestamptz,
  director_by integer REFERENCES users(id),
  director_at timestamptz
);

CREATE TABLE IF NOT EXISTS requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  year integer NOT NULL REFERENCES plans(year),
  periods jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('отправлено','согласовано','пересмотр')),
  comment text NOT NULL DEFAULT '',
  manager_by integer REFERENCES users(id),
  manager_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, year)
);

CREATE TABLE IF NOT EXISTS conflict_decisions (
  year integer NOT NULL REFERENCES plans(year),
  key text NOT NULL,
  comment text NOT NULL,
  actor_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(year, key)
);

CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY,
  actor_id integer REFERENCES users(id),
  year integer,
  request_id integer,
  action text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_year ON audit(year, id DESC);

CREATE TABLE IF NOT EXISTS plan_snapshots (
  id bigserial PRIMARY KEY,
  year integer NOT NULL REFERENCES plans(year),
  revision integer NOT NULL,
  kind text NOT NULL,
  actor_id integer NOT NULL REFERENCES users(id),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
