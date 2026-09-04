/**
 * WaveTrend oscillator engine — a TypeScript port of the Pine v5 indicator
 * "WaveTrend MTF DP Div v5.0 PRO" (@TTesviyeci / LazyBear lineage).
 *
 * This module owns the numerical heart of the signal bot. It faithfully
 * reproduces the indicator's three layers:
 *
 *   1. WaveTrend oscillator (dynamic ATR-flexing periods + WT1/WT2 cross logic)
 *   2. Status engine (crossover-priority + zone/direction matrix → Arabic state labels)
 *   3. Action motor (divergence detection → MSS breakout / short-squeeze traps)
 *
 * The outputs feed both the chart in the dashboard and the Telegram alert copy.
 */
import {
  atrSeries,
  crossoverSeries,
  crossunderSeries,
  dynamicEmaSeries,
  emaSeries,
  hmaSeries,
  smaSeries,
  stdevSeries,
} from "./math"

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type CalcMode = "auto" | "manual"

export interface WaveTrendParams {
  calcMode: CalcMode
  /** Base channel length (Pine `n1_in`, default 10). */
  channelLength: number
  /** Base average length (Pine `n2_in`, default 21). */
  avgLength: number
  obLevel1: number
  obLevel2: number
  osLevel1: number
  osLevel2: number
  /** Smart shield: trend filter. */
  useTrendFilter: boolean
  trendPeriod: number
  trendType: "EMA" | "HMA" | "SMA"
  /** Smart shield: volatility (rubber band) sensor. */
  useVolFilter: boolean
  volMultiplier: number
}

export const DEFAULT_WAVETREND_PARAMS: WaveTrendParams = {
  calcMode: "auto",
  channelLength: 10,
  avgLength: 21,
  obLevel1: 60,
  obLevel2: 53,
  osLevel1: -60,
  osLevel2: -53,
  useTrendFilter: false,
  trendPeriod: 55,
  trendType: "EMA",
  useVolFilter: false,
  volMultiplier: 2,
}

export type DivMotor = "smart" | "fast" | "standard"
export type DivType = "regular" | "hidden" | "both"
export type DivPriceSource = "hl" | "close" | "auto_atr" | "auto_bb"

export interface DivergenceParams {
  enabled: boolean
  type: DivType
  motor: DivMotor
  priceSource: DivPriceSource
  lookbackRight: number
  lookbackLeft: number
  maxBarsBack: number
  minGap: number
  autoAtrLen: number
  autoAtrSma: number
  autoAtrMult: number
  autoBbLen: number
  autoBbSma: number
}

export const DEFAULT_DIVERGENCE_PARAMS: DivergenceParams = {
  enabled: true,
  type: "both",
  motor: "smart",
  priceSource: "hl",
  lookbackRight: 3,
  lookbackLeft: 3,
  maxBarsBack: 60,
  minGap: 5,
  autoAtrLen: 14,
  autoAtrSma: 50,
  autoAtrMult: 1.5,
  autoBbLen: 20,
  autoBbSma: 50,
}

export type WaitMode = "auto" | "fixed"

export interface ActionParams {
  useBreakout: boolean
  useBearTrap: boolean
  autoWaitMultiplier: boolean
  maxWaitBars: number
}

export const DEFAULT_ACTION_PARAMS: ActionParams = {
  useBreakout: true,
  useBearTrap: true,
  autoWaitMultiplier: true,
  maxWaitBars: 15,
}

/** Canonical Pine timeframe labels used across the MTF table and alerts. */
export interface TimeframeDef {
  /** Canonical id, e.g. "W", "D", "240", "60". */
  id: string
  /** Human label (Arabic) for the table and alerts. */
  label: string
  /** Seconds — used to order timeframes and detect "bigger tf" relationships. */
  seconds: number
  /** Multiplier applied to the wait-window when the smart time multiplier is on. */
  waitMultiplier: number
}

