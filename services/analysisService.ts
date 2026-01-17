import { Kline, AnalysisResult, SignalType, TimeframeConfidence } from '../types';

/**
 * Local, deterministic technical-analysis engine.
 *
 * Goals:
 * - No Gemini/LLM calls (no API keys, no surprise bills)
 * - Fast enough to scan many symbols frequently
 * - Explainable signals + confidence
 *
 * Notes:
 * This is an MVP-grade engine. It’s intentionally conservative and focuses on
 * simple, widely-used signals (EMA200 trend, RSI, MACD, basic S/R + trend slope).
 */

type PriceSeries = {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
};

const toSeries = (klines: Kline[]): PriceSeries => {
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  for (const k of klines) {
    open.push(parseFloat(k.open));
    high.push(parseFloat(k.high));
    low.push(parseFloat(k.low));
    close.push(parseFloat(k.close));
  }
  return { open, high, low, close };
};

// -----------------------------
// Indicators (minimal, no deps)
// -----------------------------

const ema = (values: number[], period: number): number[] => {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(NaN);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
};

const rsi = (values: number[], period: number = 14): number[] => {
  if (values.length < period + 1) return new Array(values.length).fill(NaN);
  const out: number[] = new Array(values.length).fill(NaN);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
};

const macd = (
  values: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9
) => {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, hist };
};

// -----------------------------
// Structure: Support/Resistance
// -----------------------------

const findPivotLevels = (
  highs: number[],
  lows: number[],
  lookback: number = 3
): { pivotHighs: number[]; pivotLows: number[] } => {
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = lookback; i < highs.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) isHigh = false;
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivotHighs.push(highs[i]);
    if (isLow) pivotLows.push(lows[i]);
  }
  return { pivotHighs, pivotLows };
};

const clusterLevels = (levels: number[], tolerancePct: number): number[] => {
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: number[][] = [];

  for (const lvl of sorted) {
    const placed = clusters.some((c) => {
      const avg = c.reduce((s, x) => s + x, 0) / c.length;
      const tol = avg * tolerancePct;
      if (Math.abs(lvl - avg) <= tol) {
        c.push(lvl);
        return true;
      }
      return false;
    });
    if (!placed) clusters.push([lvl]);
  }

  // Represent each cluster by its mean, with denser clusters first
  return clusters
    .sort((a, b) => b.length - a.length)
    .map((c) => c.reduce((s, x) => s + x, 0) / c.length);
};

const nearestLevels = (
  price: number,
  supports: number[],
  resistances: number[]
): { support?: number; resistance?: number } => {
  const below = supports.filter((x) => x <= price).sort((a, b) => b - a);
  const above = resistances.filter((x) => x >= price).sort((a, b) => a - b);
  return { support: below[0], resistance: above[0] };
};

// -----------------------------
// Trend strength (simple slope)
// -----------------------------

