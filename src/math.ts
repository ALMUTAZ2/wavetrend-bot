/**
 * Technical-analysis math primitives — faithful ports of the Pine Script v5
 * built-in functions used by the WaveTrend MTF DP Div v5.0 PRO indicator.
 *
 * Every function operates on a contiguous series (oldest → newest) and returns
 * a parallel series of the same length, mirroring Pine's bar-by-bar semantics.
 * `NaN` propagates through warm-up bars exactly like Pine's `na`.
 */

/** True arithmetic mean over the last `len` values ending at index `i`. Returns NaN during warm-up. */
export function smaSeries(src: number[], len: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  if (len <= 0) return out
  let sum = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (!Number.isNaN(v)) {
      sum += v
      count++
      if (count > len) {
        const old = src[i - len]
        if (!Number.isNaN(old)) sum -= old
      }
    }
    if (i >= len - 1 && count >= len) out[i] = sum / len
  }
  return out
}

/** Simple value of SMA at the latest bar (convenience for single-point reads). */
export function sma(src: number[], len: number): number {
  if (src.length < len) return NaN
  let sum = 0
  for (let i = src.length - len; i < src.length; i++) sum += src[i]
  return sum / len
}

/**
 * Standard (population) deviation — matches Pine `ta.stdev`.
 * Pine uses the biased estimator: sqrt(sma(x²) - sma(x)²).
 */
export function stdevSeries(src: number[], len: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  if (len <= 1) return out
  const meanSeries = smaSeries(src, len)
  const sqSeries = src.map((v) => (Number.isNaN(v) ? NaN : v * v))
  const meanSqSeries = smaSeries(sqSeries, len)
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(meanSeries[i]) || Number.isNaN(meanSqSeries[i])) continue
    const variance = meanSqSeries[i] - meanSeries[i] * meanSeries[i]
    out[i] = Math.sqrt(Math.max(0, variance))
  }
  return out
}

/** Wilder's running moving average (RMA) — the kernel behind Pine `ta.atr` and `ta.rsi`. */
export function rmaSeries(src: number[], len: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  if (len <= 0) return out
  // Seed RMA with SMA of the first `len` valid values (Pine behaviour).
  let prev = NaN
  let seedSum = 0
  let seedCount = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (Number.isNaN(v)) continue
    if (Number.isNaN(prev)) {
      seedSum += v
      seedCount++
      if (seedCount === len) {
        prev = seedSum / len
        out[i] = prev
      }
    } else {
      prev = (prev * (len - 1) + v) / len
      out[i] = prev
    }
  }
  return out
}

/** Fixed-length exponential moving average series. Alpha = 2/(len+1), seeded with first value. */
export function emaSeries(src: number[], len: number): number[] {
  return dynamicEmaSeries(
    src,
    src.map(() => len),
  )
}

/**
 * Dynamic-length EMA — a faithful port of Pine `f_dyn_ema` from the indicator.
 * Alpha is recomputed each bar from the per-bar length, allowing the WaveTrend
 * periods to flex with ATR-driven volatility without Pine's constant-length limit.
 */
export function dynamicEmaSeries(src: number[], len: number[]): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  let prev = NaN
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (Number.isNaN(v)) continue
    const alpha = 2 / (Math.max(1, len[i]) + 1)
    if (Number.isNaN(prev)) {
      out[i] = v
    } else {
      out[i] = prev + alpha * (v - prev)
    }
    prev = out[i]
  }
  return out
}

/** Weighted moving average series (used by Hull MA). */
export function wmaSeries(src: number[], len: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  if (len <= 0) return out
  const denom = (len * (len + 1)) / 2
  for (let i = len - 1; i < n; i++) {
    let acc = 0
    let ok = true
    for (let j = 0; j < len; j++) {
      const v = src[i - j]
      if (Number.isNaN(v)) {
        ok = false
        break
      }
      acc += v * (len - j)
    }
    if (ok) out[i] = acc / denom
  }
  return out
}

/** Hull moving average series — matches Pine `ta.hma`. */
export function hmaSeries(src: number[], len: number): number[] {
  const n = src.length
  const half = Math.max(1, Math.round(len / 2))
  const sqrtLen = Math.max(1, Math.round(Math.sqrt(len)))
  const wmaHalf = wmaSeries(src, half)
  const wmaFull = wmaSeries(src, len)
  const doubled = src.map((_, i) =>
    Number.isNaN(wmaHalf[i]) || Number.isNaN(wmaFull[i]) ? NaN : 2 * wmaHalf[i] - wmaFull[i],
  )
  return wmaSeries(doubled, sqrtLen)
}

/** True-range series for ATR. Honours gaps the way Pine `ta.tr` does. */
export function trueRangeSeries(high: number[], low: number[], close: number[]): number[] {
  const n = high.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out[i] = high[i] - low[i]
      continue
    }
    const prevClose = close[i - 1]
    const hl = high[i] - low[i]
    const hc = Math.abs(high[i] - prevClose)
    const lc = Math.abs(low[i] - prevClose)
    out[i] = Math.max(hl, hc, lc)
  }
  return out
}

/** Average true range (Wilder's RMA of true range) — matches Pine `ta.atr`. */
export function atrSeries(high: number[], low: number[], close: number[], len: number): number[] {
  const tr = trueRangeSeries(high, low, close)
  return rmaSeries(tr, len)
}

/** Highest value over a rolling window ending at each bar — matches Pine `ta.highest`. */
export function highestSeries(src: number[], len: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  for (let i = len - 1; i < n; i++) {
    let mx = -Infinity
    for (let j = i - len + 1; j <= i; j++) {
      const v = src[j]
      if (!Number.isNaN(v) && v > mx) mx = v
    }
    if (mx !== -Infinity) out[i] = mx
  }
  return out
}

/** Lowest value over a rolling window ending at each bar — matches Pine `ta.lowest`. */
export function lowestSeries(src: number[], len: number): number[] {
  const n = src.length
  const out: number[] = Array.from({ length: n }, () => NaN)
  for (let i = len - 1; i < n; i++) {
    let mn = Infinity
    for (let j = i - len + 1; j <= i; j++) {
      const v = src[j]
      if (!Number.isNaN(v) && v < mn) mn = v
    }
    if (mn !== Infinity) out[i] = mn
  }
  return out
}

/** `a[1] <= b[1] && a > b` — Pine `ta.crossover`, evaluated across the series. */
export function crossoverSeries(a: number[], b: number[]): boolean[] {
  const n = a.length
  const out: boolean[] = Array.from({ length: n }, () => false)
  for (let i = 1; i < n; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i]) || Number.isNaN(a[i - 1]) || Number.isNaN(b[i - 1])) continue
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) out[i] = true
  }
  return out
}

/** `a[1] >= b[1] && a < b` — Pine `ta.crossunder`. */
export function crossunderSeries(a: number[], b: number[]): boolean[] {
  const n = a.length
  const out: boolean[] = Array.from({ length: n }, () => false)
  for (let i = 1; i < n; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i]) || Number.isNaN(a[i - 1]) || Number.isNaN(b[i - 1])) continue
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) out[i] = true
  }
  return out
}
