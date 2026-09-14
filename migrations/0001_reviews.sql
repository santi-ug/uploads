CREATE TABLE reviews (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'revoked')),
  expires_at INTEGER NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES reviews(slug),
  parent_id TEXT REFERENCES comments(id),
  revision TEXT NOT NULL,
  quote TEXT NOT NULL,
  selector TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL,
  actor_hash TEXT NOT NULL
);
CREATE INDEX comments_document ON comments(slug, created_at);
CREATE INDEX comments_rate ON comments(slug, actor_hash, created_at);
