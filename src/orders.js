import { query, withTransaction } from "./database.js";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "delivering",
  "completed",
  "cancelled",
];

const carts = new Map();
const checkoutSessions = new Map();

async function createOrdersTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN (${ORDER_STATUSES.map((status) => `'${status}'`).join(", ")})),
      phone_number VARCHAR(20) NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      address_text VARCHAR(500),
      total_price NUMERIC(10, 2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createOrderItemsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
      item_name VARCHAR(255) NOT NULL,
      item_price NUMERIC(10, 2) NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      subtotal NUMERIC(10, 2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function initOrderTables() {
  await createOrdersTable();
  await createOrderItemsTable();

  console.log("Buyurtma jadvallari tayyor.");
}

export function getCart(chatId) {
  const cart = carts.get(chatId);
  return cart ? Array.from(cart.values()) : [];
}

export function addItemToCart(chatId, item) {
  if (!carts.has(chatId)) {
    carts.set(chatId, new Map());
  }

  const cart = carts.get(chatId);
  const existingLine = cart.get(item.id);

  if (existingLine) {
    existingLine.quantity += 1;
  } else {
    cart.set(item.id, {
      itemId: item.id,
      name: item.name,
      price: Number(item.price),
      quantity: 1,
    });
  }

  return cart.get(item.id);
}

export function removeItemFromCart(chatId, itemId) {
  carts.get(chatId)?.delete(itemId);
}

export function clearCart(chatId) {
  carts.delete(chatId);
}

export function getCartTotal(chatId) {
  return getCart(chatId).reduce((sum, line) => sum + line.price * line.quantity, 0);
}

export function getCheckoutSession(chatId) {
  return checkoutSessions.get(chatId) ?? null;
}

export function startCheckout(chatId) {
  checkoutSessions.set(chatId, { step: "awaiting_phone" });
}

export function updateCheckoutSession(chatId, updates) {
  const session = checkoutSessions.get(chatId) ?? {};
  const nextSession = { ...session, ...updates };

  checkoutSessions.set(chatId, nextSession);
  return nextSession;
}

export function endCheckout(chatId) {
  checkoutSessions.delete(chatId);
}

export async function createOrder({
  userId,
  phoneNumber,
  latitude,
  longitude,
  addressText,
  items,
}) {
  const totalPrice = items.reduce((sum, line) => sum + line.price * line.quantity, 0);

  return withTransaction(async (client) => {
    const orderResult = await client.query(
      `
      INSERT INTO orders (user_id, phone_number, latitude, longitude, address_text, total_price)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
      `,
      [userId, phoneNumber, latitude ?? null, longitude ?? null, addressText ?? null, totalPrice]
    );

    const order = orderResult.rows[0];

    for (const line of items) {
      await client.query(
        `
        INSERT INTO order_items (order_id, item_id, item_name, item_price, quantity, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6);
        `,
        [order.id, line.itemId, line.name, line.price, line.quantity, line.price * line.quantity]
      );
    }

    return order;
  });
}

export async function updateOrderStatus(orderId, status) {
  const result = await query(
    `
    UPDATE orders
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
    `,
    [orderId, status]
  );

  return result.rows[0] ?? null;
}

export async function getOrdersByUserId(userId, limit = 10) {
  const result = await query(
    `
    SELECT id, status, total_price, created_at
    FROM orders
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2;
    `,
    [userId, limit]
  );

  return result.rows;
}
