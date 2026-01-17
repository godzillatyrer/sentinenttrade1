import React from 'react';
import { AnalysisResult, SignalType } from '../types';

interface Props {
  signals: AnalysisResult[];
  onClick: (symbol: string) => void;
}

const TopSetupsBar: React.FC<Props> = ({ signals, onClick }) => {
  // Filter for active trades (Long/Short) and sort by confidence
  const bestSignals = signals
    .filter(s => s.signal === SignalType.LONG || s.signal === SignalType.SHORT)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);

  if (bestSignals.length === 0) return null;

  return (
    <div className="w-full bg-surface border-b border-surfaceHighlight p-2 flex items-center overflow-x-auto gap-4 shadow-xl z-20 no-scrollbar md:justify-center">
      <div className="text-[10px] font-bold text-primary uppercase tracking-widest whitespace-nowrap hidden md:block">
        ★ High Confidence Setups
      </div>
      
      {bestSignals.map((signal) => (
        <div 
          key={signal.symbol}
          onClick={() => onClick(signal.symbol)}
          className={`
            cursor-pointer flex items-center gap-3 px-4 py-1.5 rounded-full border transition-transform hover:scale-105 flex-shrink-0
            ${signal.signal === SignalType.LONG 
              ? 'bg-success/10 border-success/30 hover:bg-success/20' 
              : 'bg-danger/10 border-danger/30 hover:bg-danger/20'}
          `}
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-white">{signal.symbol}</span>
            <span className={`text-[10px] font-bold px-1.5 rounded ${signal.signal === SignalType.LONG ? 'bg-success text-black' : 'bg-danger text-white'}`}>
              {signal.signal}
            </span>
          </div>
          
          <div className="h-4 w-px bg-white/10 mx-1"></div>

          <div className="flex gap-3 text-xs font-mono">
            <div>
              <span className="text-gray-500 mr-1">Entry</span>
              {/* UPDATED: Brighter/Bolder Price */}
              <span className="text-white font-bold">{parseFloat(signal.entry).toLocaleString()}</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-gray-500 mr-1">Conf</span>
              <span className={`font-bold ${signal.confidence > 80 ? 'text-yellow-400' : 'text-white'}`}>
                {signal.confidence}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TopSetupsBar;