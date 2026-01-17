
import React, { useMemo } from 'react';
import { AnalysisResult, SignalType, CryptoTicker } from '../types';

interface Props {
  history: AnalysisResult[];
  tickers: CryptoTicker[];
  onClear: () => void;
  onClick: (symbol: string) => void;
}

const HistoryPanel: React.FC<Props> = ({ history, tickers, onClear, onClick }) => {
  // Create a map for O(1) price lookups
  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    tickers.forEach(t => {
      map[t.symbol] = parseFloat(t.lastPrice);
    });
    return map;
  }, [tickers]);

  const stats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let open = 0;
    
    // High Confidence Stats (>80%)
    let hcWins = 0;
    let hcTotal = 0;
    
    const processedHistory = history.map(signal => {
      const currentPrice = priceMap[signal.symbol];
      if (!currentPrice) return { ...signal, status: 'UNKNOWN', pnl: 0 };

      const entry = parseFloat(signal.entry);
      const tp = parseFloat(signal.tp);
      const sl = parseFloat(signal.sl);
      
      let status: 'WIN' | 'LOSS' | 'OPEN' = 'OPEN';
      let pnl = 0;

      if (signal.signal === SignalType.LONG) {
        if (currentPrice >= tp) status = 'WIN';
        else if (currentPrice <= sl) status = 'LOSS';
        
        // Approx PnL % based on current price vs entry
        pnl = ((currentPrice - entry) / entry) * 100;
      } else if (signal.signal === SignalType.SHORT) {
        if (currentPrice <= tp) status = 'WIN';
        else if (currentPrice >= sl) status = 'LOSS';
        
        pnl = ((entry - currentPrice) / entry) * 100;
      }

      if (status === 'WIN') wins++;
      if (status === 'LOSS') losses++;
      if (status === 'OPEN') open++;

      // Only count completed high confidence trades for win rate
      if (signal.confidence >= 80) {
          if (status === 'WIN') { hcWins++; hcTotal++; }
          else if (status === 'LOSS') { hcTotal++; }
      }

      return { ...signal, status, pnl };
    });

    return { processedHistory, wins, losses, open, total: wins + losses, hcWins, hcTotal };
  }, [history, priceMap]);

  // Calculate Win Rate based on High Confidence Setups only
  const winRate = stats.hcTotal > 0 ? Math.round((stats.hcWins / stats.hcTotal) * 100) : 0;
  
  const getModelName = (model?: string) => {
    if (!model) return null;
    return model.replace('gemini-', '').replace('-preview', '');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Stats Header */}
      <div className="p-4 grid grid-cols-3 gap-2 border-b border-surfaceHighlight bg-surface/20">
        <div className="bg-surfaceHighlight/40 p-2 rounded flex flex-col items-center">
          <span className="text-[10px] text-gray-400 uppercase">Win Rate <span className="text-[8px] opacity-60">(&gt;80%)</span></span>
          <span className={`text-xl font-bold ${winRate >= 50 ? 'text-success' : 'text-danger'}`}>
            {winRate}%
          </span>
        </div>
        <div className="bg-surfaceHighlight/40 p-2 rounded flex flex-col items-center">
          <span className="text-[10px] text-gray-400 uppercase">All W / L</span>
          <span className="text-lg font-mono text-gray-200">{stats.wins}/{stats.losses}</span>
        </div>
        <div className="bg-surfaceHighlight/40 p-2 rounded flex flex-col items-center">
          <span className="text-[10px] text-gray-400 uppercase">Open</span>
          <span className="text-lg font-mono text-blue-400">{stats.open}</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {stats.processedHistory.length === 0 ? (
          <div className="text-center text-gray-500 mt-10 text-xs">No history yet.</div>
        ) : (
          stats.processedHistory.map((item, idx) => (
            <div 
              key={`${item.symbol}-${item.timestamp}`}
              onClick={() => onClick(item.symbol)}
              className={`
                p-3 rounded border cursor-pointer hover:bg-surfaceHighlight transition-colors relative overflow-hidden
                ${item.status === 'WIN' ? 'border-success/30 bg-success/5' : ''}
                ${item.status === 'LOSS' ? 'border-danger/30 bg-danger/5' : ''}
                ${item.status === 'OPEN' ? 'border-white/10 bg-surface' : ''}
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-gray-200">{item.symbol}</span>
                  <span className={`text-[9px] px-1.5 rounded border ${
                    item.signal === SignalType.LONG ? 'border-success text-success' : 'border-danger text-danger'
                  }`}>
                    {item.signal}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`font-mono text-xs font-bold ${item.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        {item.pnl > 0 ? '+' : ''}{item.pnl.toFixed(2)}%
                    </span>
                    {item.status !== 'OPEN' && (
                        <span className={`text-[9px] px-1 rounded font-bold ${
                        item.status === 'WIN' ? 'bg-success text-black' : 'bg-danger text-white'
                        }`}>
                        {item.status}
                        </span>
                    )}
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-1 text-[10px] text-gray-500 mt-2 font-mono">
                 <div>E: <span className="text-gray-300">{parseFloat(item.entry).toLocaleString()}</span></div>
                 <div>TP: <span className="text-gray-300">{parseFloat(item.tp).toLocaleString()}</span></div>
                 <div>SL: <span className="text-gray-300">{parseFloat(item.sl).toLocaleString()}</span></div>
              </div>

              <div className="mt-2 text-[9px] text-gray-600 flex justify-between items-center">
                 <span>{new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                 <div className="flex items-center gap-2">
                   {item.modelUsed && <span className="text-purple-500 font-mono bg-purple-500/10 px-1 rounded-sm">{getModelName(item.modelUsed)}</span>}
                   <span>Conf: {item.confidence}%</span>
                 </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-2 border-t border-surfaceHighlight">
         <button 
           onClick={onClear}
           className="w-full py-2 text-xs text-gray-500 hover:text-white hover:bg-white/5 rounded transition-colors"
         >
           Clear History
         </button>
      </div>
    </div>
  );
};

export default HistoryPanel;