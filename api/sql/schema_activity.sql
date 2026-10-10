-- Additive migration; guest publishers are separate from login accounts.
CREATE TABLE IF NOT EXISTS activity_publishers (
  token_hash CHAR(64) PRIMARY KEY,
  public_id CHAR(24) NOT NULL UNIQUE,
  nickname VARCHAR(80) NOT NULL DEFAULT '',
  avatar_id VARCHAR(40) NULL,
  sharing TINYINT NOT NULL DEFAULT 0,
  started_at BIGINT NOT NULL DEFAULT 0,
  event_revision BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_events (
  id CHAR(32) PRIMARY KEY,
  publisher_hash CHAR(64) NOT NULL,
  event_key VARCHAR(80) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  detail VARCHAR(50) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY activity_once (publisher_hash, event_key),
  KEY activity_recent (created_at),
  CONSTRAINT activity_owner FOREIGN KEY (publisher_hash) REFERENCES activity_publishers(token_hash) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS activity_rate_limits (
  bucket CHAR(64) PRIMARY KEY,
  hits INT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL
);
