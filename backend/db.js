const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// Returns { created: true } for a new subscriber, { created: false } if the
// email was already on the list (not an error — treated as idempotent).
async function addSubscriber(email) {
  const result = await pool.query(
    `INSERT INTO subscribers (email) VALUES ($1)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email.toLowerCase().trim()]
  );
  return { created: result.rowCount > 0 };
}

module.exports = { pool, initDb, addSubscriber };
