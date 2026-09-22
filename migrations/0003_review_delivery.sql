ALTER TABLE comments ADD COLUMN delivery_id TEXT;
CREATE TABLE review_deliveries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES reviews(slug),
  comment_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','delivered'))
);
CREATE INDEX review_delivery_queue ON review_deliveries(slug,status,created_at);
CREATE TABLE review_agents (
  slug TEXT PRIMARY KEY REFERENCES reviews(slug),
  relay_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
