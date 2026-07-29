import { upsertUser } from "./database.js";
import { runConversation } from "./ai.js";
import { toolDeclarations, toolHandlers } from "./tools.js";

const MAX_HISTORY_MESSAGES = 20;

const conversations = new Map();

const SYSTEM_INSTRUCTION = `
Sen "Fantaziya Restaurant" Telegram botining sun'iy intellekt yordamchisisan.
Har doim o'zbek tilida, qisqa va do'stona javob ber.

Sening vazifalaring:
- Menyu haqida savollarga javob berish (kategoriyalar, taomlar, narxlar).
- Foydalanuvchi aytgan taomlarni savatga qo'shish yoki olib tashlash.
- Stol bron qilish (sana, vaqt, mehmonlar soni va telefon raqami to'plangandan keyin).

Muhim qoidalar:
- Agar funksiya uchun kerakli ma'lumot (masalan telefon raqami yoki mehmonlar soni) xabarda yo'q bo'lsa,
  funksiyani chaqirmasdan avval o'sha ma'lumotni so'ra.
- Savatni to'ldirishing mumkin, lekin yakuniy buyurtmani (yetkazib berish uchun manzil kerak bo'lgani sababli)
  o'zing yakunlay olmaysan. Savat to'lgandan keyin foydalanuvchiga "/cart buyrug'ini yuboring va
  '✅ Buyurtma berish' tugmasini bosing" deb ayt.
- Menyuda yo'q taom haqida so'ralsa, buni aniq ayt, o'ylab topma.
`.trim();

function getHistory(chatId) {
  return conversations.get(chatId) ?? [];
}

function saveHistory(chatId, contents) {
  conversations.set(chatId, contents.slice(-MAX_HISTORY_MESSAGES));
}

async function runTurn(chatId, telegramFrom, parts, fallbackMessage) {
  const user = await upsertUser(telegramFrom);

  const history = getHistory(chatId);
  const contents = [...history, { role: "user", parts }];

  const { text: replyText, contents: updatedContents } = await runConversation({
    contents,
    toolDeclarations,
    toolHandlers,
    context: { chatId, userId: user.id },
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  saveHistory(chatId, updatedContents);

  return replyText || fallbackMessage;
}

export async function processUserMessage(chatId, text, telegramFrom) {
  return runTurn(
    chatId,
    telegramFrom,
    [{ text }],
    "Kechirasiz, javob shakllantira olmadim. Qaytadan urinib ko'ring."
  );
}

export async function processVoiceMessage(chatId, audioBuffer, mimeType, telegramFrom) {
  const audioPart = { inlineData: { mimeType, data: audioBuffer.toString("base64") } };

  return runTurn(
    chatId,
    telegramFrom,
    [audioPart],
    "Kechirasiz, ovozli xabaringizni tushuna olmadim. Qaytadan urinib ko'ring yoki matn yozing."
  );
}

export function resetConversation(chatId) {
  conversations.delete(chatId);
}
