import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dayjs from "dayjs";
import { config } from "./config.js";
import { upsertUser } from "./database.js";
import {
  getCategories,
  getCategoryById,
  getItemsByCategoryId,
  getItemById,
  getAllItemsByCategoryIdForAdmin,
  createMenuItem,
  setMenuItemAvailability,
  deleteMenuItem,
} from "./menu.js";
import { formatPrice, PHONE_REGEX, normalizePhoneNumber } from "./utils.js";
import {
  getCart,
  addItemToCart,
  removeItemFromCart,
  clearCart,
  getCartTotal,
  getCheckoutSession,
  startCheckout,
  updateCheckoutSession,
  endCheckout,
  createOrder,
  ORDER_STATUSES,
  updateOrderStatus,
  getOrdersByUserId,
} from "./orders.js";
import {
  parseReservationDate,
  parseReservationTime,
  parseGuestsCount,
  isReservationDateTimeInFuture,
  getReservationSession,
  startReservationSession,
  updateReservationSession,
  endReservationSession,
  createReservation,
  RESERVATION_STATUSES,
  updateReservationStatus,
} from "./reservations.js";
import { processUserMessage, processVoiceMessage } from "./brain.js";
import {
  isAdmin,
  addAdminByTelegramId,
  getOrderStatistics,
  getRecentOrders,
  getUpcomingReservationsCount,
  getRecentReservations,
  getAddItemSession,
  startAddItemSession,
  updateAddItemSession,
  endAddItemSession,
} from "./admin.js";

const ORDER_STATUS_LABELS = {
  pending: "⏳ Kutilmoqda",
  confirmed: "✅ Tasdiqlandi",
  preparing: "👨‍🍳 Tayyorlanmoqda",
  delivering: "🚗 Yetkazilmoqda",
  completed: "🏁 Yakunlandi",
  cancelled: "❌ Bekor qilindi",
};

const RESERVATION_STATUS_LABELS = {
  pending: "⏳ Kutilmoqda",
  confirmed: "✅ Tasdiqlandi",
  completed: "🏁 Bo'lib o'tdi",
  cancelled: "❌ Bekor qilindi",
};

export const bot = new TelegramBot(config.telegramBotToken, {
  polling: true,
});

function registerUserTracking() {
  bot.on("message", async (message) => {
    try {
      await upsertUser(message.from);
    } catch (error) {
      console.error("Foydalanuvchini saqlashda xatolik:", error.message);
    }
  });
}

const MAIN_MENU_BUTTON_TEXTS = {
  MENU: "🍗 Menyu",
  CART: "🛒 Savat",
  BOOK: "🪑 Stol bron qilish",
  MY_ORDERS: "📦 Buyurtmalarim",
  ADDRESS: "📍 Manzil",
  CONTACT: "☎️ Aloqa",
};

const MAIN_MENU_BUTTON_TEXT_SET = new Set(Object.values(MAIN_MENU_BUTTON_TEXTS));

const RESTAURANT_CONTACT = {
  phone: "+998 93 124 17 11",
  workingHours: "09:00 – 22:00 (har kuni)",
  instagramHandle: "@fantaziya_madaniyat",
  instagramUrl: "https://instagram.com/fantaziya_madaniyat",
};

const RESTAURANT_ADDRESS = {
  text: "Andijon viloyati, Pahtaobod tumani, Madaniyat qishlog'i, Fantaziya",
  mapsUrl: "https://maps.app.goo.gl/qN4rYxeo3KgRowsq9?g_st=ic",
};

