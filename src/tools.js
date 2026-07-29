import { Type } from "@google/genai";
import {
  getCategories,
  getCategoryByName,
  getItemsByCategoryId,
  searchMenuItemsByName,
  getAllAvailableItems,
} from "./menu.js";
import { getCart, addItemToCart, removeItemFromCart, getCartTotal } from "./orders.js";
import {
  parseReservationDate,
  parseReservationTime,
  parseGuestsCount,
  isReservationDateTimeInFuture,
  createReservation,
} from "./reservations.js";
import { PHONE_REGEX, normalizePhoneNumber } from "./utils.js";

export const toolDeclarations = [
  {
    name: "list_menu_categories",
    description: "Restoran menyusidagi barcha kategoriyalar ro'yxatini qaytaradi.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "list_menu_items",
    description:
      "Menyudagi taomlar ro'yxatini qaytaradi. category_name berilsa, faqat shu kategoriyadagi taomlar qaytariladi.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        category_name: {
          type: Type.STRING,
          description: "Kategoriya nomi, masalan: KFC, Shashlik, Ichimliklar",
        },
      },
    },
  },
  {
    name: "add_item_to_cart",
    description: "Foydalanuvchi savatiga taom qo'shadi.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        item_name: { type: Type.STRING, description: "Qo'shiladigan taom nomi" },
        quantity: { type: Type.INTEGER, description: "Nechta dona (agar aytilmasa: 1)" },
      },
      required: ["item_name"],
    },
  },
  {
    name: "remove_item_from_cart",
    description: "Foydalanuvchi savatidan taomni butunlay olib tashlaydi.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        item_name: { type: Type.STRING, description: "Olib tashlanadigan taom nomi" },
      },
      required: ["item_name"],
    },
  },
  {
    name: "view_cart",
    description: "Foydalanuvchining joriy savatini va umumiy narxini qaytaradi.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "create_table_reservation",
    description:
      "Restoranda stol bron qiladi. Sana, vaqt, mehmonlar soni va telefon raqami majburiy. " +
      "Agar ulardan biri foydalanuvchi xabarida yo'q bo'lsa, bu funksiyani chaqirmasdan, " +
      "avval o'sha ma'lumotni foydalanuvchidan so'ra.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "Bron sanasi: 'bugun', 'ertaga' yoki DD.MM.YYYY" },
        time: { type: Type.STRING, description: "Bron vaqti HH:mm formatida, masalan 20:00" },
        guests_count: { type: Type.INTEGER, description: "Mehmonlar soni" },
        phone_number: { type: Type.STRING, description: "Aloqa uchun telefon raqami" },
      },
      required: ["date", "time", "guests_count", "phone_number"],
    },
  },
];

async function handleListMenuCategories() {
  const categories = await getCategories();
  return { categories: categories.map((category) => category.name) };
}

async function handleListMenuItems(args) {
  const categoryName = args.category_name;

  if (categoryName) {
    const category = await getCategoryByName(categoryName);

    if (!category) {
      return { success: false, message: `"${categoryName}" nomli kategoriya topilmadi.` };
    }

    const items = await getItemsByCategoryId(category.id);
    return {
      category: category.name,
      items: items.map((item) => ({ name: item.name, price: Number(item.price) })),
    };
  }

  const items = await getAllAvailableItems();
  return {
    items: items.map((item) => ({
      name: item.name,
      price: Number(item.price),
      category: item.category_name,
    })),
  };
}

async function handleAddItemToCart(args, context) {
  const itemName = args.item_name;
  const quantity = Math.max(1, Math.min(50, Math.trunc(Number(args.quantity) || 1)));

  const matches = await searchMenuItemsByName(itemName);

  if (matches.length === 0) {
    return { success: false, message: `"${itemName}" nomli taom menyuda topilmadi.` };
  }

  if (matches.length > 1) {
    return {
      success: false,
      message: "Bir nechta mos taom topildi. Foydalanuvchidan aniqroq nom so'ra.",
      matches: matches.map((item) => ({ name: item.name, price: Number(item.price) })),
    };
  }

  const item = matches[0];
  let line;

  for (let i = 0; i < quantity; i += 1) {
    line = addItemToCart(context.chatId, item);
  }

  return {
    success: true,
    message: `${item.name} savatga qo'shildi. Hozir savatda: ${line.quantity} dona.`,
    cart: getCart(context.chatId),
    total: getCartTotal(context.chatId),
  };
}

async function handleRemoveItemFromCart(args, context) {
  const itemName = args.item_name.toLowerCase();
  const cart = getCart(context.chatId);
  const line = cart.find((cartLine) => cartLine.name.toLowerCase().includes(itemName));

  if (!line) {
    return { success: false, message: `Savatda "${args.item_name}" topilmadi.` };
  }

  removeItemFromCart(context.chatId, line.itemId);

  return {
    success: true,
    message: `${line.name} savatdan olib tashlandi.`,
    cart: getCart(context.chatId),
    total: getCartTotal(context.chatId),
  };
}

async function handleViewCart(args, context) {
  return {
    cart: getCart(context.chatId),
    total: getCartTotal(context.chatId),
  };
}

async function handleCreateTableReservation(args, context) {
  const parsedDate = parseReservationDate(String(args.date ?? ""));
  const parsedTime = parseReservationTime(String(args.time ?? ""));
  const guestsCount = parseGuestsCount(String(args.guests_count ?? ""));
  const normalizedPhone = normalizePhoneNumber(String(args.phone_number ?? ""));

  if (!parsedDate) {
    return { success: false, message: "Sana formati noto'g'ri. Masalan: bugun, ertaga yoki 05.08.2026." };
  }

  if (!parsedTime) {
    return { success: false, message: "Vaqt formati noto'g'ri. Masalan: 20:00." };
  }

  if (!guestsCount) {
    return { success: false, message: "Mehmonlar soni 1 dan 20 gacha bo'lishi kerak." };
  }

  if (!PHONE_REGEX.test(normalizedPhone)) {
    return { success: false, message: "Telefon raqami noto'g'ri. Masalan: +998901234567." };
  }

  if (!isReservationDateTimeInFuture(parsedDate, parsedTime)) {
    return { success: false, message: "Bu sana/vaqt allaqachon o'tib ketgan. Boshqa vaqt tanlang." };
  }

  const reservation = await createReservation({
    userId: context.userId,
    date: parsedDate,
    time: parsedTime,
    guestsCount,
    phoneNumber: normalizedPhone,
  });

  return {
    success: true,
    message: `Stol muvaffaqiyatli bron qilindi. Bron raqami: #${reservation.id}.`,
    reservation: {
      id: reservation.id,
      date: parsedDate,
      time: parsedTime,
      guestsCount,
    },
  };
}

export const toolHandlers = {
  list_menu_categories: handleListMenuCategories,
  list_menu_items: handleListMenuItems,
  add_item_to_cart: handleAddItemToCart,
  remove_item_from_cart: handleRemoveItemFromCart,
  view_cart: handleViewCart,
  create_table_reservation: handleCreateTableReservation,
};
