import TelegramBot from "node-telegram-bot-api"
import dotenv from "dotenv"

dotenv.config()

const token = process.env.TELEGRAM_BOT_TOKEN || ""
const chatId = process.env.TELEGRAM_CHAT_ID || ""
const bot = new TelegramBot(token, { polling: false })

export async function sendTelegramAlert(symbol: string, event: any, tfLabel: string) {
  if (!token || !chatId) {
    console.log("Telegram token or chat ID is missing. Skipping alert.")
    return
  }

  let message = `🚨 **تنبيه تداول جديد** (${symbol})\n`
  message += `⏱️ الفاصل الزمني: ${tfLabel}\n`
  message += `📊 النوع: ${event.type}\n`
  message += `📌 المستوى: ${event.level}\n`

  try {
    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" })
    console.log("تم إرسال تنبيه تيليجرام بنجاح")
  } catch (error) {
    console.error("خطأ في إرسال تنبيه تيليجرام:", error)
  }
}
