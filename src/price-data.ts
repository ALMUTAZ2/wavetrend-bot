import type { Candle } from "./wavetrend"
import { TIMEFRAMES } from "./wavetrend"

const YHOO_SYMBOL = "^GSPC"

function yahooInterval(tfId: string): { interval: string; aggregate?: number } {
  switch (tfId) {
    case "W": return { interval: "1wk" }
    case "D": return { interval: "1d" }
    case "240": return { interval: "60m", aggregate: 4 }
    case "180": return { interval: "60m", aggregate: 3 }
    case "120": return { interval: "60m", aggregate: 2 }
    case "60": return { interval: "60m" }
    case "45": return { interval: "15m", aggregate: 3 }
    case "30": return { interval: "30m" }
    case "15": return { interval: "15m" }
    case "5": return { interval: "5m" }
    case "1": return { interval: "1m" }
    default: return { interval: "1d" }
  }
}

function yahooRange(tfId: string): string {
  switch (tfId) {
    case "W": return "5y"
    case "D": return "2y"
    case "240":
    case "180":
    case "120": return "6mo"
    case "60": return "3mo"
    case "45":
    case "30":
    case "15": return "1mo"
    case "5": return "5d"
    case "1": return "1d"
    default: return "1y"
  }
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: number[]
          high?: number[]
          low?: number[]
          close?: number[]
          volume?: number[]
        }>
      }
    }>
    error?: { code?: string; description?: string }
  }
}

async function fetchYahooCandles(tfId: string): Promise<Candle[]> {
  const { interval, aggregate } = yahooInterval(tfId)
  const range = yahooRange(tfId)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YHOO_SYMBOL)}?interval=${interval}&range=${range}`

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  })

  if (!res.ok) {
    throw new DataFetchError(`Yahoo Finance returned HTTP ${res.status}`, "http_error")
  }

  const data = (await res.json()) as YahooChartResponse
  const result = data.chart?.result?.[0]
  if (!result?.timestamp || !result.indicators?.quote?.[0]) {
    const msg = data.chart?.error?.description ?? "empty response"
    throw new DataFetchError(`Yahoo Finance: ${msg}`, "parse_error")
  }

  const ts = result.timestamp
  const q = result.indicators.quote[0]
  const raw: Candle[] = []
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (o == null || h == null || l == null || c == null) continue
    if (Number.isNaN(o) || Number.isNaN(h) || Number.isNaN(l) || Number.isNaN(c)) continue
    raw.push({
      time: ts[i] * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: q.volume?.[i] ?? 0,
    })
  }

  if (raw.length === 0) {
    throw new DataFetchError("Yahoo Finance returned no usable candles", "empty")
  }

  if (aggregate && aggregate > 1) {
    return aggregateCandles(raw, aggregate)
  }
  return raw
}

function aggregateCandles(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor)
    if (chunk.length === 0) continue
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume ?? 0), 0),
    })
  }
  return out
}

export class DataFetchError extends Error {
  kind: string
  constructor(message: string, kind: string) {
    super(message)
    this.name = "DataFetchError"
    this.kind = kind
  }
}

export async function fetchCandles(symbol: string, tfId: string): Promise<Candle[]> {
  return fetchYahooCandles(tfId)
}

export { TIMEFRAMES }
