/**
 * Signal generation — converts the raw WaveTrend oscillator, divergence, and
 * action-motor outputs into the concrete trading signals the bot alerts on:
 * direction, entry, stop-loss, and three Fibonacci-structured targets.
 *
 * Targets and stop are derived from ATR volatility (matching the indicator's
 * ATR-aware philosophy) and recent swing structure, never invented.
 */
import {
  type ActionEvent,
  type Candle,
  type DivergenceEvent,
  type StatusKey,
  type WaveTrendResult,
  statusArabic,
} from "./wavetrend"
import { atrSeries, highestSeries, lowestSeries } from "./math"

export type SignalSide = "buy" | "sell"
export type SignalStrength = "jackpot" | "strong" | "confirmed" | "early" | "watch"

export interface TradeTargets {
  entry: number
  stopLoss: number
  /** Three ordered targets, nearest first. */
  targets: number[]
  /** Risk/reward per target, entry→target vs entry→stop. */
  riskReward: number[]
  /** ATR-derived unit of volatility used to build the levels. */
  atrUnit: number
}

export interface TradingSignal {
  id: string
  /** Wall-clock of the signal bar (ms). */
  time: number
  timeframe: string
  symbol: string
  side: SignalSide
  strength: SignalStrength
  /** One-line Arabic headline, e.g. "إشارة شراء قوية — تقاطع قاع ↑". */
  title: string
  /** Longer Arabic body explaining the rationale. */
  rationale: string
  statusKey: StatusKey
  wt1: number
  wt2: number
  /** Originating divergence kind, if the signal stems from one. */
  divergence?: DivergenceEvent
  /** Originating action event (MSS breakout / trap), if present. */
  action?: ActionEvent
  trade: TradeTargets
}

/** Build entry / stop / targets from ATR and swing structure. */
export function buildTradeTargets(
  candles: Candle[],
  barIndex: number,
  side: SignalSide,
): TradeTargets {
  const n = candles.length
  const idx = Math.min(barIndex, n - 1)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const atr = atrSeries(high, low, close, 14)
  const atrUnit = Number.isNaN(atr[idx]) ? close[idx] * 0.004 : atr[idx]
  const entry = close[idx]

  // Swing reference over the last 15 bars (matches Pine's highest/lowest 15).
  const recentHigh = highestSeries(high, 15)[idx] ?? entry + atrUnit
  const recentLow = lowestSeries(low, 15)[idx] ?? entry - atrUnit

  let stopLoss: number
  let targets: number[]
  if (side === "buy") {
    // Stop below recent swing low, padded by a fraction of ATR.
    stopLoss = Math.min(recentLow, entry - atrUnit * 1.2)
    const risk = entry - stopLoss
    // Fibonacci-style extensions: 1R, 1.618R, 2.618R.
    targets = [entry + risk, entry + risk * 1.618, entry + risk * 2.618]
  } else {
    stopLoss = Math.max(recentHigh, entry + atrUnit * 1.2)
    const risk = stopLoss - entry
    targets = [entry - risk, entry - risk * 1.618, entry - risk * 2.618]
  }
  const riskReward = targets.map((t) => Math.abs((t - entry) / (entry - stopLoss)))
  return { entry, stopLoss, targets, riskReward, atrUnit }
}

const STATUS_TITLE: Partial<Record<StatusKey, string>> = {
  deep_dip_up: "قاع عميق — تقاطع صاعد من تشبّع بيعي",
  dip_cross_up: "تقاطع قاع صاعد من تحت الصفر",
  trend_up: "تقاطع صاعد في اتجاه صاعد",
  ceiling_sell_down: "بيع قمة — تقاطع هابط من تشبّع شرائي",
  dip_sell_down: "بيع قاع — تقاطع هابط تحت الصفر",
  breakdown_down: "كسر هابط فوق الصفر",
}

const STRENGTH_LABEL: Record<SignalStrength, string> = {
  jackpot: "جاكبوت",
  strong: "قوية",
  confirmed: "مؤكدة",
  early: "مبكرة",
  watch: "مراقبة",
}

export function strengthArabic(s: SignalStrength): string {
  return STRENGTH_LABEL[s]
}