async function notifyOrdersGroup(text) {
  if (!config.ordersGroupChatId) {
    return;
  }

  try {
    await bot.sendMessage(config.ordersGroupChatId, text, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Guruhga bildirishnoma yuborishda xatolik:", error.message);
  }
}

function registerGroupIdCommand() {
  bot.onText(/^\/group_id$/, async (message) => {
    const chatId = message.chat.id;

    try {
      if (!(await isAdmin(message.from.id))) {
        return;
      }

      await bot.sendMessage(chatId, `Ushbu chat ID: \`${chatId}\``, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("/group_id buyrug'ida xatolik:", error.message);
    }
  });
}

function buildMainReplyKeyboard() {
  return {
    keyboard: [
      [MAIN_MENU_BUTTON_TEXTS.MENU, MAIN_MENU_BUTTON_TEXTS.CART],
      [MAIN_MENU_BUTTON_TEXTS.BOOK, MAIN_MENU_BUTTON_TEXTS.MY_ORDERS],
      [MAIN_MENU_BUTTON_TEXTS.ADDRESS, MAIN_MENU_BUTTON_TEXTS.CONTACT],
    ],
    resize_keyboard: true,
  };
}

function registerStartCommand() {
  bot.onText(/^\/start$/, async (message) => {
    const chatId = message.chat.id;
    const firstName = message.from?.first_name || "Mehmon";

    try {
      await bot.sendMessage(
        chatId,
        `Assalomu alaykum, ${firstName}!\n\nFantaziya Restaurant botiga xush kelibsiz. Quyidagi menyudan foydalaning:`,
        { reply_markup: buildMainReplyKeyboard() }
      );
    } catch (error) {
      console.error("/start xabarini yuborishda xatolik:", error.message);
    }
  });
}

function buildCategoriesKeyboard(categories) {
  return {
    inline_keyboard: categories.map((category) => [
      { text: category.name, callback_data: `cat:${category.id}` },
    ]),
  };
}

function buildBackToCategoriesKeyboard() {
  return {
    inline_keyboard: [[{ text: "⬅️ Kategoriyalarga qaytish", callback_data: "menu" }]],
  };
}

function buildItemsKeyboard(items) {
  const itemRows = items.map((item) => [
    { text: `➕ ${item.name} — ${formatPrice(item.price)}`, callback_data: `add:${item.id}` },
  ]);

  return {
    inline_keyboard: [
      ...itemRows,
      [{ text: "🛒 Savatni ko'rish", callback_data: "cart" }],
      [{ text: "⬅️ Kategoriyalarga qaytish", callback_data: "menu" }],
    ],
  };
}

function formatCartText(cartLines, total) {
  if (cartLines.length === 0) {
    return "🛒 Savatingiz bo'sh.";
  }

  const lines = cartLines
    .map(
      (line, index) =>
        `${index + 1}. ${line.name} — ${line.quantity} x ${formatPrice(line.price)} = ${formatPrice(
          line.price * line.quantity
        )}`
    )
    .join("\n");

  return `🛒 *Savatingiz:*\n\n${lines}\n\n*Jami: ${formatPrice(total)}*`;
}

function buildCartKeyboard(cartLines) {
  const removeRows = cartLines.map((line) => [
    { text: `❌ ${line.name} (${line.quantity})`, callback_data: `rm:${line.itemId}` },
  ]);

  return {
    inline_keyboard: [
      ...removeRows,
      [{ text: "✅ Buyurtma berish", callback_data: "checkout" }],
      [{ text: "🗑 Savatni tozalash", callback_data: "clear_cart" }],
      [{ text: "⬅️ Menyuga qaytish", callback_data: "menu" }],
    ],
  };
}

async function showCategories(chatId, messageId) {
  const categories = await getCategories();

  if (categories.length === 0) {
    await bot.editMessageText("Hozircha menyu kategoriyalari mavjud emas.", {
      chat_id: chatId,
      message_id: messageId,
    });
    return;
  }

  await bot.editMessageText("Kategoriyani tanlang:", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: buildCategoriesKeyboard(categories),
  });
}

async function showCategoryItems(chatId, messageId, categoryId) {
  const category = await getCategoryById(categoryId);

  if (!category) {
    await bot.editMessageText("Kategoriya topilmadi.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: buildBackToCategoriesKeyboard(),
    });
    return;
  }

  const items = await getItemsByCategoryId(categoryId);

  if (items.length === 0) {
    await bot.editMessageText(`*${category.name}*\n\nHozircha bu bo'limda taomlar mavjud emas.`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: buildBackToCategoriesKeyboard(),
    });
    return;
  }

  const itemsText = items
    .map((item) => `🍽 ${item.name} — ${formatPrice(item.price)}`)
    .join("\n");

  await bot.editMessageText(`*${category.name}*\n\n${itemsText}`, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: buildItemsKeyboard(items),
  });
}

async function showCart(chatId, messageId) {
  const cartLines = getCart(chatId);
  const total = getCartTotal(chatId);

  const reply_markup =
    cartLines.length > 0
      ? buildCartKeyboard(cartLines)
      : { inline_keyboard: [[{ text: "🍽 Menyuni ko'rish", callback_data: "menu" }]] };

  await bot.editMessageText(formatCartText(cartLines, total), {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup,
  });
}

async function sendMainMenu(chatId) {
  const categories = await getCategories();

  if (categories.length === 0) {
    await bot.sendMessage(chatId, "Hozircha menyu kategoriyalari mavjud emas.");
    return;
  }

  await bot.sendMessage(chatId, "Kategoriyani tanlang:", {
    reply_markup: buildCategoriesKeyboard(categories),
  });
}

function registerMenuCommand() {
  bot.onText(/^\/menu$/, async (message) => {
    const chatId = message.chat.id;

    try {
      await sendMainMenu(chatId);
    } catch (error) {
      console.error("/menu buyrug'ida xatolik:", error.message);
      await bot.sendMessage(
        chatId,
        "Menyuni yuklashda xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring."
      );
    }
  });
}

function registerMainMenuButtonsFlow() {
  bot.on("message", async (message) => {
    const chatId = message.chat.id;
    const text = message.text;

    if (!text || !MAIN_MENU_BUTTON_TEXT_SET.has(text)) {
      return;
    }

    try {
      switch (text) {
        case MAIN_MENU_BUTTON_TEXTS.MENU:
          await sendMainMenu(chatId);
          break;
        case MAIN_MENU_BUTTON_TEXTS.CART:
          await sendCartView(chatId);
          break;
        case MAIN_MENU_BUTTON_TEXTS.BOOK:
          await sendBookingPrompt(chatId);
          break;
        case MAIN_MENU_BUTTON_TEXTS.MY_ORDERS:
          await sendMyOrders(chatId, message.from);
          break;
        case MAIN_MENU_BUTTON_TEXTS.ADDRESS:
          await bot.sendMessage(
            chatId,
            `📍 *Manzilimiz:*\n\n${RESTAURANT_ADDRESS.text}`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "🗺 Xaritada ochish", url: RESTAURANT_ADDRESS.mapsUrl }]],
              },
            }
          );
          break;
        case MAIN_MENU_BUTTON_TEXTS.CONTACT:
          await bot.sendMessage(
            chatId,
            `☎️ *Aloqa:*\n\n` +
              `📞 Telefon: ${RESTAURANT_CONTACT.phone}\n` +
              `🕐 Ish vaqti: ${RESTAURANT_CONTACT.workingHours}\n` +
              `📷 Instagram: [${RESTAURANT_CONTACT.instagramHandle}](${RESTAURANT_CONTACT.instagramUrl})`,
            { parse_mode: "Markdown" }
          );
          break;
      }
    } catch (error) {
      console.error("Asosiy menyu tugmasida xatolik:", error.message);
    }
  });
}