export const TIMEFRAMES: Record<string, TimeframeDef> = {
  W: { id: "W", label: "أسبوعي", seconds: 604800, waitMultiplier: 1 },
  D: { id: "D", label: "يومي", seconds: 86400, waitMultiplier: 1 },
  "240": { id: "240", label: "4 ساعات", seconds: 14400, waitMultiplier: 2 },
  "180": { id: "180", label: "3 ساعات", seconds: 10800, waitMultiplier: 2 },
  "120": { id: "120", label: "ساعتين", seconds: 7200, waitMultiplier: 2 },
  "60": { id: "60", label: "ساعة", seconds: 3600, waitMultiplier: 3 },
  "45": { id: "45", label: "45 دقيقة", seconds: 2700, waitMultiplier: 4 },
  "30": { id: "30", label: "30 دقيقة", seconds: 1800, waitMultiplier: 4 },
  "15": { id: "15", label: "15 دقيقة", seconds: 900, waitMultiplier: 4 },
  "5": { id: "5", label: "5 دقائق", seconds: 300, waitMultiplier: 4 },
  "1": { id: "1", label: "دقيقة", seconds: 60, waitMultiplier: 4 },
}

/** Raw oscillator series produced per timeframe. */
export interface WaveTrendResult {
  wt1: number[]
  wt2: number[]
  wtDiff: number[]
  crossUp: boolean[]
  crossDown: boolean[]
  /** Per-bar status key (machine) — translated to Arabic at the boundary. */
  statusKeys: StatusKey[]
  /** Shield gate flags per bar. */
  allowBullDiv: boolean[]
  allowBearDiv: boolean[]
  /** Dynamic periods actually used each bar. */
  dynN1: number[]
  dynN2: number[]
}

export type StatusKey =
  | "deep_dip_up"
  | "dip_cross_up"
  | "trend_up"
  | "ceiling_sell_down"
  | "dip_sell_down"
  | "breakdown_down"
  | "ceiling_turn"
  | "at_ceiling"
  | "early_warning"
  | "warning_up"
  | "rising"
  | "falling"
  | "recovering"
  | "weakening"
  | "dip_turn"
  | "at_dip"
  | "flat"

const STATUS_AR: Record<StatusKey, string> = {
  deep_dip_up: "قاع عميق ↑",
  dip_cross_up: "تقاطع قاع ↑",
  trend_up: "اتجاه ↑",
  ceiling_sell_down: "بيع قمة ↓",
  dip_sell_down: "بيع قاع ↓",
  breakdown_down: "كسر ↓",
  ceiling_turn: "انعطاف قمة",
  at_ceiling: "عند القمة",
  early_warning: "إنذار مبكر",
  warning_up: "إنذار صاعد",
  rising: "صاعد",
  falling: "هابط",
  recovering: "يتعافى",
  weakening: "يضعف",
  dip_turn: "انعطاف قاع",
  at_dip: "عند القاع",
  flat: "أفقي",
}

export function statusArabic(key: StatusKey): string {
  return STATUS_AR[key] ?? "أفقي"
}

/** Status classification reproduced from Pine `f_durum`. */
function classifyStatus(
  w1: number,
  w2: number,
  w1p: number,
  w2p: number,
  ob1: number,
  ob2: number,
  os1: number,
  os2: number,
): StatusKey {
  const ky = w1p <= w2p && w1 > w2
  const ka = w1p >= w2p && w1 < w2
  const w1y = w1 > w1p
  const w1a = w1 < w1p

  if (ky && w1 <= os1) return "deep_dip_up"
  if (ky && w1 < 0) return "dip_cross_up"
  if (ky) return "trend_up"
  if (ka && w1 >= ob1) return "ceiling_sell_down"
  if (ka && w1 < 0) return "dip_sell_down"
  if (ka) return "breakdown_down"
  if (w1 >= ob1 && w1a) return "ceiling_turn"
  if (w1 >= ob1 && w1y) return "at_ceiling"
  if (w1 >= ob2 && w1a) return "early_warning"
  if (w1 >= ob2 && w1y) return "warning_up"
  if (w1 >= os2 && w1a) return "falling"
  if (w1 >= os2 && w1y) return "rising"
  if (w1 <= os1 && w1y) return "dip_turn"
  if (w1 <= os1 && w1a) return "at_dip"
  if (w1 <= os2 && w1y) return "recovering"
  if (w1 <= os2 && w1a) return "weakening"
  return "flat"
}

