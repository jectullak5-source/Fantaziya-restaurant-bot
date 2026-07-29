import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.isProduction ? { rejectUnauthorized: false } : false,
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool xatosi:", error.message);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createUsersTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      username VARCHAR(255),
      language_code VARCHAR(10),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function initDatabase() {
  const client = await pool.connect();

  try {
    const result = await client.query("SELECT NOW() AS now");
    console.log("PostgreSQL muvaffaqiyatli ulandi:", result.rows[0].now);
  } finally {
    client.release();
  }

  await createUsersTable();
  console.log("Baza jadvallari tayyor.");
}

export async function upsertUser(telegramUser) {
  const { id, first_name, last_name, username, language_code } = telegramUser;

  const result = await query(
    `
    INSERT INTO users (telegram_id, first_name, last_name, username, language_code)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      username = EXCLUDED.username,
      language_code = EXCLUDED.language_code,
      updated_at = NOW()
    RETURNING *;
    `,
    [id, first_name ?? null, last_name ?? null, username ?? null, language_code ?? null]
  );

  return result.rows[0];
}
