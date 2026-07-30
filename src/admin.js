import { query } from "./database.js";
import { config } from "./config.js";

const addItemSessions = new Map();

async function createAdminsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      full_name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedInitialAdmins() {
  for (const telegramId of config.adminTelegramIds) {
    await query(
      `INSERT INTO admins (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING;`,
      [telegramId]
    );
  }
}

export async function initAdminTables() {
  await createAdminsTable();
  await seedInitialAdmins();

  console.log("Admin jadvali tayyor.");
}

export async function isAdmin(telegramId) {
  const result = await query("SELECT 1 FROM admins WHERE telegram_id = $1;", [telegramId]);
  return result.rowCount > 0;
}

export async function addAdminByTelegramId(telegramId, fullName) {
  const result = await query(
    `
    INSERT INTO admins (telegram_id, full_name)
    VALUES ($1, $2)
    ON CONFLICT (telegram_id) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING *;
    `,
    [telegramId, fullName ?? null]
  );

  return result.rows[0];
}

export async function listAdmins() {
  const result = await query("SELECT * FROM admins ORDER BY created_at ASC;");
  return result.rows;
}

export async function getOrderStatistics() {
  const totals = await query(`
    SELECT COUNT(*)::int AS total_orders, COALESCE(SUM(total_price), 0)::numeric AS total_revenue
    FROM orders
    WHERE status != 'cancelled';
  `);

  const today = await query(`
    SELECT COUNT(*)::int AS today_orders, COALESCE(SUM(total_price), 0)::numeric AS today_revenue
    FROM orders
    WHERE status != 'cancelled' AND created_at::date = CURRENT_DATE;
  `);

  const statusBreakdown = await query(`
    SELECT status, COUNT(*)::int AS count
    FROM orders
    GROUP BY status
    ORDER BY status;
  `);

  return {
    totalOrders: totals.rows[0].total_orders,
    totalRevenue: Number(totals.rows[0].total_revenue),
    todayOrders: today.rows[0].today_orders,
    todayRevenue: Number(today.rows[0].today_revenue),
    statusBreakdown: statusBreakdown.rows,
  };
}

export async function getRecentOrders(limit = 10) {
  const result = await query(
    `
    SELECT o.id, o.status, o.total_price, o.phone_number, o.created_at,
           u.first_name, u.username
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.is_archived = FALSE
    ORDER BY o.created_at DESC
    LIMIT $1;
    `,
    [limit]
  );

  return result.rows;
}

export async function getUpcomingReservationsCount() {
  const result = await query(`
    SELECT COUNT(*)::int AS count
    FROM reservations
    WHERE status != 'cancelled'
      AND (reservation_date > CURRENT_DATE
        OR (reservation_date = CURRENT_DATE AND reservation_time >= CURRENT_TIME));
  `);

  return result.rows[0].count;
}

export async function getRecentReservations(limit = 10) {
  const result = await query(
    `
    SELECT r.id, r.reservation_date, r.reservation_time, r.guests_count, r.phone_number,
           r.status, u.first_name, u.username
    FROM reservations r
    JOIN users u ON u.id = r.user_id
    WHERE r.status != 'cancelled'
      AND r.is_archived = FALSE
      AND (r.reservation_date > CURRENT_DATE
        OR (r.reservation_date = CURRENT_DATE AND r.reservation_time >= CURRENT_TIME))
    ORDER BY r.reservation_date ASC, r.reservation_time ASC
    LIMIT $1;
    `,
    [limit]
  );

  return result.rows;
}

export function getAddItemSession(chatId) {
  return addItemSessions.get(chatId) ?? null;
}

export function startAddItemSession(chatId) {
  addItemSessions.set(chatId, { step: "awaiting_category" });
}

export function updateAddItemSession(chatId, updates) {
  const session = addItemSessions.get(chatId) ?? {};
  const nextSession = { ...session, ...updates };

  addItemSessions.set(chatId, nextSession);
  return nextSession;
}

export function endAddItemSession(chatId) {
  addItemSessions.delete(chatId);
}