/** Decide which WT crossover + zone combinations become actionable signals. */
export function signalsFromWaveTrend(
  candles: Candle[],
  wt: WaveTrendResult,
  tf: string,
  symbol: string,
): TradingSignal[] {
  const n = candles.length
  const signals: TradingSignal[] = []
  for (let i = 1; i < n; i++) {
    const status = wt.statusKeys[i]
    const side: SignalSide | null = wt.crossUp[i]
      ? status === "deep_dip_up"
        ? "buy"
        : status === "dip_cross_up"
          ? "buy"
          : status === "trend_up"
            ? "buy"
            : null
      : wt.crossDown[i]
        ? status === "ceiling_sell_down"
          ? "sell"
          : status === "breakdown_down"
            ? "sell"
            : status === "dip_sell_down"
            ? "sell"
            : null
        : null
    if (!side) continue

    const strength: SignalStrength =
      status === "deep_dip_up" ? "jackpot" : status === "dip_cross_up" ? "strong" : "confirmed"
    const trade = buildTradeTargets(candles, i, side)
    const title = `${side === "buy" ? "إشارة شراء" : "إشارة بيع"} ${STRENGTH_LABEL[strength]} — ${STATUS_TITLE[status] ?? "تقاطع"}`
    const rationale = `تقاطع WT1 ${side === "buy" ? "فوق" : "تحت"} WT2 عند قيمة ${wt.wt1[i].toFixed(2)}، الحالة: ${status}.`
    signals.push({
      id: `${tf}-${candles[i].time}-${side}-wt`,
      time: candles[i].time,
      timeframe: tf,
      symbol,
      side,
      strength,
      title,
      rationale,
      statusKey: status,
      wt1: wt.wt1[i],
      wt2: wt.wt2[i],
      trade,
    })
  }
  return signals
}

/** Early divergence signals — flag the divergence itself as a watch/early signal. */
export function signalsFromDivergences(
  candles: Candle[],
  divEvents: DivergenceEvent[],
  tf: string,
  symbol: string,
): TradingSignal[] {
  const signals: TradingSignal[] = []
  for (const ev of divEvents) {
    const side: SignalSide =
      ev.kind === "bull_regular" || ev.kind === "bull_hidden" ? "buy" : "sell"
    const strength: SignalStrength =
      ev.kind === "bull_regular" || ev.kind === "bear_regular" ? "early" : "watch"
    const trade = buildTradeTargets(candles, ev.barIndex, side)
    const isBull = side === "buy"
    const isHidden = ev.kind === "bull_hidden" || ev.kind === "bear_hidden"
    const title = `${isBull ? "انعكاف صاعد" : "انعكاف هابط"} ${isHidden ? "مخفي" : "عادي"} — إشارة ${isBull ? "شراء" : "بيع"} ${strength === "early" ? "مبكرة" : "مراقبة"}`
    const rationale = isBull
      ? "السعر يسجّل قاعاً أدنى بينما المؤشر يسجّل قاعاً أعلى — تباعد إيجابي يشير إلى احتمال دوران صاعد."
      : "السعر يسجّل قمة أعلى بينما المؤشر يسجّل قمة أدنى — تباعد سلبي يشير إلى احتمال دوران هابط."
    signals.push({
      id: `${tf}-${candles[ev.barIndex].time}-${side}-div-${ev.kind}`,
      time: candles[ev.barIndex].time,
      timeframe: tf,
      symbol,
      side,
      strength,
      title,
      rationale,
      statusKey: "flat",
      wt1: NaN,
      wt2: NaN,
      divergence: ev,
      trade,
    })
  }
  return signals
}

/** Promote action-motor events (MSS breakout / trap) into high-conviction signals. */
export function signalsFromActions(
  candles: Candle[],
  actionEvents: ActionEvent[],
  tf: string,
  symbol: string,
): TradingSignal[] {
  const signals: TradingSignal[] = []
  for (const ev of actionEvents) {
    const side: SignalSide = ev.type === "bear_breakout" ? "sell" : "buy"
    const strength: SignalStrength = ev.type === "bear_trap" ? "strong" : "confirmed"
    const trade = buildTradeTargets(candles, ev.barIndex, side)
    const title =
      ev.type === "bull_breakout"
        ? "كسر بنية صاعد 🚀 — إشارة شراء مؤكدة"
        : ev.type === "bear_breakout"
          ? "كسر بنية هابط 🩸 — إشارة بيع مؤكدة"
          : "فخ دب قصير 💥 — إشارة شراء قوية (Short Squeeze)"
    const rationale =
      ev.type === "bear_trap"
        ? "انعكاف تسبيعي فشل وكسر قمة الفخ لأعلى — تفعيل فخ الدبق."
        : `كسر مستوى ${ev.level.toFixed(2)} بعد تشكّل انعكاف — تأكيد بنية السوق.`
    signals.push({
      id: `${tf}-${candles[ev.barIndex].time}-${side}-action-${ev.type}`,
      time: candles[ev.barIndex].time,
      timeframe: tf,
      symbol,
      side,
      strength,
      title,
      rationale,
      statusKey: "flat",
      wt1: NaN,
      wt2: NaN,
      action: ev,
      trade,
    })
  }
  return signals
}

