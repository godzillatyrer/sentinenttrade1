

export interface CryptoTicker {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  quoteVolume: string; // Used for ranking
}

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

export enum SignalType {
  LONG = 'LONG',
  SHORT = 'SHORT',
  NEUTRAL = 'NEUTRAL',
  WAIT = 'WAIT'
}

export interface TimeframeConfidence {
  timeframe: string;
  confidence: number;
}

export interface AnalysisResult {
  symbol: string;
  timestamp: number;
  signal: SignalType;
  confidence: number; // Overall
  timeframeConfidences: TimeframeConfidence[];
  entry: string;
  tp: string;
  sl: string;
  leverage: string; // New field for Leverage Recommendation
  support?: string;
  resistance?: string;
  reasoning: string;
  keyFactors: string[]; // New field for quick tags
  modelUsed?: string; // New field to track the model
  isGettingSecondOpinion?: boolean; // For loading state
  secondOpinion?: AnalysisResult | null; // For the second opinion result
}

export interface AppState {
  selectedSymbol: string;
  tickers: CryptoTicker[];
  signals: AnalysisResult[];
  isAnalyzing: boolean;
  analyzingSymbol: string | null;
}

export interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  maxDrawdown: number;
  equityCurve: number[];
}