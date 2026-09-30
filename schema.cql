-- The whole data model. The server creates this at boot (CREATE ... IF NOT EXISTS); the file is here to read.
-- Single node in dev, so replication_factor 1. At RF=3 the same statements run with 'replication_factor': 3
-- and LOCAL_QUORUM means 2 of 3 replicas must acknowledge a write.

CREATE KEYSPACE IF NOT EXISTS beacon
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

-- One partition per public-key hash, rows ordered newest first. A 7-day TTL is set on every write
-- so old sightings vanish without a delete job. Ciphertext is opaque to the server.
CREATE TABLE IF NOT EXISTS beacon.reports (
  key_hash   blob,
  ts         timeuuid,
  ciphertext blob,
  PRIMARY KEY (key_hash, ts)
) WITH CLUSTERING ORDER BY (ts DESC) AND default_time_to_live = 604800;

-- One partition per share id, one row per 15-minute epoch, holding only the public key.
-- 48-hour TTL: the owner republishes whenever the page is open, so a stale schedule fades out on its own.
CREATE TABLE IF NOT EXISTS beacon.schedules (
  share_id   text,
  epoch      bigint,
  public_key blob,
  PRIMARY KEY (share_id, epoch)
) WITH default_time_to_live = 172800;

-- Written by the elected sweeper every 30 seconds: how many reports landed in each 15-minute epoch, and
-- which replica counted them. One row per epoch; the sweep overwrites it.
CREATE TABLE IF NOT EXISTS beacon.stats (
  epoch     bigint PRIMARY KEY,
  reports   int,
  swept_at  timestamp,
  swept_by  text
) WITH default_time_to_live = 604800;