async function sendCartView(chatId) {
  const cartLines = getCart(chatId);
  const total = getCartTotal(chatId);

  const reply_markup =
    cartLines.length > 0
      ? buildCartKeyboard(cartLines)
      : { inline_keyboard: [[{ text: "🍽 Menyuni ko'rish", callback_data: "menu" }]] };

  await bot.sendMessage(chatId, formatCartText(cartLines, total), {
    parse_mode: "Markdown",
    reply_markup,
  });
}

async function sendMyOrders(chatId, telegramFrom) {
  const user = await upsertUser(telegramFrom);
  const orders = await getOrdersByUserId(user.id, 10);

  if (orders.length === 0) {
    await bot.sendMessage(chatId, "📦 Sizda hali buyurtmalar yo'q.");
    return;
  }

  const lines = orders
    .map((order) => {
      const status = ORDER_STATUS_LABELS[order.status] ?? order.status;
      const date = dayjs(order.created_at).format("DD.MM.YYYY HH:mm");
      return `#${order.id} — ${date} — ${status} — ${formatPrice(order.total_price)}`;
    })
    .join("\n");

  await bot.sendMessage(chatId, `📦 *Sizning buyurtmalaringiz:*\n\n${lines}`, {
    parse_mode: "Markdown",
  });
}

function registerCartCommand() {
  bot.onText(/^\/cart$/, async (message) => {
    try {
      await sendCartView(message.chat.id);
    } catch (error) {
      console.error("/cart buyrug'ida xatolik:", error.message);
    }
  });
}

async function handlePhoneStep(chatId, message) {
  let phoneNumber = null;

  if (message.contact?.phone_number) {
    phoneNumber = normalizePhoneNumber(message.contact.phone_number);
  } else if (message.text) {
    const candidate = normalizePhoneNumber(message.text.trim());

    if (PHONE_REGEX.test(candidate)) {
      phoneNumber = candidate;
    }
  }

  if (!phoneNumber) {
    await bot.sendMessage(chatId, "Telefon raqami noto'g'ri. Masalan: +998901234567");
    return;
  }

  updateCheckoutSession(chatId, { phoneNumber, step: "awaiting_location" });

  await bot.sendMessage(
    chatId,
    "Endi manzilingizni yuboring (📍 tugma orqali yoki matn ko'rinishida).",
    {
      reply_markup: {
        keyboard: [[{ text: "📍 Lokatsiyani yuborish", request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
}

async function handleLocationStep(chatId, message) {
  let latitude = null;
  let longitude = null;
  let addressText = null;

  if (message.location) {
    latitude = message.location.latitude;
    longitude = message.location.longitude;
  } else if (message.text?.trim()) {
    addressText = message.text.trim();
  }

  if (!latitude && !addressText) {
    await bot.sendMessage(
      chatId,
      "Iltimos, lokatsiya yuboring yoki manzilingizni matn ko'rinishida yozing."
    );
    return;
  }

  const session = updateCheckoutSession(chatId, {
    latitude,
    longitude,
    addressText,
    step: "confirming",
  });

  const cartLines = getCart(chatId);
  const total = getCartTotal(chatId);
  const addressLine = addressText ?? `${latitude}, ${longitude}`;

  const summary =
    `📋 *Buyurtmangizni tasdiqlang:*\n\n` +
    `${formatCartText(cartLines, total)}\n\n` +
    `📞 Telefon: ${session.phoneNumber}\n` +
    `📍 Manzil: ${addressLine}`;

  await bot.sendMessage(chatId, summary, {
    parse_mode: "Markdown",
    reply_markup: { remove_keyboard: true },
  });

  await bot.sendMessage(chatId, "Buyurtmani tasdiqlaysizmi?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: "confirm_order" },
          { text: "❌ Bekor qilish", callback_data: "cancel_order" },
        ],
      ],
    },
  });
}

function registerCheckoutFlow() {
  bot.on("message", async (message) => {
    const chatId = message.chat.id;
    const session = getCheckoutSession(chatId);

    if (!session || message.text?.startsWith("/")) {
      return;
    }

    try {
      if (session.step === "awaiting_phone") {
        await handlePhoneStep(chatId, message);
      } else if (session.step === "awaiting_location") {
        await handleLocationStep(chatId, message);
      } else if (session.step === "confirming") {
        await bot.sendMessage(
          chatId,
          "Iltimos, yuqoridagi ✅ Tasdiqlash yoki ❌ Bekor qilish tugmasidan birini tanlang."
        );
      }
    } catch (error) {
      console.error("Checkout jarayonida xatolik:", error.message);
      await bot.sendMessage(
        chatId,
        "Xatolik yuz berdi. Qaytadan urinib ko'ring yoki /cart buyrug'ini yuboring."
      );
    }
  });
}

async function sendBookingPrompt(chatId) {
  startReservationSession(chatId);

  await bot.sendMessage(
    chatId,
    "📅 Qaysi kunga stol band qilmoqchisiz? (masalan: bugun, ertaga, 05.08.2026)",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Bugun", callback_data: "book_date:bugun" },
            { text: "Ertaga", callback_data: "book_date:ertaga" },
          ],
        ],
      },
    }
  );
}

