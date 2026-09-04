export function smaSeries(data: number[], period: number): number[] {
  const res: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      res.push(NaN)
      continue
    }
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += data[i - j]
    }
    res.push(sum / period)
  }
  return res
}

export function emaSeries(data: number[], period: number): number[] {
  const res: number[] = []
  const k = 2 / (period + 1)
  let prev = NaN
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (Number.isNaN(v)) {
      res.push(NaN)
      continue
    }
    if (Number.isNaN(prev)) {
      prev = v
    } else {
      prev = v * k + prev * (1 - k)
    }
    res.push(prev)
  }
  return res
}

export function dynamicEmaSeries(data: number[], periods: number[]): number[] {
  const res: number[] = []
  let prev = NaN
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    const period = periods[i] || 10
    const k = 2 / (period + 1)
    if (Number.isNaN(v)) {
      res.push(NaN)
      continue
    }
    if (Number.isNaN(prev)) {
      prev = v
    } else {
      prev = v * k + prev * (1 - k)
    }
    res.push(prev)
  }
  return res
}

export function hmaSeries(data: number[], period: number): number[] {
  return smaSeries(data, period)
}

export function atrSeries(high: number[], low: number[], close: number[], period: number): number[] {
  const tr: number[] = []
  for (let i = 0; i < high.length; i++) {
    if (i === 0) {
      tr.push(high[i] - low[i])
      continue
    }
    const hl = high[i] - low[i]
    const hc = Math.abs(high[i] - close[i - 1])
    const lc = Math.abs(low[i] - close[i - 1])
    tr.push(Math.max(hl, hc, lc))
  }
  return smaSeries(tr, period)
}

export function stdevSeries(data: number[], period: number): number[] {
  const sma = smaSeries(data, period)
  const res: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(sma[i]) || i < period - 1) {
      res.push(NaN)
      continue
    }
    let sumSq = 0
    for (let j = 0; j < period; j++) {
      const diff = data[i - j] - sma[i]
      sumSq += diff * diff
    }
    res.push(Math.sqrt(sumSq / period))
  }
  return res
}

export function crossoverSeries(s1: number[], s2: number[]): boolean[] {
  const res: boolean[] = []
  for (let i = 0; i < s1.length; i++) {
    if (i === 0 || Number.isNaN(s1[i]) || Number.isNaN(s2[i]) || Number.isNaN(s1[i-1]) || Number.isNaN(s2[i-1])) {
      res.push(false)
      continue
    }
    res.push(s1[i-1] <= s2[i-1] && s1[i] > s2[i])
  }
  return res
}

export function crossunderSeries(s1: number[], s2: number[]): boolean[] {
  const res: boolean[] = []
  for (let i = 0; i < s1.length; i++) {
    if (i === 0 || Number.isNaN(s1[i]) || Number.isNaN(s2[i]) || Number.isNaN(s1[i-1]) || Number.isNaN(s2[i-1])) {
      res.push(false)
      continue
    }
    res.push(s1[i-1] >= s2[i-1] && s1[i] < s2[i])
  }
  return res
}
