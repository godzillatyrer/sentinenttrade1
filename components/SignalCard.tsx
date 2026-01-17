
import React from 'react';
import { AnalysisResult, SignalType } from '../types';

interface Props {
  data: AnalysisResult;
  currentPrice?: number;
  onClick: (symbol: string) => void;
  onGetSecondOpinion: (symbol: string) => void;
}

const SecondOpinionView: React.FC<{ primary: AnalysisResult, opinion: AnalysisResult }> = ({ primary, opinion }) => {
    const signalsMatch = primary.signal === opinion.signal;
    const modelName = opinion.modelUsed?.replace('gemini-', '').replace('-preview', '');

    const getConfidenceDiff = () => {
        const diff = opinion.confidence - primary.confidence;
        if (diff === 0) return <span className="text-gray-400">No Change</span>;
        return <span className={diff > 0 ? 'text-success' : 'text-danger'}>{diff > 0 ? '+' : ''}{diff}%</span>;
    };
    
    const StatusBadge = () => {
        if (signalsMatch && opinion.signal !== SignalType.WAIT) {
            return (
              <div className="flex items-center gap-1 text-success text-xs font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                 <span>CONFIRMED</span>
              </div>
            );
        }
        if (opinion.signal === SignalType.WAIT) {
             return (
              <div className="flex items-center gap-1 text-yellow-500 text-xs font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                 <span>NEUTRALIZED</span>
              </div>
            );
        }
        return (
             <div className="flex items-center gap-1 text-yellow-500 text-xs font-bold">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                <span>DIVERGENCE</span>
             </div>
        );
    }

    const entry = parseFloat(opinion.entry);
    const tp = parseFloat(opinion.tp);
    const sl = parseFloat(opinion.sl);
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rrRatio = risk > 0 ? (reward / risk).toFixed(1) : '∞';

    return (
        <div className="mt-3 pt-3 border-t-2 border-dashed border-accent/20 bg-accent/5 p-3 rounded-b-lg">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-accent">Expert Opinion</span>
                    {modelName && <span className="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 rounded font-mono border border-purple-500/20">{modelName}</span>}
                </div>
                <StatusBadge />
            </div>
            
            <p className="text-[11px] text-gray-400 leading-relaxed font-medium line-clamp-2 border-l-2 border-accent/50 pl-2 mb-3 italic">
                "{opinion.reasoning}"
            </p>

            <div className="grid grid-cols-4 gap-2 text-[10px] text-center font-mono">
                <div className="bg-black/20 p-1 rounded">
                    <span className="block text-gray-500 uppercase text-[8px] mb-0.5">Signal</span>
                    <span className={`font-bold text-xs ${opinion.signal === SignalType.LONG ? 'text-success' : opinion.signal === SignalType.SHORT ? 'text-danger' : 'text-gray-400'}`}>{opinion.signal}</span>
                </div>
                <div className="bg-black/20 p-1 rounded">
                    <span className="block text-gray-500 uppercase text-[8px] mb-0.5">Confidence</span>
                    <span className="font-bold text-xs text-white">{opinion.confidence}% ({getConfidenceDiff()})</span>
                </div>
                <div className="bg-black/20 p-1 rounded">
                    <span className="block text-gray-500 uppercase text-[8px] mb-0.5">Entry</span>
                    <span className="font-bold text-xs text-white">{opinion.entry}</span>
                </div>
                 <div className="bg-black/20 p-1 rounded">
                    <span className="block text-gray-500 uppercase text-[8px] mb-0.5">R/R</span>
                    <span className="font-bold text-xs text-white">1:{rrRatio}</span>
                </div>
            </div>
        </div>
    );
};

const SignalCard: React.FC<Props> = ({ data, currentPrice, onClick, onGetSecondOpinion }) => {
  const isLong = data.signal === SignalType.LONG;
  const isShort = data.signal === SignalType.SHORT;
  const modelName = data.modelUsed?.replace('gemini-', '').replace('-preview', '');
  
  const entry = parseFloat(data.entry);
  const tp = parseFloat(data.tp);
  const sl = parseFloat(data.sl);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rrRatio = risk > 0 ? (reward / risk).toFixed(1) : '∞';

  const shouldShowSecondOpinionButton = data.confidence >= 85 && !data.secondOpinion && !data.isGettingSecondOpinion && data.modelUsed?.includes('flash');

  return (
    <div className="animate-fade-in-up bg-surface border border-surfaceHighlight rounded-lg shadow-lg p-4 transition-all hover:border-white/20">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 onClick={() => onClick(data.symbol)} className="text-xl font-bold text-white cursor-pointer hover:text-primary transition-colors">{data.symbol}</h3>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isLong ? 'bg-success text-black' : 'bg-danger text-white'}`}>
              {data.signal}
            </span>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {new Date(data.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-baseline gap-1">
            <span className="text-sm text-gray-400">Conf.</span>
            <span className={`text-2xl font-bold ${data.confidence > 85 ? 'text-primary' : 'text-white'}`}>
              {data.confidence}<span className="text-base">%</span>
            </span>
          </div>
           {modelName && <span className="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 rounded font-mono border border-purple-500/20">{modelName}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono mb-3">
        <div className="bg-black/20 p-2 rounded">
          <span className="block text-[10px] text-gray-400 uppercase">Entry</span>
          <span className="font-bold text-sm text-white">{data.entry}</span>
        </div>
        <div className="bg-black/20 p-2 rounded">
          <span className="block text-[10px] text-gray-400 uppercase">Target</span>
          <span className="font-bold text-sm text-success">{data.tp}</span>
        </div>
        <div className="bg-black/20 p-2 rounded">
          <span className="block text-[10px] text-gray-400 uppercase">Stop</span>
          <span className="font-bold text-sm text-danger">{data.sl}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono mb-4">
        <div className="bg-black/20 p-2 rounded">
          <span className="block text-[10px] text-gray-400 uppercase">Risk/Reward</span>
          <span className="font-bold text-sm text-white">1 : {rrRatio}</span>
        </div>
        <div className="bg-black/20 p-2 rounded">
          <span className="block text-[10px] text-gray-400 uppercase">Leverage</span>
          <span className="font-bold text-sm text-white">{data.leverage}</span>
        </div>
      </div>
      
      <p className="text-xs text-gray-400 leading-relaxed font-medium line-clamp-2 italic border-l-2 border-white/10 pl-3">
        {data.reasoning}
      </p>

      {data.keyFactors && data.keyFactors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.keyFactors.slice(0, 3).map(factor => (
            <span key={factor} className="text-[10px] bg-white/5 text-gray-400 px-2 py-0.5 rounded-full">{factor}</span>
          ))}
        </div>
      )}

      {(shouldShowSecondOpinionButton || data.isGettingSecondOpinion) && (
        <div className="mt-4 pt-3 border-t border-dashed border-white/10">
            <button
                onClick={() => onGetSecondOpinion(data.symbol)}
                disabled={data.isGettingSecondOpinion}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold transition-all disabled:cursor-wait disabled:bg-accent/10 bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30"
            >
                {data.isGettingSecondOpinion ? (
                    <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent"></div>
                        <span>Pro Analyzing...</span>
                    </>
                ) : (
                    "Get Second Opinion"
                )}
            </button>
        </div>
      )}

      {data.secondOpinion && (
          <SecondOpinionView primary={data} opinion={data.secondOpinion} />
      )}
    </div>
  );
};

export default SignalCard;