/**
 * Compute the WaveTrend oscillator + status matrix for a single timeframe.
 * Mirrors Pine `f_wt_calc` with the dynamic ATR period flex.
 */
export function computeWaveTrend(
  candles: Candle[],
  params: WaveTrendParams,
): WaveTrendResult {
  const n = candles.length
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)

  // Dynamic ATR-flexing periods (Pine vol_ratio / clamped_ratio).
  const atrCur = atrSeries(high, low, close, 14)
  const atrSma = smaSeries(atrCur, 50)
  const dynN1: number[] = Array.from({ length: n }, () => params.channelLength)
  const dynN2: number[] = Array.from({ length: n }, () => params.avgLength)
  if (params.calcMode === "auto") {
    for (let i = 0; i < n; i++) {
      const base = atrSma[i]
      const ratio = !Number.isNaN(base) && base > 0 ? atrCur[i] / base : 1
      const clamped = Math.max(0.6, Math.min(1.5, ratio))
      dynN1[i] = Math.max(1, Math.round(params.channelLength * clamped))
      dynN2[i] = Math.max(1, Math.round(params.avgLength * clamped))
    }
  }

  // WaveTrend core — esa = dyn_ema(hlc3, n1), d = dyn_ema(|hlc3-esa|, n1)
  const esa = dynamicEmaSeries(hlc3, dynN1)
  const absDiff = hlc3.map((v, i) => (Number.isNaN(esa[i]) ? NaN : Math.abs(v - esa[i])))
  const d = dynamicEmaSeries(absDiff, dynN1)
  // ci = (hlc3 - esa) / (0.015 * max(d, 1e-6)) — Pine's divide-by-zero guard.
  const ci = hlc3.map((v, i) => {
    if (Number.isNaN(esa[i]) || Number.isNaN(d[i])) return NaN
    return (v - esa[i]) / (0.015 * Math.max(d[i], 0.000001))
  })
  // wt1 = dyn_ema(ci, n2), wt2 = sma(wt1, 4) — WT2 is fixed at 4 by design.
  const wt1 = dynamicEmaSeries(ci, dynN2)
  const wt2 = smaSeries(wt1, 4)
  const wtDiff = wt1.map((v, i) => (Number.isNaN(v) || Number.isNaN(wt2[i]) ? NaN : v - wt2[i]))

  const wt1Prev: number[] = Array.from({ length: n }, () => NaN)
  const wt2Prev: number[] = Array.from({ length: n }, () => NaN)
  for (let i = 1; i < n; i++) {
    wt1Prev[i] = wt1[i - 1]
    wt2Prev[i] = wt2[i - 1]
  }

  const crossUp = crossoverSeries(wt1, wt2)
  const crossDown = crossunderSeries(wt1, wt2)

  // Smart shield.
  const kalkanMA =
    params.trendType === "EMA"
      ? emaSeries(close, params.trendPeriod)
      : params.trendType === "HMA"
        ? hmaSeries(close, params.trendPeriod)
        : smaSeries(close, params.trendPeriod)
  const dev = stdevSeries(close, params.trendPeriod).map((v) => (Number.isNaN(v) ? 0 : v * params.volMultiplier))
  const allowBullDiv: boolean[] = Array.from({ length: n }, () => false)
  const allowBearDiv: boolean[] = Array.from({ length: n }, () => false)
  for (let i = 0; i < n; i++) {
    const trendStatus = close[i] > kalkanMA[i] ? 1 : close[i] < kalkanMA[i] ? -1 : 0
    const isPriceOversold = close[i] < kalkanMA[i] - dev[i]
    const isPriceOverbought = close[i] > kalkanMA[i] + dev[i]
    allowBullDiv[i] = !params.useTrendFilter || trendStatus === 1 || (params.useVolFilter && isPriceOversold)
    allowBearDiv[i] = !params.useTrendFilter || trendStatus === -1 || (params.useVolFilter && isPriceOverbought)
  }

  const statusKeys: StatusKey[] = Array.from({ length: n }, () => "flat" as StatusKey)
  for (let i = 0; i < n; i++) {
    if (i === 0 || Number.isNaN(wt1[i]) || Number.isNaN(wt2[i]) || Number.isNaN(wt1Prev[i]) || Number.isNaN(wt2Prev[i])) {
      statusKeys[i] = "flat"
      continue
    }
    statusKeys[i] = classifyStatus(
      wt1[i],
      wt2[i],
      wt1Prev[i],
      wt2Prev[i],
      params.obLevel1,
      params.obLevel2,
      params.osLevel1,
      params.osLevel2,
    )
  }

  return { wt1, wt2, wtDiff, crossUp, crossDown, statusKeys, allowBullDiv, allowBearDiv, dynN1, dynN2 }
}

