-- Last-applied client sequence number per synced entity. Lets the server ignore
-- older queued writes (and re-delivered ones) so they can never overwrite newer edits,
-- including edits that deleted the entity.
CREATE TABLE sync_state (
  entity_key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