function registerBookCommand() {
  bot.onText(/^\/book$/, async (message) => {
    await sendBookingPrompt(message.chat.id);
  });
}

async function handleReservationDateStep(chatId, text) {
  const date = parseReservationDate(text);

  if (!date) {
    await bot.sendMessage(
      chatId,
      "Sana formati noto'g'ri. Masalan: bugun, ertaga yoki 05.08.2026"
    );
    return;
  }

  updateReservationSession(chatId, { date, step: "awaiting_time" });
  await bot.sendMessage(chatId, "🕐 Soat nechida? (masalan: 19:30)");
}

async function handleReservationTimeStep(chatId, text) {
  const session = getReservationSession(chatId);
  const time = parseReservationTime(text);

  if (!time) {
    await bot.sendMessage(chatId, "Vaqt formati noto'g'ri. Masalan: 19:30");
    return;
  }

  if (!isReservationDateTimeInFuture(session.date, time)) {
    await bot.sendMessage(chatId, "Bu vaqt allaqachon o'tib ketgan. Boshqa vaqt kiriting.");
    return;
  }

  updateReservationSession(chatId, { time, step: "awaiting_guests" });
  await bot.sendMessage(chatId, "👥 Necha kishi uchun stol kerak? (1-20)");
}

async function handleReservationGuestsStep(chatId, text) {
  const guestsCount = parseGuestsCount(text);

  if (!guestsCount) {
    await bot.sendMessage(chatId, "Iltimos, 1 dan 20 gacha son kiriting.");
    return;
  }

  updateReservationSession(chatId, { guestsCount, step: "awaiting_phone" });
  await bot.sendMessage(chatId, "📞 Telefon raqamingizni yuboring:", {
    reply_markup: {
      keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function handleReservationPhoneStep(chatId, message) {
  let phoneNumber = null;

  if (message.contact?.phone_number) {
    phoneNumber = normalizePhoneNumber(message.contact.phone_number);
  } else if (message.text) {
    const candidate = normalizePhoneNumber(message.text.trim());

    if (PHONE_REGEX.test(candidate)) {
      phoneNumber = candidate;
    }
  }

  if (!phoneNumber) {
    await bot.sendMessage(chatId, "Telefon raqami noto'g'ri. Masalan: +998901234567");
    return;
  }

  const session = updateReservationSession(chatId, { phoneNumber, step: "confirming" });

  await bot.sendMessage(
    chatId,
    `📋 *Bronni tasdiqlang:*\n\n` +
      `📅 Sana: ${session.date}\n` +
      `🕐 Vaqt: ${session.time}\n` +
      `👥 Kishi: ${session.guestsCount}\n` +
      `📞 Telefon: ${phoneNumber}`,
    {
      parse_mode: "Markdown",
      reply_markup: { remove_keyboard: true },
    }
  );

  await bot.sendMessage(chatId, "Bronni tasdiqlaysizmi?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: "confirm_reservation" },
          { text: "❌ Bekor qilish", callback_data: "cancel_reservation" },
        ],
      ],
    },
  });
}

function registerReservationFlow() {
  bot.on("message", async (message) => {
    const chatId = message.chat.id;
    const session = getReservationSession(chatId);

    if (!session || message.text?.startsWith("/")) {
      return;
    }

    try {
      if (session.step === "awaiting_date") {
        await handleReservationDateStep(chatId, message.text ?? "");
      } else if (session.step === "awaiting_time") {
        await handleReservationTimeStep(chatId, message.text ?? "");
      } else if (session.step === "awaiting_guests") {
        await handleReservationGuestsStep(chatId, message.text ?? "");
      } else if (session.step === "awaiting_phone") {
        await handleReservationPhoneStep(chatId, message);
      } else if (session.step === "confirming") {
        await bot.sendMessage(
          chatId,
          "Iltimos, yuqoridagi ✅ Tasdiqlash yoki ❌ Bekor qilish tugmasidan birini tanlang."
        );
      }
    } catch (error) {
      console.error("Bron jarayonida xatolik:", error.message);
      await bot.sendMessage(chatId, "Xatolik yuz berdi. Qaytadan /book buyrug'ini yuboring.");
    }
  });
}

function buildAdminMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📦 Buyurtmalar", callback_data: "admin:orders" }],
      [{ text: "🪑 Bronlar", callback_data: "admin:reservations" }],
      [{ text: "📊 Statistika", callback_data: "admin:stats" }],
      [{ text: "🍽 Menyu boshqaruvi", callback_data: "admin:menuadmin" }],
    ],
  };
}

async function showAdminMainMenu(chatId, messageId) {
  await bot.editMessageText("🔐 *Admin panel*\n\nBo'limni tanlang:", {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: buildAdminMainMenuKeyboard(),
  });
}

async function showAdminOrders(chatId, messageId) {
  const orders = await getRecentOrders(10);

  if (orders.length === 0) {
    await bot.editMessageText("Hozircha buyurtmalar yo'q.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "admin:menu" }]] },
    });
    return;
  }

  const lines = orders
    .map((order) => {
      const customer = order.first_name || order.username || "Noma'lum";
      const status = ORDER_STATUS_LABELS[order.status] ?? order.status;
      return `#${order.id} — ${customer} — ${formatPrice(order.total_price)} — ${status}`;
    })
    .join("\n");

  const orderButtons = orders.map((order) => [
    { text: `✏️ #${order.id} holatini o'zgartirish`, callback_data: `admin:orderstatus:${order.id}` },
  ]);

  await bot.editMessageText(`📦 *So'nggi buyurtmalar:*\n\n${lines}`, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [...orderButtons, [{ text: "⬅️ Orqaga", callback_data: "admin:menu" }]],
    },
  });
}