/**
 * Final per-timeframe snapshot — the current oscillator reading, status, and
 * active signal (if any) for the dashboard MTF table and last-bar alerts.
 */
export interface TimeframeSnapshot {
  timeframe: string
  label: string
  wt1: number
  wt2: number
  wt1Prev: number
  wt2Prev: number
  statusKey: StatusKey
  statusAr: string
  wt1Dir: "up" | "down" | "flat"
  wt2Dir: "up" | "down" | "flat"
  isOversold: boolean
  isOverbought: boolean
  crossUp: boolean
  crossDown: boolean
  lastSignal?: TradingSignal
}

export function snapshotTimeframe(
  candles: Candle[],
  wt: WaveTrendResult,
  tfId: string,
  label: string,
  signals: TradingSignal[],
  params: { obLevel1: number; osLevel1: number },
): TimeframeSnapshot {
  const n = candles.length
  const i = n - 1
  const w1 = wt.wt1[i]
  const w2 = wt.wt2[i]
  const w1p = n > 1 ? wt.wt1[i - 1] : NaN
  const w2p = n > 1 ? wt.wt2[i - 1] : NaN
  const wt1Dir = !Number.isNaN(w1p) && w1 > w1p ? "up" : !Number.isNaN(w1p) && w1 < w1p ? "down" : "flat"
  const wt2Dir = !Number.isNaN(w2p) && w2 > w2p ? "up" : !Number.isNaN(w2p) && w2 < w2p ? "down" : "flat"
  const lastSignal = signals.length ? signals[signals.length - 1] : undefined
  return {
    timeframe: tfId,
    label,
    wt1: w1,
    wt2: w2,
    wt1Prev: w1p,
    wt2Prev: w2p,
    statusKey: wt.statusKeys[i],
    statusAr: statusArabic(wt.statusKeys[i]),
    wt1Dir,
    wt2Dir,
    isOversold: w1 <= params.osLevel1,
    isOverbought: w1 >= params.obLevel1,
    crossUp: wt.crossUp[i],
    crossDown: wt.crossDown[i],
    lastSignal,
  }
}

/** Convenience re-export so callers import snapshot math from one module. */
export { statusArabic }

/**
 * MTF confluence — the indicator's "Tablo" summary. Counts how many of the
 * tracked timeframes are oversold, in a dip crossover, or in a bull crossover.
 * A three-timeframe oversold alignment is the "JACKPOT DIP" the indicator flags.
 */
export interface MtfConfluence {
  dipCount: number
  bullCrossCount: number
  positiveCount: number
  dipCrossCount: number
  crossCount: number
  summary: string
  isJackpot: boolean
}

export function mtfConfluence(snapshots: TimeframeSnapshot[]): MtfConfluence {
  let dipCount = 0
  let bullCrossCount = 0
  let positiveCount = 0
  let dipCrossCount = 0
  let crossCount = 0
  for (const s of snapshots) {
    if (s.isOversold) dipCount++
    if (s.wt1 > s.wt2) bullCrossCount++
    if (s.wt1 > 0) positiveCount++
    if (s.statusKey === "dip_cross_up") dipCrossCount++
    if (s.crossUp) crossCount++
  }
  const isJackpot = dipCount >= 3
  const summary = isJackpot
    ? "جاكبوت قاع — تشبّع بيعي في 3 أطر زمنية"
    : dipCrossCount >= 2
      ? "تقاطع قاع قوي في أكثر من إطار"
      : dipCrossCount === 1
        ? "تقاطع قاع في إطار واحد"
        : crossCount >= 2
          ? "تقاطع صاعد في أكثر من إطار"
          : bullCrossCount >= 2
            ? "تموضع صاعد في أكثر من إطار"
            : "لا توجد مواءمة قوية حالياً"
  return { dipCount, bullCrossCount, positiveCount, dipCrossCount, crossCount, summary, isJackpot }
}