const slopeScore = (values: number[], window: number = 25): number => {
  if (values.length < window + 1) return 0;
  const slice = values.slice(-window);
  const n = slice.length;
  // Linear regression slope
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = slice[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  // Normalize by price to avoid huge numbers
  const last = slice[n - 1] || 1;
  const pctPerBar = slope / last;
  // clamp into -1..1-ish range
  return Math.max(-1, Math.min(1, pctPerBar * 200));
};

// -----------------------------
// Confidence scoring
// -----------------------------

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const scoreTimeframe = (klines: Kline[], tf: string): {
  tf: string;
  confidence: number;
  signal: SignalType;
  keyFactors: string[];
  support?: number;
  resistance?: number;
  entry?: number;
  sl?: number;
  tp?: number;
} => {
  const { high, low, close } = toSeries(klines);
  const lastClose = close[close.length - 1];

  // Indicators
  const ema200 = ema(close, 200);
  const ema50 = ema(close, 50);
  const rsi14 = rsi(close, 14);
  const { macdLine, signalLine, hist } = macd(close);

  const e200 = ema200[ema200.length - 1];
  const e50 = ema50[ema50.length - 1];
  const r = rsi14[rsi14.length - 1];
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  const h = hist[hist.length - 1];

  // Structure
  const pivots = findPivotLevels(high, low, 3);
  const supportLevels = clusterLevels(pivots.pivotLows, 0.004);
  const resistanceLevels = clusterLevels(pivots.pivotHighs, 0.004);
  const { support, resistance } = nearestLevels(lastClose, supportLevels, resistanceLevels);

  // Trend
  const slope = slopeScore(close, 30);

  // Scores
  let trendPts = 0;
  const keyFactors: string[] = [];

  // Trend alignment (0-25)
  if (!Number.isNaN(e200)) {
    const above = lastClose > e200;
    trendPts += above ? 15 : 8;
    if (above) keyFactors.push('Above EMA200');
    else keyFactors.push('Below EMA200');
  }
  if (!Number.isNaN(e50) && !Number.isNaN(e200)) {
    if (e50 > e200) {
      trendPts += 10;
      keyFactors.push('EMA trend up');
    } else {
      trendPts += 4;
      keyFactors.push('EMA trend down');
    }
  }
  trendPts = clamp(trendPts, 0, 25);

  // Momentum (0-25)
  let momPts = 0;
  if (!Number.isNaN(r)) {
    if (r >= 55 && r <= 75) {
      momPts += 14;
      keyFactors.push('RSI bullish');
    } else if (r <= 45 && r >= 25) {
      momPts += 14;
      keyFactors.push('RSI bearish');
    } else if (r > 75 || r < 25) {
      momPts += 8;
      keyFactors.push('RSI extreme');
    } else {
      momPts += 10;
    }
  }
  if (!Number.isNaN(m) && !Number.isNaN(s)) {
    const macdBull = m > s;
    momPts += macdBull ? 11 : 8;
    keyFactors.push(macdBull ? 'MACD above signal' : 'MACD below signal');
  }
  momPts = clamp(momPts, 0, 25);

  // Structure quality (0-25)
  let structPts = 0;
  if (support) {
    const dist = (lastClose - support) / lastClose;
    if (dist < 0.01) {
      structPts += 13;
      keyFactors.push('Near support');
    } else {
      structPts += 8;
    }
  }
  if (resistance) {
    const dist = (resistance - lastClose) / lastClose;
    if (dist < 0.01) {
      structPts += 12;
      keyFactors.push('Near resistance');
    } else {
      structPts += 7;
    }
  }
  structPts = clamp(structPts, 0, 25);

  // Trend slope agreement (0-25)
  let slopePts = 12;
  if (slope > 0.25) {
    slopePts = 22;
    keyFactors.push('Uptrend slope');
  } else if (slope < -0.25) {
    slopePts = 22;
    keyFactors.push('Downtrend slope');
  } else {
    slopePts = 14;
    keyFactors.push('Sideways slope');
  }

  const raw = trendPts + momPts + structPts + slopePts;
  const confidence = clamp(Math.round(raw), 0, 100);

  // Determine directional bias
  const bullishVotes =
    (lastClose > e200 ? 1 : 0) +
    (e50 > e200 ? 1 : 0) +
    (r >= 55 ? 1 : 0) +
    (m > s ? 1 : 0) +
    (slope > 0.1 ? 1 : 0) +
    (support && (lastClose - support) / lastClose < 0.012 ? 1 : 0);

  const bearishVotes =
    (lastClose < e200 ? 1 : 0) +
    (e50 < e200 ? 1 : 0) +
    (r <= 45 ? 1 : 0) +
    (m < s ? 1 : 0) +
    (slope < -0.1 ? 1 : 0) +
    (resistance && (resistance - lastClose) / lastClose < 0.012 ? 1 : 0);

  let signal: SignalType = SignalType.WAIT;
  if (bullishVotes >= 4 && confidence >= 65) signal = SignalType.LONG;
  if (bearishVotes >= 4 && confidence >= 65) signal = SignalType.SHORT;
  if (bullishVotes < 4 && bearishVotes < 4) signal = SignalType.WAIT;

  // Entry/SL/TP (very basic, can be improved later)
  const entry = lastClose;
  let sl: number | undefined;
  let tp: number | undefined;

  if (signal === SignalType.LONG && support) {
    sl = support * 0.995;
    tp = resistance ? resistance * 0.995 : lastClose * 1.02;
  }
  if (signal === SignalType.SHORT && resistance) {
    sl = resistance * 1.005;
    tp = support ? support * 1.005 : lastClose * 0.98;
  }

  return { tf, confidence, signal, keyFactors, support, resistance, entry, sl, tp };
};

const pickLeverage = (confidence: number): string => {
  // Conservative leverage recommendations
  if (confidence >= 90) return '3x';
  if (confidence >= 80) return '2x';
  return '1x';
};

export const analyzeMarket = async (
  symbol: string,
  context: Record<string, Kline[]>
): Promise<AnalysisResult | null> => {
  const timeframes = Object.keys(context);
  if (timeframes.length === 0) return null;

  const scored = timeframes
    .map((tf) => {
      const kl = context[tf] || [];
      if (kl.length < 30) return null;
      return scoreTimeframe(kl, tf);
    })
    .filter(Boolean) as ReturnType<typeof scoreTimeframe>[];

  if (scored.length === 0) return null;

  // Overall confidence = weighted average (higher TFs a bit heavier)
  const tfWeight = (tf: string) => {
    if (tf === '4h') return 1.3;
    if (tf === '1d') return 1.5;
    if (tf === '1h') return 1.1;
    return 1.0;
  };

  const totalW = scored.reduce((s, x) => s + tfWeight(x.tf), 0);
  const overall = Math.round(
    scored.reduce((s, x) => s + x.confidence * tfWeight(x.tf), 0) / totalW
  );

  // Direction = majority vote, tie -> WAIT
  const longCount = scored.filter((x) => x.signal === SignalType.LONG).length;
  const shortCount = scored.filter((x) => x.signal === SignalType.SHORT).length;
  let signal: SignalType = SignalType.WAIT;
  if (longCount > shortCount && overall >= 65) signal = SignalType.LONG;
  else if (shortCount > longCount && overall >= 65) signal = SignalType.SHORT;
  else signal = SignalType.WAIT;

  // Use the "best" timeframe as the explanation anchor
  const best = [...scored].sort((a, b) => b.confidence - a.confidence)[0];

  const timeframeConfidences: TimeframeConfidence[] = scored
    .map((x) => ({ timeframe: x.tf, confidence: x.confidence }))
    .sort((a, b) => b.confidence - a.confidence);

  const support = best.support ? best.support.toFixed(4) : undefined;
  const resistance = best.resistance ? best.resistance.toFixed(4) : undefined;

  const entry = best.entry ? best.entry.toFixed(4) : '';
  const sl = best.sl ? best.sl.toFixed(4) : '';
  const tp = best.tp ? best.tp.toFixed(4) : '';

  const keyFactors = Array.from(new Set(best.keyFactors)).slice(0, 6);

  const reasoningLines: string[] = [];
  reasoningLines.push(`Timeframe focus: ${best.tf}`);
  if (signal === SignalType.LONG) reasoningLines.push('Bias: Bullish setup with trend/momentum alignment.');
  else if (signal === SignalType.SHORT) reasoningLines.push('Bias: Bearish setup with trend/momentum alignment.');
  else reasoningLines.push('Bias: No clean edge (waiting for confirmation).');

  if (support) reasoningLines.push(`Nearest support: ${support}`);
  if (resistance) reasoningLines.push(`Nearest resistance: ${resistance}`);

  return {
    symbol,
    timestamp: Date.now(),
    signal,
    confidence: overall,
    timeframeConfidences,
    entry,
    tp,
    sl,
    leverage: pickLeverage(overall),
    support,
    resistance,
    keyFactors,
    reasoning: reasoningLines.join(' '),
    modelUsed: 'Local TA Engine v1',
  };
};

/**
 * "Second opinion" for UI compatibility.
 * For now this simply re-runs the analysis but applies an extra conservatism filter.
 */
export const getSecondOpinion = async (
  symbol: string,
  context: Record<string, Kline[]>
): Promise<AnalysisResult | null> => {
  const base = await analyzeMarket(symbol, context);
  if (!base) return null;

  // Be stricter: downgrade low-confidence directional signals to WAIT
  const stricter = { ...base };
  if ((stricter.signal === SignalType.LONG || stricter.signal === SignalType.SHORT) && stricter.confidence < 75) {
    stricter.signal = SignalType.WAIT;
    stricter.keyFactors = [...(stricter.keyFactors || []), 'Second opinion: not enough edge'];
    stricter.reasoning = `${stricter.reasoning} Second opinion: confidence below strict threshold; waiting.`;
  }
  stricter.modelUsed = 'Local TA Engine v1 (strict)';
  return stricter;
};
