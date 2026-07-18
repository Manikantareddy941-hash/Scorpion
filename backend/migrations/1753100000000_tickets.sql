-- Up Migration
-- Tickets, plus the three things that until now lived in module-level JS Maps
-- (comments, activity, links) and were silently lost on every process restart.
--
-- Tickets use the document-table bridge because callers consume the Appwrite
-- document shape. updated_at is a real column rather than a JSONB field: the
-- ticket list sorts on it, and mapDocumentToTicket reads Appwrite's $updatedAt.
CREATE TABLE IF NOT EXISTS tickets (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets ((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets ((data->>'assignee'));
-- findByLinkedFinding filters on membership in the linkedFindings array.
CREATE INDEX IF NOT EXISTS idx_tickets_linked_findings ON tickets USING GIN ((data->'linkedFindings'));

-- ON DELETE CASCADE is the point: deleteTicket previously cleared the comment
-- and activity Maps by hand and forgot the link Map entirely, leaving links
-- pointing at tickets that no longer exist. The database enforces it now.
CREATE TABLE IF NOT EXISTS ticket_comments (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  author     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_activity (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  type       TEXT NOT NULL,
  details    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_activity_ticket ON ticket_activity (ticket_id, created_at);

-- One row per direction; addLink writes both, so deleting a ticket must remove
-- the rows pointing *at* it as well — hence the second cascading FK.
CREATE TABLE IF NOT EXISTS ticket_links (
  ticket_id        TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  linked_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  PRIMARY KEY (ticket_id, linked_ticket_id, type)
);

-- Down Migration
DROP TABLE IF EXISTS ticket_links;
DROP TABLE IF EXISTS ticket_activity;
DROP TABLE IF EXISTS ticket_comments;
DROP TABLE IF EXISTS tickets;
