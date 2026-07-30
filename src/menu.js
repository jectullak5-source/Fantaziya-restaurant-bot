import { query } from "./database.js";

const DEFAULT_CATEGORIES = [
  { name: "KFC", slug: "kfc", displayOrder: 1 },
  { name: "Shashlik", slug: "shashlik", displayOrder: 2 },
  { name: "Milliy ovqatlar", slug: "milliy-ovqatlar", displayOrder: 3 },
  { name: "Ichimliklar", slug: "ichimliklar", displayOrder: 4 },
  { name: "Desertlar", slug: "desertlar", displayOrder: 5 },
];

async function createMenuCategoriesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createMenuItemsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price NUMERIC(10, 2) NOT NULL,
      image_url VARCHAR(500),
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedDefaultCategories() {
  for (const category of DEFAULT_CATEGORIES) {
    await query(
      `
      INSERT INTO menu_categories (name, slug, display_order)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO NOTHING;
      `,
      [category.name, category.slug, category.displayOrder]
    );
  }
}

export async function initMenuTables() {
  await createMenuCategoriesTable();
  await createMenuItemsTable();
  await seedDefaultCategories();

  console.log("Menyu jadvallari va standart kategoriyalar tayyor.");
}

export async function getCategories() {
  const result = await query(
    `SELECT id, name, slug FROM menu_categories WHERE is_active = TRUE ORDER BY display_order ASC;`
  );

  return result.rows;
}

export async function getCategoryById(categoryId) {
  const result = await query(
    `SELECT id, name, slug FROM menu_categories WHERE id = $1 AND is_active = TRUE;`,
    [categoryId]
  );

  return result.rows[0] ?? null;
}

export async function getItemsByCategoryId(categoryId) {
  const result = await query(
    `
    SELECT id, category_id, name, description, price, image_url
    FROM menu_items
    WHERE category_id = $1 AND is_available = TRUE
    ORDER BY display_order ASC;
    `,
    [categoryId]
  );

  return result.rows;
}

export async function getCategoryByName(name) {
  const result = await query(
    `SELECT id, name, slug FROM menu_categories WHERE is_active = TRUE AND name ILIKE $1 LIMIT 1;`,
    [name]
  );

  return result.rows[0] ?? null;
}

export async function searchMenuItemsByName(searchTerm) {
  const result = await query(
    `
    SELECT id, category_id, name, description, price
    FROM menu_items
    WHERE is_available = TRUE AND name ILIKE $1
    ORDER BY name ASC;
    `,
    [`%${searchTerm}%`]
  );

  return result.rows;
}

export async function getAllAvailableItems() {
  const result = await query(`
    SELECT mi.id, mi.name, mi.price, mi.description, mc.name AS category_name
    FROM menu_items mi
    JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE mi.is_available = TRUE AND mc.is_active = TRUE
    ORDER BY mc.display_order ASC, mi.display_order ASC;
  `);

  return result.rows;
}

export async function getItemById(itemId) {
  const result = await query(
    `
    SELECT id, category_id, name, description, price, image_url
    FROM menu_items
    WHERE id = $1 AND is_available = TRUE;
    `,
    [itemId]
  );

  return result.rows[0] ?? null;
}

export async function getAllItemsByCategoryIdForAdmin(categoryId) {
  const result = await query(
    `
    SELECT id, category_id, name, description, price, is_available
    FROM menu_items
    WHERE category_id = $1
    ORDER BY display_order ASC, id ASC;
    `,
    [categoryId]
  );

  return result.rows;
}

export async function createMenuItem({ categoryId, name, price, description, imageFileId }) {
  const result = await query(
    `
    INSERT INTO menu_items (category_id, name, price, description, image_url)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
    `,
    [categoryId, name, price, description ?? null, imageFileId ?? null]
  );

  return result.rows[0];
}

export async function setMenuItemAvailability(itemId, isAvailable) {
  const result = await query(
    `
    UPDATE menu_items
    SET is_available = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
    `,
    [itemId, isAvailable]
  );

  return result.rows[0] ?? null;
}

export async function deleteMenuItem(itemId) {
  await query("DELETE FROM menu_items WHERE id = $1", [itemId]);
}
