import express from "express";
import { config } from "./config.js";
import { initDatabase } from "./database.js";
import { initMenuTables } from "./menu.js";
import { initOrderTables } from "./orders.js";
import { initReservationTables } from "./reservations.js";
import { initAdminTables } from "./admin.js";
import { startBot } from "./telegram.js";

async function bootstrap() {
  await initDatabase();
  await initMenuTables();
  await initOrderTables();
  await initReservationTables();
  await initAdminTables();

  const app = express();

  app.get("/health", (request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.listen(config.port, () => {
    console.log(`Health-check server ${config.port}-portda ishlamoqda.`);
  });

  startBot();

  console.log(
    config.ordersGroupChatId
      ? `Guruh bildirishnomasi YOQILGAN. Chat ID: ${config.ordersGroupChatId}`
      : "Guruh bildirishnomasi O'CHIRILGAN (ORDERS_GROUP_CHAT_ID sozlanmagan)."
  );

  console.log("Fantaziya Restaurant bot muvaffaqiyatli ishga tushdi.");
}

bootstrap().catch((error) => {
  console.error("Botni ishga tushirishda xatolik:", error);
  process.exit(1);
});