async function showOrderStatusOptions(chatId, messageId, orderId) {
  const statusButtons = ORDER_STATUSES.map((status) => [
    { text: ORDER_STATUS_LABELS[status], callback_data: `admin:setstatus:${orderId}:${status}` },
  ]);

  await bot.editMessageText(`Buyurtma #${orderId} uchun yangi holatni tanlang:`, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [...statusButtons, [{ text: "⬅️ Orqaga", callback_data: "admin:orders" }]],
    },
  });
}

async function applyOrderStatus(chatId, messageId, orderId, status) {
  const order = await updateOrderStatus(orderId, status);

  if (!order) {
    await bot.editMessageText(`Buyurtma #${orderId} topilmadi.`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "admin:orders" }]] },
    });
    return;
  }

  await bot.editMessageText(
    `✅ Buyurtma #${orderId} holati "${ORDER_STATUS_LABELS[status]}"ga o'zgartirildi.`,
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Buyurtmalarga qaytish", callback_data: "admin:orders" }]],
      },
    }
  );
}

async function showAdminReservations(chatId, messageId) {
  const reservations = await getRecentReservations(10);

  if (reservations.length === 0) {
    await bot.editMessageText("Hozircha kelayotgan bronlar yo'q.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "admin:menu" }]] },
    });
    return;
  }

  const lines = reservations
    .map((reservation) => {
      const customer = reservation.first_name || reservation.username || "Noma'lum";
      const status = RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status;
      const date = dayjs(reservation.reservation_date).format("DD.MM.YYYY");
      const time = reservation.reservation_time.slice(0, 5);
      return `#${reservation.id} — ${customer} — ${date} ${time} — 👥${reservation.guests_count} — ${status}`;
    })
    .join("\n");

  const reservationButtons = reservations.map((reservation) => [
    {
      text: `✏️ #${reservation.id} holatini o'zgartirish`,
      callback_data: `admin:resstatus:${reservation.id}`,
    },
  ]);

  await bot.editMessageText(`🪑 *Kelayotgan bronlar:*\n\n${lines}`, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [...reservationButtons, [{ text: "⬅️ Orqaga", callback_data: "admin:menu" }]],
    },
  });
}

async function showReservationStatusOptions(chatId, messageId, reservationId) {
  const statusButtons = RESERVATION_STATUSES.map((status) => [
    {
      text: RESERVATION_STATUS_LABELS[status],
      callback_data: `admin:setresstatus:${reservationId}:${status}`,
    },
  ]);

  await bot.editMessageText(`Bron #${reservationId} uchun yangi holatni tanlang:`, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [
        ...statusButtons,
        [{ text: "⬅️ Orqaga", callback_data: "admin:reservations" }],
      ],
    },
  });
}

async function applyReservationStatus(chatId, messageId, reservationId, status) {
  const reservation = await updateReservationStatus(reservationId, status);

  if (!reservation) {
    await bot.editMessageText(`Bron #${reservationId} topilmadi.`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "admin:reservations" }]],
      },
    });
    return;
  }

  await bot.editMessageText(
    `✅ Bron #${reservationId} holati "${RESERVATION_STATUS_LABELS[status]}"ga o'zgartirildi.`,
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Bronlarga qaytish", callback_data: "admin:reservations" }],
        ],
      },
    }
  );
}

async function showAdminStats(chatId, messageId) {
  const stats = await getOrderStatistics();
  const upcomingReservations = await getUpcomingReservationsCount();

  const statusLines =
    stats.statusBreakdown
      .map((row) => `  ${ORDER_STATUS_LABELS[row.status] ?? row.status}: ${row.count}`)
      .join("\n") || "  ma'lumot yo'q";

  const text =
    `📊 *Statistika*\n\n` +
    `📦 Jami buyurtmalar: ${stats.totalOrders}\n` +
    `💰 Jami tushum: ${formatPrice(stats.totalRevenue)}\n\n` +
    `📅 Bugungi buyurtmalar: ${stats.todayOrders}\n` +
    `💵 Bugungi tushum: ${formatPrice(stats.todayRevenue)}\n\n` +
    `📋 Holatlar bo'yicha:\n${statusLines}\n\n` +
    `🍽 Kelayotgan bronlar: ${upcomingReservations}`;

  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "admin:menu" }]] },
  });
}

async function showAdminMenuManagement(chatId, messageId) {
  const categories = await getCategories();

  const categoryButtons = categories.map((category) => [
    { text: category.name, callback_data: `admin:items:${category.id}` },
  ]);

  await bot.editMessageText("🍽 *Menyu boshqaruvi*\n\nKategoriyani tanlang yoki yangi taom qo'shing:", {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        ...categoryButtons,
        [{ text: "➕ Yangi taom qo'shish", callback_data: "admin:additem" }],
        [{ text: "⬅️ Orqaga", callback_data: "admin:menu" }],
      ],
    },
  });
}

