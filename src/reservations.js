import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import { query } from "./database.js";

dayjs.extend(customParseFormat);

export const RESERVATION_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
const DATE_INPUT_FORMATS = ["YYYY-MM-DD", "DD.MM.YYYY", "DD-MM-YYYY"];
const MIN_GUESTS = 1;
const MAX_GUESTS = 20;

export const WEEKDAY_NAMES = {
  0: "Yakshanba",
  1: "Dushanba",
  2: "Seshanba",
  3: "Chorshanba",
  4: "Payshanba",
  5: "Juma",
  6: "Shanba",
};

const reservationSessions = new Map();
const tableSessions = new Map();
const scheduleSessions = new Map();

async function createReservationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      reservation_date DATE NOT NULL,
      reservation_time TIME NOT NULL,
      guests_count INTEGER NOT NULL CHECK (guests_count > 0),
      phone_number VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN (${RESERVATION_STATUSES.map((status) => `'${status}'`).join(", ")})),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createTablesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS tables (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createRestaurantSettingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS restaurant_settings (
      id SERIAL PRIMARY KEY,
      opening_time TIME NOT NULL DEFAULT '09:00',
      closing_time TIME NOT NULL DEFAULT '22:00',
      closed_weekdays INTEGER[] NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const existing = await query("SELECT id FROM restaurant_settings LIMIT 1;");

  if (existing.rows.length === 0) {
    await query(
      "INSERT INTO restaurant_settings (opening_time, closing_time, closed_weekdays) VALUES ($1, $2, $3);",
      ["09:00", "22:00", []]
    );
  }
}

async function addTableIdToReservations() {
  await query(`
    ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES tables(id);
  `);
}

export async function initReservationTables() {
  await createReservationsTable();
  await createTablesTable();
  await createRestaurantSettingsTable();
  await addTableIdToReservations();

  console.log("Bron qilish, stollar va ish vaqti jadvallari tayyor.");
}

export function parseReservationDate(input) {
  const normalized = input.trim().toLowerCase();

  if (normalized === "bugun") {
    return dayjs().format("YYYY-MM-DD");
  }

  if (normalized === "ertaga") {
    return dayjs().add(1, "day").format("YYYY-MM-DD");
  }

  for (const format of DATE_INPUT_FORMATS) {
    const parsed = dayjs(input.trim(), format, true);
    if (parsed.isValid()) {
      return parsed.format("YYYY-MM-DD");
    }
  }

  return null;
}

export function parseReservationTime(input) {
  const parsed = dayjs(input.trim(), "HH:mm", true);
  return parsed.isValid() ? parsed.format("HH:mm") : null;
}

export function parseGuestsCount(input) {
  const number = Number(input.trim());

  if (!Number.isInteger(number) || number < MIN_GUESTS || number > MAX_GUESTS) {
    return null;
  }

  return number;
}

export function isReservationDateTimeInFuture(date, time) {
  const dateTime = dayjs(`${date} ${time}`, "YYYY-MM-DD HH:mm");
  return dateTime.isAfter(dayjs());
}

export async function getRestaurantSettings() {
  const result = await query(
    "SELECT opening_time, closing_time, closed_weekdays FROM restaurant_settings LIMIT 1;"
  );
  const row = result.rows[0];

  return {
    openingTime: row.opening_time.slice(0, 5),
    closingTime: row.closing_time.slice(0, 5),
    closedWeekdays: row.closed_weekdays,
  };
}

export async function updateRestaurantHours(openingTime, closingTime) {
  await query(
    "UPDATE restaurant_settings SET opening_time = $1, closing_time = $2, updated_at = NOW();",
    [openingTime, closingTime]
  );
}

export async function toggleClosedWeekday(weekday) {
  const settings = await getRestaurantSettings();
  const isCurrentlyClosed = settings.closedWeekdays.includes(weekday);

  const nextClosedWeekdays = isCurrentlyClosed
    ? settings.closedWeekdays.filter((day) => day !== weekday)
    : [...settings.closedWeekdays, weekday];

  await query("UPDATE restaurant_settings SET closed_weekdays = $1, updated_at = NOW();", [
    nextClosedWeekdays,
  ]);

  return nextClosedWeekdays;
}

export async function isDateOpenForBooking(dateStr) {
  const settings = await getRestaurantSettings();
  const weekday = dayjs(dateStr, "YYYY-MM-DD").day();
  return !settings.closedWeekdays.includes(weekday);
}

export async function isTimeWithinOpeningHours(timeStr) {
  const settings = await getRestaurantSettings();
  return timeStr >= settings.openingTime && timeStr <= settings.closingTime;
}

export async function listTables() {
  const result = await query("SELECT * FROM tables ORDER BY id ASC;");
  return result.rows;
}

export async function listActiveTables() {
  const result = await query(
    "SELECT * FROM tables WHERE is_active = TRUE ORDER BY capacity ASC;"
  );
  return result.rows;
}

export async function createTable(name, capacity) {
  const result = await query(
    "INSERT INTO tables (name, capacity) VALUES ($1, $2) RETURNING *;",
    [name, capacity]
  );
  return result.rows[0];
}

export async function setTableActive(tableId, isActive) {
  const result = await query(
    "UPDATE tables SET is_active = $2 WHERE id = $1 RETURNING *;",
    [tableId, isActive]
  );
  return result.rows[0] ?? null;
}

export async function deleteTable(tableId) {
  await query("DELETE FROM tables WHERE id = $1;", [tableId]);
}

export async function findAvailableTable(date, time, guestsCount) {
  const result = await query(
    `
    SELECT t.*
    FROM tables t
    WHERE t.is_active = TRUE
      AND t.capacity >= $3
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.table_id = t.id
          AND r.reservation_date = $1
          AND r.reservation_time = $2
          AND r.status != 'cancelled'
      )
    ORDER BY t.capacity ASC
    LIMIT 1;
    `,
    [date, time, guestsCount]
  );

  return result.rows[0] ?? null;
}

export function getReservationSession(chatId) {
  return reservationSessions.get(chatId) ?? null;
}

export function startReservationSession(chatId) {
  reservationSessions.set(chatId, { step: "awaiting_date" });
}

export function updateReservationSession(chatId, updates) {
  const session = reservationSessions.get(chatId) ?? {};
  const nextSession = { ...session, ...updates };

  reservationSessions.set(chatId, nextSession);
  return nextSession;
}

export function endReservationSession(chatId) {
  reservationSessions.delete(chatId);
}

export async function createReservation({ userId, date, time, guestsCount, phoneNumber, tableId }) {
  const result = await query(
    `
    INSERT INTO reservations (user_id, reservation_date, reservation_time, guests_count, phone_number, table_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
    `,
    [userId, date, time, guestsCount, phoneNumber, tableId ?? null]
  );

  return result.rows[0];
}

export async function updateReservationStatus(reservationId, status) {
  const result = await query(
    `
    UPDATE reservations
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
    `,
    [reservationId, status]
  );

  return result.rows[0] ?? null;
}

export function getAddTableSession(chatId) {
  return tableSessions.get(chatId) ?? null;
}

export function startAddTableSession(chatId) {
  tableSessions.set(chatId, { step: "awaiting_name" });
}

export function updateAddTableSession(chatId, updates) {
  const session = tableSessions.get(chatId) ?? {};
  const nextSession = { ...session, ...updates };

  tableSessions.set(chatId, nextSession);
  return nextSession;
}

export function endAddTableSession(chatId) {
  tableSessions.delete(chatId);
}

export function getScheduleSession(chatId) {
  return scheduleSessions.get(chatId) ?? null;
}

export function startScheduleSession(chatId) {
  scheduleSessions.set(chatId, { step: "awaiting_hours" });
}

export function endScheduleSession(chatId) {
  scheduleSessions.delete(chatId);
}
