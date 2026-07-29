import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import { query } from "./database.js";

dayjs.extend(customParseFormat);

export const RESERVATION_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
const DATE_INPUT_FORMATS = ["YYYY-MM-DD", "DD.MM.YYYY", "DD-MM-YYYY"];
const MIN_GUESTS = 1;
const MAX_GUESTS = 20;

const reservationSessions = new Map();

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

export async function initReservationTables() {
  await createReservationsTable();

  console.log("Bron qilish jadvali tayyor.");
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

export async function createReservation({ userId, date, time, guestsCount, phoneNumber }) {
  const result = await query(
    `
    INSERT INTO reservations (user_id, reservation_date, reservation_time, guests_count, phone_number)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
    `,
    [userId, date, time, guestsCount, phoneNumber]
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