/** Pivot detection — Pine `ta.pivothigh` / `ta.pivotlow` at the right-confirmed bar. */
function pivotHigh(src: number[], left: number, right: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  for (let i = left + right - 1; i < n - 1; i++) {
    const center = i - right + 1
    const v = src[center]
    if (Number.isNaN(v)) continue
    let isPivot = true
    for (let j = 1; j <= left; j++) {
      if (center - j < 0 || Number.isNaN(src[center - j]) || src[center - j] >= v) {
        isPivot = false
        break
      }
    }
    if (isPivot) {
      for (let j = 1; j <= right; j++) {
        if (center + j >= n || Number.isNaN(src[center + j]) || src[center + j] >= v) {
          isPivot = false
          break
        }
      }
    }
    if (isPivot) out[i] = v
  }
  return out
}

function pivotLow(src: number[], left: number, right: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  for (let i = left + right - 1; i < n - 1; i++) {
    const center = i - right + 1
    const v = src[center]
    if (Number.isNaN(v)) continue
    let isPivot = true
    for (let j = 1; j <= left; j++) {
      if (center - j < 0 || Number.isNaN(src[center - j]) || src[center - j] <= v) {
        isPivot = false
        break
      }
    }
    if (isPivot) {
      for (let j = 1; j <= right; j++) {
        if (center + j >= n || Number.isNaN(src[center + j]) || src[center + j] <= v) {
          isPivot = false
          break
        }
      }
    }
    if (isPivot) out[i] = v
  }
  return out
}

export type DivKind = "bull_regular" | "bull_hidden" | "bear_regular" | "bear_hidden"

export interface DivergenceEvent {
  /** Bar index where the divergence is confirmed (the right pivot bar). */
  barIndex: number
  kind: DivKind
  motor: DivMotor
}

/**
 * Detect divergences using the chosen motor.
 *
 * - fast: V-turn detection (no pivot confirmation).
 * - standard: classic TradingView pivot logic.
 * - smart: Lonesome Hybrid — pivots with volatility-aware pairing (up to 10 stored pivots).
 *
 * Returns one event per confirmed divergence, in bar order. Shield gating
 * (allowBullDiv/allowBearDiv) is applied here so downstream callers never see
 * a filtered divergence.
 */
