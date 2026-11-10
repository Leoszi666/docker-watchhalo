import pg from "pg";

const { Pool } = pg;

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
    // Without this listener a background client error (e.g. Postgres
    // restarting) would crash the whole process.
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

export async function initDb() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id            SERIAL PRIMARY KEY,
      host_name     TEXT        NOT NULL,
      tag           TEXT        NOT NULL,
      note          TEXT        NOT NULL,
      running_count INT         NOT NULL,
      total_count   INT         NOT NULL,
      containers    JSONB       NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function insertSnapshot({
  hostName,
  tag,
  note,
  runningCount,
  totalCount,
  containers,
}) {
  const result = await getPool().query(
    `INSERT INTO snapshots
       (host_name, tag, note, running_count, total_count, containers, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     RETURNING id, host_name, tag, note, running_count, total_count, containers, created_at`,
    [hostName, tag, note, runningCount, totalCount, JSON.stringify(containers)]
  );
  return mapRow(result.rows[0]);
}

export async function listSnapshots(limit = 20) {
  const result = await getPool().query(
    `SELECT id, host_name, tag, note, running_count, total_count, containers, created_at
     FROM snapshots
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map(mapRow);
}

/** Cheap connectivity probe used by GET /health. */
export async function checkDb() {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

function mapRow(row) {
  return {
    id: row.id,
    hostName: row.host_name,
    tag: row.tag,
    note: row.note,
    runningCount: row.running_count,
    totalCount: row.total_count,
    containers: row.containers ?? [],
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}