async function showAdminCategoryItems(chatId, messageId, categoryId) {
  const category = await getCategoryById(categoryId);
  const items = await getAllItemsByCategoryIdForAdmin(categoryId);
  const categoryName = category?.name ?? "Kategoriya";

  if (items.length === 0) {
    await bot.editMessageText(`*${categoryName}*\n\nBu kategoriyada taom yo'q.`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "admin:menuadmin" }]] },
    });
    return;
  }

  const itemRows = items.map((item) => [
    {
      text: `${item.is_available ? "✅" : "🚫"} ${item.name} — ${formatPrice(item.price)}`,
      callback_data: `admin:toggleitem:${item.id}:${categoryId}`,
    },
    { text: "🗑", callback_data: `admin:deleteitem:${item.id}:${categoryId}` },
  ]);

  await bot.editMessageText(
    `*${categoryName}*\n\nTaom nomini bosish — yoqish/yashirish, 🗑 — o'chirish:`,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [...itemRows, [{ text: "⬅️ Orqaga", callback_data: "admin:menuadmin" }]],
      },
    }
  );
}

async function startAdminAddItem(chatId, messageId) {
  const categories = await getCategories();

  startAddItemSession(chatId);

  const categoryButtons = categories.map((category) => [
    { text: category.name, callback_data: `admin:additemcat:${category.id}` },
  ]);

  await bot.editMessageText("Qaysi kategoriyaga taom qo'shmoqchisiz?", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [
        ...categoryButtons,
        [{ text: "⬅️ Bekor qilish", callback_data: "admin:menuadmin" }],
      ],
    },
  });
}

async function selectAdminAddItemCategory(chatId, categoryId) {
  updateAddItemSession(chatId, { categoryId, step: "awaiting_name" });
  await bot.sendMessage(chatId, "Taom nomini kiriting:");
}

async function handleAdminAddItemName(chatId, text) {
  if (!text.trim()) {
    await bot.sendMessage(chatId, "Iltimos, taom nomini kiriting.");
    return;
  }

  updateAddItemSession(chatId, { name: text.trim(), step: "awaiting_price" });
  await bot.sendMessage(chatId, "Narxini kiriting (so'mda, faqat son), masalan: 25000");
}

async function handleAdminAddItemPrice(chatId, text) {
  const price = Number(text.trim());

  if (!Number.isFinite(price) || price <= 0) {
    await bot.sendMessage(chatId, "Narx noto'g'ri. Faqat musbat son kiriting, masalan: 25000");
    return;
  }

  updateAddItemSession(chatId, { price, step: "awaiting_description" });
  await bot.sendMessage(chatId, "Tavsif kiriting (agar tavsif bo'lmasa, '-' deb yozing):");
}

async function handleAdminAddItemDescription(chatId, text) {
  const session = getAddItemSession(chatId);
  const description = text.trim() === "-" ? null : text.trim();

  const item = await createMenuItem({
    categoryId: session.categoryId,
    name: session.name,
    price: session.price,
    description,
  });

  endAddItemSession(chatId);

  await bot.sendMessage(chatId, `✅ Yangi taom qo'shildi: *${item.name}* — ${formatPrice(item.price)}`, {
    parse_mode: "Markdown",
  });
}

async function toggleAdminItemAvailability(chatId, messageId, itemId, categoryId) {
  const items = await getAllItemsByCategoryIdForAdmin(categoryId);
  const item = items.find((existingItem) => existingItem.id === itemId);

  if (!item) {
    return;
  }

  await setMenuItemAvailability(itemId, !item.is_available);
  await showAdminCategoryItems(chatId, messageId, categoryId);
}

async function deleteAdminItem(chatId, messageId, itemId, categoryId) {
  await deleteMenuItem(itemId);
  await showAdminCategoryItems(chatId, messageId, categoryId);
}

function registerAdminCommand() {
  bot.onText(/^\/admin$/, async (message) => {
    const chatId = message.chat.id;

    try {
      if (!(await isAdmin(message.from.id))) {
        await bot.sendMessage(chatId, "Sizda admin huquqi yo'q.");
        return;
      }

      await bot.sendMessage(chatId, "🔐 *Admin panel*\n\nBo'limni tanlang:", {
        parse_mode: "Markdown",
        reply_markup: buildAdminMainMenuKeyboard(),
      });
    } catch (error) {
      console.error("/admin buyrug'ida xatolik:", error.message);
    }
  });
}

function registerAddAdminCommand() {
  bot.onText(/^\/add_admin (\d+)$/, async (message, match) => {
    const chatId = message.chat.id;
    const newAdminTelegramId = Number(match[1]);

    try {
      if (!(await isAdmin(message.from.id))) {
        await bot.sendMessage(chatId, "Sizda admin huquqi yo'q.");
        return;
      }

      await addAdminByTelegramId(newAdminTelegramId, null);
      await bot.sendMessage(chatId, `✅ ${newAdminTelegramId} endi admin.`);
    } catch (error) {
      console.error("/add_admin buyrug'ida xatolik:", error.message);
      await bot.sendMessage(chatId, "Admin qo'shishda xatolik yuz berdi.");
    }
  });
}

