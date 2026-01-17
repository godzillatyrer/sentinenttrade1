import React, { useState } from 'react';
import { fetchHistoricalData } from '../services/binanceService';
import { CryptoTicker, Kline } from '../types';

interface Props {
  tickers: CryptoTicker[];
  onClose: () => void;
}

type StrategyType = 'RSI' | 'SMA_CROSS';

const BacktestPanel: React.FC<Props> = ({ tickers, onClose }) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(tickers[0]?.symbol || 'BTCUSDT');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [strategy, setStrategy] = useState<StrategyType>('RSI');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<{
    totalTrades: number;
    winRate: number;
    pnl: number;
    history: any[];
  } | null>(null);

  // Simple RSI Calculation
  const calculateRSI = (prices: number[], period: number = 14) => {
    if (prices.length < period + 1) return [];
    const rsi = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      let gain = change > 0 ? change : 0;
      let loss = change < 0 ? Math.abs(change) : 0;
      
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
    return rsi;
  };

  // Simple SMA Calculation
  const calculateSMA = (prices: number[], period: number) => {
    const sma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
    return sma;
  };

  const runBacktest = async () => {
    setIsRunning(true);
    setLogs([]);
    setResult(null);
    try {
      setLogs(prev => [...prev, `Fetching ${timeframe} data for ${selectedSymbol}...`]);
      const klines = await fetchHistoricalData(selectedSymbol, timeframe, 500);
      
      if (klines.length < 50) {
        setLogs(prev => [...prev, "Insufficient data."]);
        setIsRunning(false);
        return;
      }

      const closes = klines.map(k => parseFloat(k.close));
      const opens = klines.map(k => parseFloat(k.open)); // approximate entry
      
      let trades: any[] = [];
      let inPosition = false;
      let entryPrice = 0;
      let positionType: 'LONG' | 'SHORT' | null = null;
      let balance = 1000;
      const initialBalance = 1000;

      // Strategy Execution
      if (strategy === 'RSI') {
         const rsiValues = calculateRSI(closes, 14);
         const offset = closes.length - rsiValues.length;

         for (let i = 0; i < rsiValues.length; i++) {
            const currentRSI = rsiValues[i];
            const price = closes[i + offset];
            const time = klines[i + offset].closeTime;

            if (!inPosition) {
              if (currentRSI < 30) {
                // Buy
                inPosition = true;
                entryPrice = price;
                positionType = 'LONG';
                trades.push({ type: 'ENTRY_LONG', price, time, rsi: currentRSI });
              } else if (currentRSI > 70) {
                // Sell
                inPosition = true;
                entryPrice = price;
                positionType = 'SHORT';
                trades.push({ type: 'ENTRY_SHORT', price, time, rsi: currentRSI });
              }
            } else {
              // Exit Logic
              if (positionType === 'LONG' && currentRSI > 60) {
                inPosition = false;
                const pnl = ((price - entryPrice) / entryPrice) * 100;
                balance = balance * (1 + pnl / 100);
                trades.push({ type: 'EXIT_LONG', price, time, pnl, balance });
              } else if (positionType === 'SHORT' && currentRSI < 40) {
                inPosition = false;
                const pnl = ((entryPrice - price) / entryPrice) * 100;
                balance = balance * (1 + pnl / 100);
                trades.push({ type: 'EXIT_SHORT', price, time, pnl, balance });
              }
            }
         }
      } else if (strategy === 'SMA_CROSS') {
        // SMA 9 / 21
        const sma9 = calculateSMA(closes, 9);
        const sma21 = calculateSMA(closes, 21);
        const offset = closes.length - sma21.length;
        
        // Align arrays
        const sma9Aligned = sma9.slice(sma9.length - sma21.length);
        
        for (let i = 1; i < sma21.length; i++) {
            const s9Prev = sma9Aligned[i-1];
            const s21Prev = sma21[i-1];
            const s9Curr = sma9Aligned[i];
            const s21Curr = sma21[i];
            const price = closes[i + offset];
            const time = klines[i + offset].closeTime;

            if (!inPosition) {
                // Golden Cross
                if (s9Prev <= s21Prev && s9Curr > s21Curr) {
                   inPosition = true;
                   entryPrice = price;
                   positionType = 'LONG';
                   trades.push({ type: 'ENTRY_LONG', price, time });
                }
                // Death Cross
                else if (s9Prev >= s21Prev && s9Curr < s21Curr) {
                   inPosition = true;
                   entryPrice = price;
                   positionType = 'SHORT';
                   trades.push({ type: 'ENTRY_SHORT', price, time });
                }
            } else {
                // Simple Reversal Exit
                if (positionType === 'LONG' && s9Curr < s21Curr) {
                   inPosition = false;
                   const pnl = ((price - entryPrice) / entryPrice) * 100;
                   balance = balance * (1 + pnl / 100);
                   trades.push({ type: 'EXIT_LONG', price, time, pnl, balance });
                } else if (positionType === 'SHORT' && s9Curr > s21Curr) {
                   inPosition = false;
                   const pnl = ((entryPrice - price) / entryPrice) * 100;
                   balance = balance * (1 + pnl / 100);
                   trades.push({ type: 'EXIT_SHORT', price, time, pnl, balance });
                }
            }
        }
      }

      // Calc Stats
      const completedTrades = trades.filter(t => t.type.includes('EXIT'));
      const wins = completedTrades.filter(t => t.pnl > 0).length;
      const totalPnL = ((balance - initialBalance) / initialBalance) * 100;

      setResult({
        totalTrades: completedTrades.length,
        winRate: completedTrades.length > 0 ? Math.round((wins / completedTrades.length) * 100) : 0,
        pnl: totalPnL,
        history: completedTrades
      });
      setLogs(prev => [...prev, "Backtest Complete."]);

    } catch (e) {
      setLogs(prev => [...prev, "Error running backtest."]);
      console.error(e);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="p-4 border-b border-surfaceHighlight flex justify-between items-center">
         <h2 className="font-bold text-lg text-white">Strategy Simulator</h2>
         <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 border-b border-surfaceHighlight">
         <div>
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Symbol</label>
            <select 
              className="w-full bg-surfaceHighlight text-white text-xs p-2 rounded outline-none"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
            >
               {tickers.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
            </select>
         </div>
         <div>
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Timeframe</label>
            <select 
              className="w-full bg-surfaceHighlight text-white text-xs p-2 rounded outline-none"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
            >
               <option value="15m">15m</option>
               <option value="1h">1h</option>
               <option value="4h">4h</option>
               <option value="1d">1D</option>
            </select>
         </div>
         <div className="col-span-2">
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Strategy Rule</label>
            <select 
              className="w-full bg-surfaceHighlight text-white text-xs p-2 rounded outline-none"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyType)}
            >
               <option value="RSI">RSI Reversal (Buy &lt; 30, Sell &gt; 70)</option>
               <option value="SMA_CROSS">SMA Crossover (9/21 Trend Follow)</option>
            </select>
         </div>
         <div className="col-span-2">
           <button 
             onClick={runBacktest}
             disabled={isRunning}
             className={`w-full py-2 rounded text-sm font-bold transition ${isRunning ? 'bg-gray-700' : 'bg-primary hover:bg-blue-600'} text-white`}
           >
             {isRunning ? 'Simulating...' : 'Run Simulation'}
           </button>
         </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
         {result ? (
           <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                 <div className="bg-surfaceHighlight/30 p-2 rounded text-center">
                    <span className="block text-[10px] text-gray-400 uppercase">Trades</span>
                    <span className="text-lg font-mono font-bold text-white">{result.totalTrades}</span>
                 </div>
                 <div className="bg-surfaceHighlight/30 p-2 rounded text-center">
                    <span className="block text-[10px] text-gray-400 uppercase">Win Rate</span>
                    <span className={`text-lg font-mono font-bold ${result.winRate > 50 ? 'text-success' : 'text-danger'}`}>{result.winRate}%</span>
                 </div>
                 <div className="bg-surfaceHighlight/30 p-2 rounded text-center">
                    <span className="block text-[10px] text-gray-400 uppercase">Total PnL</span>
                    <span className={`text-lg font-mono font-bold ${result.pnl > 0 ? 'text-success' : 'text-danger'}`}>
                      {result.pnl > 0 ? '+' : ''}{result.pnl.toFixed(2)}%
                    </span>
                 </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-gray-400 uppercase">Trade Log</h3>
                {result.history.map((t, idx) => (
                  <div key={idx} className="flex justify-between text-xs p-2 rounded bg-surfaceHighlight/20 border border-white/5">
                     <div>
                       <span className={`font-bold ${t.type.includes('LONG') ? 'text-success' : 'text-danger'}`}>
                         {t.type.replace('EXIT_', '')}
                       </span>
                       <span className="text-gray-500 ml-2">@ {t.price}</span>
                     </div>
                     <span className={`font-mono ${t.pnl > 0 ? 'text-success' : 'text-danger'}`}>
                       {t.pnl.toFixed(2)}%
                     </span>
                  </div>
                ))}
              </div>
           </div>
         ) : (
           <div className="text-xs text-gray-500 font-mono space-y-1">
             {logs.map((log, i) => <div key={i}>&gt; {log}</div>)}
             {logs.length === 0 && <div className="text-center mt-10 opacity-50">Select strategy and run simulation</div>}
           </div>
         )}
      </div>
    </div>
  );
};

export default BacktestPanel;
