-- PREVIEW ONLY: Do not run against production without a DPIA, user notice and
-- authenticated per-user consent. No free-text or sensitive content columns.
-- The app's authenticated server derives subject_key using HMAC(userId, secret).
CREATE TABLE IF NOT EXISTS analytics_consent (
  subject_key TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY NOT NULL,
  subject_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_day TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(subject_key) REFERENCES analytics_consent(subject_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_analytics_event_day ON analytics_events(event_day,event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_subject ON analytics_events(subject_key,occurred_at);

-- Enforce deletion after 90 days through a scheduled task:
-- DELETE FROM analytics_events WHERE occurred_at < datetime('now','-90 days');
-- A user's consent withdrawal or account deletion must DELETE their events.
-- No analytics event storage while consent=0.
