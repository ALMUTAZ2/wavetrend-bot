import { fetchCandles } from "./price-data"
import { computeWaveTrend, detectDivergences, detectActionEvents, DEFAULT_WAVETREND_PARAMS, DEFAULT_DIVERGENCE_PARAMS, DEFAULT_ACTION_PARAMS, TIMEFRAMES } from "./wavetrend"
import { sendTelegramAlert } from "./signals"
import { connectDB, saveSignal } from "./mongodb"
import dotenv from "dotenv"

dotenv.config()

async function runEngine() {
  await connectDB()
  console.log("🚀 البوت قيد العمل ومراقبة الأسواق...")

  // حلقة فحص دورية كل دقيقة
  setInterval(async () => {
    try {
      const symbol = "SPX500"
      const tf = TIMEFRAMES["5"] // فاصل 5 دقائق
      const candles = await fetchCandles(symbol, tf.id)

      const wtResult = computeWaveTrend(candles, DEFAULT_WAVETREND_PARAMS)
      const divEvents = detectDivergences(candles, wtResult, DEFAULT_DIVERGENCE_PARAMS)
      const actionEvents = detectActionEvents(candles, divEvents, wtResult, DEFAULT_ACTION_PARAMS, tf)

      for (const event of actionEvents) {
        // التحقق من أن الإشارة حدثت على الشمعة الأخيرة
        if (event.barIndex === candles.length - 1) {
          await sendTelegramAlert(symbol, event, tf.label)
          await saveSignal({ symbol, event, timeframe: tf.id, timestamp: new Date() })
        }
      }
    } catch (error) {
      console.error("خطأ أثناء الفحص:", error)
    }
  }, 60 * 1000)
}

runEngine()