function registerAdminMenuFlow() {
  bot.on("message", async (message) => {
    const chatId = message.chat.id;
    const session = getAddItemSession(chatId);

    if (!session || message.text?.startsWith("/")) {
      return;
    }

    try {
      if (session.step === "awaiting_category") {
        await bot.sendMessage(chatId, "Iltimos, yuqoridagi kategoriya tugmalaridan birini tanlang.");
      } else if (session.step === "awaiting_name") {
        await handleAdminAddItemName(chatId, message.text ?? "");
      } else if (session.step === "awaiting_price") {
        await handleAdminAddItemPrice(chatId, message.text ?? "");
      } else if (session.step === "awaiting_description") {
        await handleAdminAddItemDescription(chatId, message.text ?? "");
      }
    } catch (error) {
      console.error("Admin taom qo'shishda xatolik:", error.message);
      await bot.sendMessage(chatId, "Xatolik yuz berdi. Qaytadan boshlang.");
      endAddItemSession(chatId);
    }
  });
}

function registerAdminCallbacks() {
  bot.on("callback_query", async (callbackQuery) => {
    const data = callbackQuery.data;

    if (!data.startsWith("admin:")) {
      return;
    }

    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    try {
      if (!(await isAdmin(callbackQuery.from.id))) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "Sizda admin huquqi yo'q.",
          show_alert: true,
        });
        return;
      }

      const [, action, ...rest] = data.split(":");

      if (action === "menu") {
        await showAdminMainMenu(chatId, messageId);
      } else if (action === "orders") {
        await showAdminOrders(chatId, messageId);
      } else if (action === "reservations") {
        await showAdminReservations(chatId, messageId);
      } else if (action === "resstatus") {
        await showReservationStatusOptions(chatId, messageId, Number(rest[0]));
      } else if (action === "setresstatus") {
        await applyReservationStatus(chatId, messageId, Number(rest[0]), rest[1]);
      } else if (action === "stats") {
        await showAdminStats(chatId, messageId);
      } else if (action === "menuadmin") {
        await showAdminMenuManagement(chatId, messageId);
      } else if (action === "items") {
        await showAdminCategoryItems(chatId, messageId, Number(rest[0]));
      } else if (action === "orderstatus") {
        await showOrderStatusOptions(chatId, messageId, Number(rest[0]));
      } else if (action === "setstatus") {
        await applyOrderStatus(chatId, messageId, Number(rest[0]), rest[1]);
      } else if (action === "additem") {
        await startAdminAddItem(chatId, messageId);
      } else if (action === "additemcat") {
        await selectAdminAddItemCategory(chatId, Number(rest[0]));
      } else if (action === "toggleitem") {
        await toggleAdminItemAvailability(chatId, messageId, Number(rest[0]), Number(rest[1]));
      } else if (action === "deleteitem") {
        await deleteAdminItem(chatId, messageId, Number(rest[0]), Number(rest[1]));
      }

      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error("Admin callback xatosida xatolik:", error.message);
      try {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Xatolik yuz berdi." });
      } catch {
        // callback allaqachon javob berilgan bo'lishi mumkin, e'tiborsiz qoldiramiz
      }
    }
  });
}

function registerAiConversationFlow() {
  bot.on("message", async (message) => {
    const chatId = message.chat.id;
    const text = message.text;

    if (!text || text.startsWith("/")) {
      return;
    }

    if (MAIN_MENU_BUTTON_TEXT_SET.has(text)) {
      return;
    }

    if (getCheckoutSession(chatId) || getReservationSession(chatId) || getAddItemSession(chatId)) {
      return;
    }

    try {
      await bot.sendChatAction(chatId, "typing");
      const reply = await processUserMessage(chatId, text, message.from);
      await bot.sendMessage(chatId, reply);
    } catch (error) {
      console.error("AI suhbatida xatolik:", error.message);
      await bot.sendMessage(
        chatId,
        "Kechirasiz, hozir javob bera olmadim. Birozdan so'ng qayta urinib ko'ring."
      );
    }
  });
}

function registerVoiceMessageFlow() {
  bot.on("voice", async (message) => {
    const chatId = message.chat.id;

    if (getCheckoutSession(chatId) || getReservationSession(chatId) || getAddItemSession(chatId)) {
      await bot.sendMessage(
        chatId,
        "Hozir davom etayotgan jarayon bor. Iltimos, uni matn bilan yakunlang."
      );
      return;
    }

    try {
      await bot.sendChatAction(chatId, "typing");

      const fileLink = await bot.getFileLink(message.voice.file_id);
      const response = await axios.get(fileLink, { responseType: "arraybuffer" });
      const audioBuffer = Buffer.from(response.data);
      const mimeType = message.voice.mime_type || "audio/ogg";

      const reply = await processVoiceMessage(chatId, audioBuffer, mimeType, message.from);
      await bot.sendMessage(chatId, reply);
    } catch (error) {
      console.error("Ovozli xabarni qayta ishlashda xatolik:", error.message);
      await bot.sendMessage(
        chatId,
        "Kechirasiz, ovozli xabaringizni qayta ishlay olmadim. Matn bilan yozib ko'ring."
      );
    }
  });
}

