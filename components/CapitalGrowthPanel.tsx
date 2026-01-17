
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AnalysisResult, SignalType, CryptoTicker } from '../types';
import { createChart, ColorType } from 'lightweight-charts';

interface Props {
  signals: AnalysisResult[];
  tickers: CryptoTicker[];
  isVisible: boolean;
}

interface TradeRow {
  symbol: string;
  type: string;
  entry: number;
  exit?: number;
  current?: number;
  pnl: number; // Percent
  pnlUsd: number;
  size: number; // USD Notional
  margin: number; // USD Margin Used
  timestamp: number;
  status: 'WIN' | 'LOSS' | 'OPEN';
  leverage: number;
}

const CapitalGrowthPanel: React.FC<Props> = ({ signals, tickers, isVisible }) => {
  const [initialCapital, setInitialCapital] = useState<number>(2000);
  const [riskPerTrade, setRiskPerTrade] = useState<number>(2); // 2% risk
  const [activeTab, setActiveTab] = useState<'chart' | 'open' | 'history'>('chart');
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  // Price Map for fast lookup - updates whenever tickers prop changes (via WebSocket in App)
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    tickers.forEach(t => map[t.symbol] = parseFloat(t.lastPrice));
    return map;
  }, [tickers]);

  // CALCULATE EQUITY CURVE AND TRADE LISTS
  const stats = useMemo(() => {
    // Only take High Confidence trades
    const trades = signals
        .filter(s => s.confidence >= 80 && (s.signal === SignalType.LONG || s.signal === SignalType.SHORT))
        .sort((a, b) => a.timestamp - b.timestamp);

    let currentBalance = initialCapital;
    let peakBalance = initialCapital;
    let maxDrawdown = 0;
    const equityCurve = [{ time: Math.floor(Date.now() / 1000) - 86400, value: initialCapital }]; // Start point

    let wins = 0;
    let losses = 0;
    
    // Temporary storage for all potential opens before filtering
    const potentialOpenPositions: TradeRow[] = [];
    const closedHistory: TradeRow[] = [];

    trades.forEach(trade => {
        const entry = parseFloat(trade.entry);
        const sl = parseFloat(trade.sl);
        const tp = parseFloat(trade.tp);
        
        // Parse Leverage strictly (e.g. "5x Isolated", "10x", "3")
        let leverage = 1;
        const levStr = trade.leverage ? trade.leverage.toString() : "1";
        const levMatch = levStr.match(/(\d+)/);
        if (levMatch) {
            leverage = parseInt(levMatch[0]);
        }

        // --- Position Sizing Logic ---
        // 1. Calculate Risk Distance (%)
        let riskDist = Math.abs((entry - sl) / entry);
        if (riskDist === 0) riskDist = 0.01; 

        // 2. Risk Amount ($) = Balance * Risk% (e.g. 2%)
        const riskAmount = currentBalance * (riskPerTrade / 100);

        // 3. Position Size ($ Notional) = Risk Amount / Risk Distance
        let positionSize = riskAmount / riskDist;

        // 4. LEVERAGE CONSTRAINT (Clamp single trade size to Max Buying Power)
        const maxPositionSize = currentBalance * leverage;
        if (positionSize > maxPositionSize) {
            positionSize = maxPositionSize;
        }

        const marginUsed = positionSize / leverage;

        // --- PnL Calculation ---
        const currentPrice = priceMap[trade.symbol] || entry; 
        
        let pnlPercent = 0;
        let isClosed = false;
        let exitPrice = currentPrice;
        let status: 'WIN' | 'LOSS' | 'OPEN' = 'OPEN';

        if (trade.signal === SignalType.LONG) {
            if (currentPrice >= tp) { pnlPercent = (tp - entry) / entry; isClosed = true; exitPrice = tp; status = 'WIN'; wins++; }
            else if (currentPrice <= sl) { pnlPercent = (sl - entry) / entry; isClosed = true; exitPrice = sl; status = 'LOSS'; losses++; }
            else { pnlPercent = (currentPrice - entry) / entry; }
        } else {
             if (currentPrice <= tp) { pnlPercent = (entry - tp) / entry; isClosed = true; exitPrice = tp; status = 'WIN'; wins++; }
             else if (currentPrice >= sl) { pnlPercent = (entry - sl) / entry; isClosed = true; exitPrice = sl; status = 'LOSS'; losses++; }
             else { pnlPercent = (entry - currentPrice) / entry; }
        }

        const tradePnL = positionSize * pnlPercent;

        if (isClosed) {
            currentBalance += tradePnL;
            if (currentBalance < 0) currentBalance = 0;
            equityCurve.push({ time: Math.floor(trade.timestamp / 1000), value: currentBalance });
            
            closedHistory.unshift({
              symbol: trade.symbol,
              type: trade.signal,
              entry,
              exit: exitPrice,
              pnl: pnlPercent * 100,
              pnlUsd: tradePnL,
              size: positionSize,
              margin: marginUsed,
              timestamp: trade.timestamp,
              status,
              leverage
            });
        } else {
            potentialOpenPositions.push({
              symbol: trade.symbol,
              type: trade.signal,
              entry,
              current: currentPrice,
              pnl: pnlPercent * 100,
              pnlUsd: tradePnL,
              size: positionSize,
              margin: marginUsed,
              timestamp: trade.timestamp,
              status: 'OPEN',
              leverage
            });
        }

        if (currentBalance > peakBalance) peakBalance = currentBalance;
        const drawdown = (peakBalance - currentBalance) / peakBalance * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // --- FILTER OPEN POSITIONS BASED ON AVAILABLE MARGIN ---
    // We assume 'currentBalance' is the realized equity available for margin.
    // We process open trades FIFO (First-In-First-Out based on timestamp).
    
    let usedMargin = 0;
    const validOpenPositions: TradeRow[] = [];
    let openPnL = 0;

    // Sort potential opens by timestamp (Oldest first)
    potentialOpenPositions.sort((a, b) => a.timestamp - b.timestamp);

    for (const pos of potentialOpenPositions) {
        if (usedMargin + pos.margin <= currentBalance) {
            validOpenPositions.push(pos);
            usedMargin += pos.margin;
            openPnL += pos.pnlUsd;
        } else {
            // Cannot open this position due to margin constraints
            // console.log(`Skipping ${pos.symbol} due to insufficient margin. Needed ${pos.margin}, Have ${currentBalance - usedMargin}`);
        }
    }

    const liveBalance = currentBalance + openPnL;
    
    const lastTime = equityCurve[equityCurve.length - 1].time;
    const nowTime = Math.floor(Date.now() / 1000);
    if (nowTime > lastTime) {
        equityCurve.push({ time: nowTime, value: liveBalance > 0 ? liveBalance : 0 });
    }

    // Sort valid open positions by PnL (desc) for display or just keep chronological
    // Let's keep chronological
    // validOpenPositions.reverse(); // Newest first for display usually?
    // Let's actually reverse them for the table so newest is at top
    const displayOpenPositions = [...validOpenPositions].reverse();

    return {
        balance: liveBalance > 0 ? liveBalance : 0,
        openPnL,
        equityCurve,
        maxDrawdown,
        trades: closedHistory.length, // Only count closed trades in "Total Trades" stat
        winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
        openPositions: displayOpenPositions,
        closedHistory
    };
  }, [signals, initialCapital, riskPerTrade, priceMap]); 

  // CHART EFFECT
  useEffect(() => {
    if (!chartContainerRef.current || !isVisible || activeTab !== 'chart') return;

    if (!chartRef.current) {
        chartRef.current = createChart(chartContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: '#131318' }, textColor: '#d1d5db' },
            grid: { vertLines: { color: '#1c1c24' }, horzLines: { color: '#1c1c24' } },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: { timeVisible: true, secondsVisible: false },
        });

        seriesRef.current = chartRef.current.addAreaSeries({
            lineColor: '#3b82f6',
            topColor: 'rgba(59, 130, 246, 0.4)',
            bottomColor: 'rgba(59, 130, 246, 0.0)',
        });
    }

    if (seriesRef.current) {
        const uniqueData = stats.equityCurve.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);
        seriesRef.current.setData(uniqueData);
        chartRef.current.timeScale().fitContent();
    }

    const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ 
                width: chartContainerRef.current.clientWidth, 
                height: chartContainerRef.current.clientHeight 
            });
        }
    };
    window.addEventListener('resize', handleResize);
    return () => {
       window.removeEventListener('resize', handleResize);
       // Do not dispose chart here, only on unmount of component or if really needed
    };

  }, [stats.equityCurve, isVisible, activeTab]);

  // If we switch away from chart, clean up
  useEffect(() => {
     if (activeTab !== 'chart' && chartRef.current) {
         chartRef.current.remove();
         chartRef.current = null;
         seriesRef.current = null;
     }
  }, [activeTab]);

  if (!isVisible) return null;

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="p-4 border-b border-surfaceHighlight flex items-center justify-between bg-surfaceHighlight/10">
         <div className="flex items-center gap-4">
             <div className="bg-primary/20 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
             </div>
             <div>
                <h2 className="text-lg font-bold text-white">Portfolio Simulator</h2>
                <div className="text-xs text-gray-400">Preservation Strategy (Risk {riskPerTrade}%)</div>
             </div>
         </div>
         <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase">Start Bal:</span>
            <input 
                type="number" 
                value={initialCapital} 
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                className="bg-black/30 border border-surfaceHighlight rounded px-2 py-1 text-white text-sm w-24 text-right outline-none focus:border-primary"
            />
         </div>
      </div>

      <div className="grid grid-cols-4 gap-4 p-4 border-b border-surfaceHighlight">
         <div className="bg-surfaceHighlight/20 p-3 rounded-lg border border-white/5">
            <span className="block text-xs text-gray-500 uppercase mb-1">Equity</span>
            <span className={`text-xl font-mono font-bold ${stats.balance >= initialCapital ? 'text-success' : 'text-danger'}`}>
                ${stats.balance.toFixed(0)}
            </span>
         </div>
         <div className="bg-surfaceHighlight/20 p-3 rounded-lg border border-white/5">
            <span className="block text-xs text-gray-500 uppercase mb-1">Unrealized PnL</span>
            <span className={`text-xl font-mono font-bold ${stats.openPnL >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                {stats.openPnL > 0 ? '+' : ''}{stats.openPnL.toFixed(0)}
            </span>
         </div>
         <div className="bg-surfaceHighlight/20 p-3 rounded-lg border border-white/5">
            <span className="block text-xs text-gray-500 uppercase mb-1">Max Drawdown</span>
            <span className="text-xl font-mono font-bold text-yellow-500">
                {stats.maxDrawdown.toFixed(1)}%
            </span>
         </div>
         <div className="bg-surfaceHighlight/20 p-3 rounded-lg border border-white/5">
            <span className="block text-xs text-gray-500 uppercase mb-1">Win Rate</span>
            <span className="text-xl font-mono font-bold text-gray-200">
                {stats.winRate}%
            </span>
         </div>
      </div>

      {/* TABS */}
      <div className="flex border-b border-surfaceHighlight px-4 pt-2 gap-2">
         <button 
           onClick={() => setActiveTab('chart')}
           className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'chart' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-white'}`}
         >
           Performance Curve
         </button>
         <button 
           onClick={() => setActiveTab('open')}
           className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'open' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-white'}`}
         >
           Open Positions <span className="bg-blue-500/20 text-blue-400 px-1.5 rounded text-xs">{stats.openPositions.length}</span>
         </button>
         <button 
           onClick={() => setActiveTab('history')}
           className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-white'}`}
         >
           Trade History <span className="bg-gray-700 text-gray-300 px-1.5 rounded text-xs">{stats.closedHistory.length}</span>
         </button>
      </div>

      <div className="flex-1 relative bg-background overflow-hidden">
         {/* CHART VIEW */}
         {activeTab === 'chart' && (
             <div className="absolute inset-0 p-4">
                 <div ref={chartContainerRef} className="w-full h-full rounded-lg overflow-hidden border border-surfaceHighlight" />
             </div>
         )}

         {/* OPEN POSITIONS TABLE */}
         {activeTab === 'open' && (
             <div className="absolute inset-0 overflow-y-auto">
                <table className="w-full text-left text-sm">
                    <thead className="text-xs text-gray-500 uppercase bg-surfaceHighlight/30 sticky top-0 backdrop-blur-md z-10">
                        <tr>
                            <th className="p-3 font-medium">Symbol</th>
                            <th className="p-3 font-medium">Side</th>
                            <th className="p-3 font-medium">Size ($)</th>
                            <th className="p-3 font-medium">Margin</th>
                            <th className="p-3 font-medium">Entry</th>
                            <th className="p-3 font-medium">Current</th>
                            <th className="p-3 font-medium text-right">PnL</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {stats.openPositions.map((t, i) => (
                             <tr key={i} className="hover:bg-surfaceHighlight/10">
                                 <td className="p-3 font-bold text-white">{t.symbol}</td>
                                 <td className="p-3">
                                     <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.type === 'LONG' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                                         {t.type} {t.leverage}x
                                     </span>
                                 </td>
                                 <td className="p-3 font-mono text-gray-300">${t.size.toFixed(0)}</td>
                                 <td className="p-3 font-mono text-gray-500">${t.margin.toFixed(0)}</td>
                                 <td className="p-3 font-mono text-gray-400">{t.entry}</td>
                                 <td className="p-3 font-mono text-white">{t.current}</td>
                                 <td className={`p-3 font-mono font-bold text-right ${t.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                     {t.pnlUsd > 0 ? '+' : ''}{t.pnlUsd.toFixed(2)} <span className="opacity-50 text-[10px]">({t.pnl.toFixed(2)}%)</span>
                                 </td>
                             </tr>
                        ))}
                        {stats.openPositions.length === 0 && (
                            <tr><td colSpan={7} className="p-8 text-center text-gray-500">No open positions.</td></tr>
                        )}
                    </tbody>
                </table>
             </div>
         )}

         {/* HISTORY TABLE */}
         {activeTab === 'history' && (
             <div className="absolute inset-0 overflow-y-auto">
                <table className="w-full text-left text-sm">
                    <thead className="text-xs text-gray-500 uppercase bg-surfaceHighlight/30 sticky top-0 backdrop-blur-md z-10">
                        <tr>
                            <th className="p-3 font-medium">Date</th>
                            <th className="p-3 font-medium">Symbol</th>
                            <th className="p-3 font-medium">Side</th>
                            <th className="p-3 font-medium">Size ($)</th>
                            <th className="p-3 font-medium">Entry</th>
                            <th className="p-3 font-medium">Exit</th>
                            <th className="p-3 font-medium text-right">PnL</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {stats.closedHistory.map((t, i) => (
                             <tr key={i} className="hover:bg-surfaceHighlight/10">
                                 <td className="p-3 text-gray-500 text-xs">{new Date(t.timestamp).toLocaleDateString()}</td>
                                 <td className="p-3 font-bold text-white">{t.symbol}</td>
                                 <td className="p-3">
                                     <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.type === 'LONG' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                                         {t.type} {t.leverage}x
                                     </span>
                                 </td>
                                 <td className="p-3 font-mono text-gray-300">${t.size.toFixed(0)}</td>
                                 <td className="p-3 font-mono text-gray-400">{t.entry}</td>
                                 <td className="p-3 font-mono text-gray-400">{t.exit}</td>
                                 <td className={`p-3 font-mono font-bold text-right ${t.pnlUsd >= 0 ? 'text-success' : 'text-danger'}`}>
                                     {t.pnlUsd > 0 ? '+' : ''}{t.pnlUsd.toFixed(2)} <span className="opacity-50 text-[10px]">({t.pnl.toFixed(2)}%)</span>
                                 </td>
                             </tr>
                        ))}
                         {stats.closedHistory.length === 0 && (
                            <tr><td colSpan={7} className="p-8 text-center text-gray-500">No trade history yet.</td></tr>
                        )}
                    </tbody>
                </table>
             </div>
         )}
      </div>
    </div>
  );
};

export default CapitalGrowthPanel;