export function detectDivergences(
  candles: Candle[],
  wt: WaveTrendResult,
  div: DivergenceParams,
): DivergenceEvent[] {
  if (!div.enabled) return []
  const n = candles.length
  const srcOsc = wt.wt1
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const atr = atrSeries(high, low, close, div.autoAtrLen)
  const atrSma = smaSeries(atr, div.autoAtrSma)
  const bbWidth = stdevSeries(close, div.autoBbLen)
  const bbWidthSma = smaSeries(bbWidth, div.autoBbSma)

  const priceHigh: number[] = Array.from({ length: n }, () => NaN)
  const priceLow: number[] = Array.from({ length: n }, () => NaN)
  for (let i = 0; i < n; i++) {
    let ph = high[i]
    let pl = low[i]
    if (div.priceSource === "close") {
      ph = close[i]
      pl = close[i]
    } else if (div.priceSource === "auto_atr") {
      const volatile = !Number.isNaN(atrSma[i]) && atr[i] > atrSma[i] * div.autoAtrMult
      ph = volatile ? close[i] : high[i]
      pl = volatile ? close[i] : low[i]
    } else if (div.priceSource === "auto_bb") {
      const volatile = !Number.isNaN(bbWidthSma[i]) && bbWidth[i] > bbWidthSma[i]
      ph = volatile ? close[i] : high[i]
      pl = volatile ? close[i] : low[i]
    }
    priceHigh[i] = ph
    priceLow[i] = pl
  }

  const wantRegular = div.type === "regular" || div.type === "both"
  const wantHidden = div.type === "hidden" || div.type === "both"
  const events: DivergenceEvent[] = []

  const record = (i: number, kind: DivKind) => {
    const allowed =
      kind === "bull_regular" || kind === "bull_hidden" ? wt.allowBullDiv[i] : wt.allowBearDiv[i]
    if (allowed) events.push({ barIndex: i, kind, motor: div.motor })
  }

  // Motor 1: Fast — V-turn on oscillator with minGap spacing.
  if (div.motor === "fast") {
    let lastPHIdx = -Infinity
    let lastPLIdx = -Infinity
    let lastPH = NaN
    let lastPL = NaN
    let lastWH = NaN
    let lastWL = NaN
    for (let i = 2; i < n; i++) {
      const isWaveHigh = srcOsc[i - 1] > srcOsc[i - 2] && srcOsc[i - 1] > srcOsc[i]
      const isWaveLow = srcOsc[i - 1] < srcOsc[i - 2] && srcOsc[i - 1] < srcOsc[i]
      if (isWaveHigh) {
        const ph = priceHigh[i - 1]
        const wh = srcOsc[i - 1]
        if (i - 1 - lastPHIdx >= div.minGap) {
          const isRegBear = ph > lastPH && wh < lastWH
          const isHidBear = ph < lastPH && wh > lastWH
          if ((wantRegular && isRegBear) || (wantHidden && isHidBear)) {
            record(i - 1, isRegBear ? "bear_regular" : "bear_hidden")
          }
        }
        lastPHIdx = i - 1
        lastPH = ph
        lastWH = wh
      }
      if (isWaveLow) {
        const pl = priceLow[i - 1]
        const wl = srcOsc[i - 1]
        if (i - 1 - lastPLIdx >= div.minGap) {
          const isRegBull = pl < lastPL && wl > lastWL
          const isHidBull = pl > lastPL && wl < lastWL
          if ((wantRegular && isRegBull) || (wantHidden && isHidBull)) {
            record(i - 1, isRegBull ? "bull_regular" : "bull_hidden")
          }
        }
        lastPLIdx = i - 1
        lastPL = pl
        lastWL = wl
      }
    }
    return events
  }

  // Pivots for standard + smart motors.
  const phArr = pivotHigh(srcOsc, div.lookbackLeft, div.lookbackRight)
  const plArr = pivotLow(srcOsc, div.lookbackLeft, div.lookbackRight)

  // Motor 2: Standard — classic TV pivot logic, single previous pivot.
  if (div.motor === "standard") {
    let lastPHOsc = NaN
    let lastPHPrice = NaN
    let lastPHBar = NaN
    let lastPLOsc = NaN
    let lastPLPrice = NaN
    let lastPLBar = NaN
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(phArr[i])) {
        const pivotBar = i - div.lookbackRight
        const phPrice = priceHigh[pivotBar]
        const phOsc = srcOsc[pivotBar]
        if (!Number.isNaN(lastPHBar) && pivotBar - lastPHBar <= div.maxBarsBack) {
          const isRegBear = phPrice > lastPHPrice && phOsc < lastPHOsc
          const isHidBear = phPrice < lastPHPrice && phOsc > lastPHOsc
          if ((wantRegular && isRegBear) || (wantHidden && isHidBear)) {
            record(pivotBar, isRegBear ? "bear_regular" : "bear_hidden")
          }
        }
        lastPHOsc = phOsc
        lastPHPrice = phPrice
        lastPHBar = pivotBar
      }
      if (!Number.isNaN(plArr[i])) {
        const pivotBar = i - div.lookbackRight
        const plPrice = priceLow[pivotBar]
        const plOsc = srcOsc[pivotBar]
        if (!Number.isNaN(lastPLBar) && pivotBar - lastPLBar <= div.maxBarsBack) {
          const isRegBull = plPrice < lastPLPrice && plOsc > lastPLOsc
          const isHidBull = plPrice > lastPLPrice && plOsc < lastPLOsc
          if ((wantRegular && isRegBull) || (wantHidden && isHidBull)) {
            record(pivotBar, isRegBull ? "bull_regular" : "bull_hidden")
          }
        }
        lastPLOsc = plOsc
        lastPLPrice = plPrice
        lastPLBar = pivotBar
      }
    }
    return events
  }

  // Motor 3: Smart — Lonesome Hybrid. Keep rolling pivot buffer (max 10).
  const phPos: number[] = []
  const phOsc: number[] = []
  const phPrice: number[] = []
  const plPos: number[] = []
  const plOsc: number[] = []
  const plPrice: number[] = []
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(plArr[i])) {
      const pivotBar = i - div.lookbackRight
      const plPriceVal = priceLow[pivotBar]
      const plOscVal = srcOsc[pivotBar]
      plPos.unshift(pivotBar)
      plOsc.unshift(plOscVal)
      plPrice.unshift(plPriceVal)
      if (plPos.length > 10) {
        plPos.pop()
        plOsc.pop()
        plPrice.pop()
      }
      for (let x = 1; x < Math.min(plPos.length, 10); x++) {
        const loc = plPos[x]
        const len = pivotBar - loc
        if (len <= div.maxBarsBack && len >= 5) {
          const isRegBull = plPriceVal < plPrice[x] && plOscVal > plOsc[x]
          const isHidBull = plPriceVal > plPrice[x] && plOscVal < plOsc[x]
          if ((wantRegular && isRegBull) || (wantHidden && isHidBull)) {
            record(pivotBar, isRegBull ? "bull_regular" : "bull_hidden")
            break
          }
        }
      }
    }
    if (!Number.isNaN(phArr[i])) {
      const pivotBar = i - div.lookbackRight
      const phPriceVal = priceHigh[pivotBar]
      const phOscVal = srcOsc[pivotBar]
      phPos.unshift(pivotBar)
      phOsc.unshift(phOscVal)
      phPrice.unshift(phPriceVal)
      if (phPos.length > 10) {
        phPos.pop()
        phOsc.pop()
        phPrice.pop()
      }
      for (let x = 1; x < Math.min(phPos.length, 10); x++) {
        const loc = phPos[x]
        const len = pivotBar - loc
        if (len <= div.maxBarsBack && len >= 5) {
          const isRegBear = phPriceVal > phPrice[x] && phOscVal < phOsc[x]
          const isHidBear = phPriceVal < phPrice[x] && phOscVal > phOsc[x]
          if ((wantRegular && isRegBear) || (wantHidden && isHidBear)) {
            record(pivotBar, isRegBear ? "bear_regular" : "bear_hidden")
            break
          }
        }
      }
    }
  }
  return events
}