function registerMenuCallbacks() {
  bot.on("callback_query", async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    try {
      if (data === "menu") {
        await showCategories(chatId, messageId);
        await bot.answerCallbackQuery(callbackQuery.id);
      } else if (data.startsWith("cat:")) {
        const categoryId = Number(data.split(":")[1]);
        await showCategoryItems(chatId, messageId, categoryId);
        await bot.answerCallbackQuery(callbackQuery.id);
      } else if (data === "cart") {
        await showCart(chatId, messageId);
        await bot.answerCallbackQuery(callbackQuery.id);
      } else if (data.startsWith("add:")) {
        const itemId = Number(data.split(":")[1]);
        const item = await getItemById(itemId);

        if (!item) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Taom topilmadi.",
            show_alert: true,
          });
          return;
        }

        addItemToCart(chatId, item);
        await bot.answerCallbackQuery(callbackQuery.id, { text: `Qo'shildi: ${item.name}` });
      } else if (data.startsWith("rm:")) {
        const itemId = Number(data.split(":")[1]);
        removeItemFromCart(chatId, itemId);
        await showCart(chatId, messageId);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "O'chirildi" });
      } else if (data === "clear_cart") {
        clearCart(chatId);
        await showCart(chatId, messageId);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Savat tozalandi" });
      } else if (data === "checkout") {
        const cartLines = getCart(chatId);

        if (cartLines.length === 0) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Savat bo'sh.",
            show_alert: true,
          });
          return;
        }

        startCheckout(chatId);
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(chatId, "📞 Telefon raqamingizni yuboring:", {
          reply_markup: {
            keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
      } else if (data === "confirm_order") {
        const session = getCheckoutSession(chatId);
        const cartLines = getCart(chatId);

        if (!session || session.step !== "confirming" || cartLines.length === 0) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Buyurtma topilmadi.",
            show_alert: true,
          });
          return;
        }

        const user = await upsertUser(callbackQuery.from);

        const order = await createOrder({
          userId: user.id,
          phoneNumber: session.phoneNumber,
          latitude: session.latitude,
          longitude: session.longitude,
          addressText: session.addressText,
          items: cartLines,
        });

        clearCart(chatId);
        endCheckout(chatId);

        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.editMessageText(
          `✅ Buyurtmangiz qabul qilindi!\n\nBuyurtma raqami: #${order.id}\nJami: ${formatPrice(
            order.total_price
          )}\n\nTez orada operatorlarimiz siz bilan bog'lanadi.`,
          { chat_id: chatId, message_id: messageId }
        );

        const customerName = user.first_name || user.username || "Noma'lum";
        const addressLine = session.addressText ?? `${session.latitude}, ${session.longitude}`;
        const itemsLines = cartLines
          .map((line) => `  • ${line.name} x${line.quantity}`)
          .join("\n");

        await notifyOrdersGroup(
          `🆕 *Yangi buyurtma!*\n\n` +
            `#${order.id}\n` +
            `👤 ${customerName}\n` +
            `📞 ${session.phoneNumber}\n` +
            `📍 ${addressLine}\n\n` +
            `${itemsLines}\n\n` +
            `💰 Jami: ${formatPrice(order.total_price)}`
        );
      } else if (data === "cancel_order") {
        endCheckout(chatId);
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.editMessageText("❌ Buyurtma bekor qilindi. Savatingiz saqlanib qoldi.", {
          chat_id: chatId,
          message_id: messageId,
        });
      } else if (data.startsWith("book_date:")) {
        const value = data.split(":")[1];
        await bot.answerCallbackQuery(callbackQuery.id);
        await handleReservationDateStep(chatId, value);
      } else if (data === "confirm_reservation") {
        const session = getReservationSession(chatId);

        if (!session || session.step !== "confirming") {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Bron topilmadi.",
            show_alert: true,
          });
          return;
        }

        const user = await upsertUser(callbackQuery.from);

        const reservation = await createReservation({
          userId: user.id,
          date: session.date,
          time: session.time,
          guestsCount: session.guestsCount,
          phoneNumber: session.phoneNumber,
        });

        endReservationSession(chatId);

        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.editMessageText(
          `✅ Stol bron qilindi!\n\n` +
            `Bron raqami: #${reservation.id}\n` +
            `📅 ${session.date} ${session.time}\n` +
            `👥 ${session.guestsCount} kishi\n\n` +
            `Sizni kutamiz!`,
          { chat_id: chatId, message_id: messageId }
        );

        const reservationCustomerName = user.first_name || user.username || "Noma'lum";

        await notifyOrdersGroup(
          `🆕 *Yangi bron!*\n\n` +
            `#${reservation.id}\n` +
            `👤 ${reservationCustomerName}\n` +
            `📞 ${session.phoneNumber}\n` +
            `📅 ${session.date} 🕐 ${session.time}\n` +
            `👥 ${session.guestsCount} kishi`
        );
      } else if (data === "cancel_reservation") {
        endReservationSession(chatId);
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.editMessageText("❌ Bron bekor qilindi.", {
          chat_id: chatId,
          message_id: messageId,
        });
      } else {
        await bot.answerCallbackQuery(callbackQuery.id);
      }
    } catch (error) {
      console.error("Callback query xatosida xatolik:", error.message);
      try {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Xatolik yuz berdi." });
      } catch {
        // callback allaqachon javob berilgan bo'lishi mumkin, e'tiborsiz qoldiramiz
      }
    }
  });
}

function registerErrorHandlers() {
  bot.on("polling_error", (error) => {
    console.error("Telegram polling xatosi:", error.message);
  });
}

export function startBot() {
  registerUserTracking();
  registerStartCommand();
  registerMenuCommand();
  registerMainMenuButtonsFlow();
  registerCartCommand();
  registerCheckoutFlow();
  registerBookCommand();
  registerReservationFlow();
  registerAdminCommand();
  registerGroupIdCommand();
  registerAddAdminCommand();
  registerAdminMenuFlow();
  registerAiConversationFlow();
  registerVoiceMessageFlow();
  registerMenuCallbacks();
  registerAdminCallbacks();
  registerErrorHandlers();

  console.log("Telegram bot polling rejimida ishga tushdi.");
}