/**
 * Action motor — tracks the breakout (MSS) and short-squeeze trap states that
 * follow a divergence. Returns the discrete, terminal trading events the bot
 * alerts on: confirmed breakouts, trap triggers, and waited-out expiries.
 */
export interface ActionEvent {
  /** Bar index where the terminal event fires. */
  barIndex: number
  type: "bull_breakout" | "bear_breakout" | "bear_trap"
  /** Reference level (resistance/support/trap-high) the price crossed. */
  level: number
  /** Bar index of the originating divergence. */
  originBar: number
}

export function detectActionEvents(
  candles: Candle[],
  divEvents: DivergenceEvent[],
  // wt is reserved for future confidence scoring; currently unused.
  _wt: WaveTrendResult,
  action: ActionParams,
  tf: TimeframeDef,
): ActionEvent[] {
  const n = candles.length
  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)
  const tfMult = action.autoWaitMultiplier ? tf.waitMultiplier : 1
  const maxWait = action.maxWaitBars * tfMult

  const events: ActionEvent[] = []
  // Active bull breakout watch.
  let bullResistance = NaN
  let bullActive = false
  let bullOrigin = -1
  // Active bear breakout watch + short-squeeze trap.
  let bearSupport = NaN
  let bearActive = false
  let bearOrigin = -1
  let trapHigh = NaN
  let trapActive = false
  let trapOrigin = -1

  for (let i = 1; i < n; i++) {
    const divHere = divEvents.find((e) => e.barIndex === i)
    if (divHere) {
      if (divHere.kind === "bull_regular" || divHere.kind === "bull_hidden") {
        bullResistance = highest(high.slice(0, i + 1), 15)
        bullActive = true
        bullOrigin = i
        // A fresh bull divergence cancels an active bear trap.
        trapActive = false
      } else {
        bearSupport = lowest(low.slice(0, i + 1), 15)
        bearActive = true
        bearOrigin = i
        if (action.useBearTrap) {
          trapHigh = high[i]
          trapActive = true
          trapOrigin = i
        }
      }
    }

    // Expiry: reset watch if the window elapsed without a trigger.
    if (bullActive && i - bullOrigin > maxWait) bullActive = false
    if (bearActive && i - bearOrigin > maxWait) bearActive = false

    // Bull breakout = close crosses above the stored resistance.
    if (bullActive && !Number.isNaN(bullResistance) && close[i] > bullResistance && close[i - 1] <= bullResistance) {
      events.push({ barIndex: i, type: "bull_breakout", level: bullResistance, originBar: bullOrigin })
      bullActive = false
    }
    // Bear breakdown = close crosses below the stored support.
    if (bearActive && !Number.isNaN(bearSupport) && close[i] < bearSupport && close[i - 1] >= bearSupport) {
      events.push({ barIndex: i, type: "bear_breakout", level: bearSupport, originBar: bearOrigin })
      bearActive = false
    }
    // Short squeeze trap = close crosses above the trap high after a bear divergence.
    if (trapActive && !Number.isNaN(trapHigh) && close[i] > trapHigh && close[i - 1] <= trapHigh) {
      events.push({ barIndex: i, type: "bear_trap", level: trapHigh, originBar: trapOrigin })
      trapActive = false
    }
  }
  return events
}

/** Convenience: highest over the last `len` values of a series. */
function highest(src: number[], len: number): number {
  let mx = -Infinity
  for (let i = Math.max(0, src.length - len); i < src.length; i++) {
    const v = src[i]
    if (!Number.isNaN(v) && v > mx) mx = v
  }
  return mx === -Infinity ? NaN : mx
}

/** Convenience: lowest over the last `len` values of a series. */
function lowest(src: number[], len: number): number {
  let mn = Infinity
  for (let i = Math.max(0, src.length - len); i < src.length; i++) {
    const v = src[i]
    if (!Number.isNaN(v) && v < mn) mn = v
  }
  return mn === Infinity ? NaN : mn
}
