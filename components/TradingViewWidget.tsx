
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import { AnalysisResult } from '../types';
import { fetchKlines } from '../services/binanceService';

interface Props {
  symbol: string;
  activeSignal?: AnalysisResult | null;
}

const TIMEFRAMES = [
  { label: '15M', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
];

const TradingViewWidget: React.FC<Props> = ({ symbol, activeSignal }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [interval, setInterval] = useState<string>('1h');
  
  // Extract Levels directly from structured data
  const levels = useMemo(() => {
    if (!activeSignal) return null;
    
    const parsePrice = (str?: string) => {
      if (!str) return null;
      // Remove commas and parse
      const val = parseFloat(str.replace(/,/g, ''));
      return isNaN(val) ? null : val;
    };

    return {
      support: parsePrice(activeSignal.support),
      resistance: parsePrice(activeSignal.resistance),
      entry: parsePrice(activeSignal.entry),
      tp: parsePrice(activeSignal.tp),
      sl: parsePrice(activeSignal.sl),
    };
  }, [activeSignal]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clear any existing chart
    chartContainerRef.current.innerHTML = '';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131318' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1c1c24' },
        horzLines: { color: '#1c1c24' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Set as overlay
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Place volume at bottom
        bottom: 0,
      },
    });

    // Moving Averages
    const ema200Series = chart.addLineSeries({ color: '#f97316', lineWidth: 2, priceScaleId: 'right', title: 'EMA 200' }); // Orange

    // Helper to calculate EMA
    const calculateEMA = (data: {time: any, close: number}[], period: number) => {
        const k = 2 / (period + 1);
        const result = [];
        if (data.length === 0) return [];
        let ema = data[0].close; // Initial EMA can be approximated as the first price or SMA
        
        // Better initial seed: SMA of first N
        if (data.length > period) {
            let sum = 0;
            for(let j=0; j<period; j++) sum += data[j].close;
            ema = sum / period;
        }

        for (let i = 0; i < data.length; i++) {
            if (i < period) {
                 // Optionally skip or ramp up. Simple ramp up:
                 ema = data[i].close * k + ema * (1 - k);
                 // We won't push until we have enough data for stability usually, but for chart continuity:
                 if (i === period - 1) result.push({ time: data[i].time, value: ema }); 
            } else {
                 ema = data[i].close * k + ema * (1 - k);
                 result.push({ time: data[i].time, value: ema });
            }
        }
        return result;
    }

    const loadData = async () => {
      setLoading(true);
      try {
        const klines = await fetchKlines(symbol, interval, 750); // Use selected interval
        if (klines.length === 0) return;

        const candleData = klines.map(k => ({
          time: k.openTime / 1000,
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
        }));
        
        const volumeData = klines.map(k => ({
          time: k.openTime / 1000,
          value: parseFloat(k.volume),
          color: parseFloat(k.close) >= parseFloat(k.open) ? '#10b981' : '#ef4444',
        }));

        const closeData = candleData.map(d => ({ time: d.time, close: d.close }));
        
        const ema200Data = calculateEMA(closeData, 200);

        candlestickSeries.setData(candleData as any);
        volumeSeries.setData(volumeData as any);
        ema200Series.setData(ema200Data as any);

        // Draw Levels
        if (levels) {
            if (levels.support) {
                candlestickSeries.createPriceLine({
                    price: levels.support,
                    color: '#22c55e',
                    lineWidth: 2,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'SUPPORT',
                });
            }
            if (levels.resistance) {
                candlestickSeries.createPriceLine({
                    price: levels.resistance,
                    color: '#ef4444',
                    lineWidth: 2,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'RESISTANCE',
                });
            }
            if (levels.entry) {
                candlestickSeries.createPriceLine({
                    price: levels.entry,
                    color: '#3b82f6',
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'ENTRY',
                });
            }
            if (levels.tp) {
                candlestickSeries.createPriceLine({
                    price: levels.tp,
                    color: '#10b981',
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'TARGET',
                });
            }
            if (levels.sl) {
                candlestickSeries.createPriceLine({
                    price: levels.sl,
                    color: '#ef4444',
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'STOP',
                });
            }
        }

        chart.timeScale().fitContent();
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Resize Handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
      }
    };
    
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [symbol, levels, interval]); // Re-run when interval changes

  return (
    <div className="h-full w-full bg-surface rounded-lg overflow-hidden border border-surfaceHighlight relative">
       {loading && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
           </div>
       )}
       <div ref={chartContainerRef} className="w-full h-full" />
       
       {/* Legend Overlay */}
       <div className="absolute top-4 left-4 pointer-events-none z-10 bg-black/40 backdrop-blur-sm p-2 rounded border border-white/5 shadow-xl">
         <div className="text-sm font-bold text-white mb-1">{symbol} <span className="text-gray-400 text-xs">{interval.toUpperCase()}</span></div>
         
         <div className="flex flex-col gap-1 text-[10px] font-mono border-b border-white/10 pb-1 mb-1">
            <div className="flex gap-2">
                <span className="text-orange-500">EMA 200</span>
            </div>
         </div>

         {levels && (levels.support || levels.resistance) ? (
            <div className="flex flex-col gap-1 text-xs font-mono">
                {levels.support && <div className="text-green-500 flex justify-between gap-2"><span>Sup:</span><span>{levels.support}</span></div>}
                {levels.resistance && <div className="text-red-500 flex justify-between gap-2"><span>Res:</span><span>{levels.resistance}</span></div>}
                {levels.entry && <div className="text-blue-400 flex justify-between gap-2"><span>Ent:</span><span>{levels.entry}</span></div>}
            </div>
         ) : (
             <div className="text-[10px] text-gray-500 italic">
               Waiting for analysis...
             </div>
         )}
       </div>

       {/* Timeframe Selector */}
       <div className="absolute top-4 right-4 z-20 flex bg-black/40 backdrop-blur-sm rounded-lg border border-white/10 p-1">
          {TIMEFRAMES.map((tf) => (
             <button
                key={tf.value}
                onClick={() => setInterval(tf.value)}
                className={`
                  px-3 py-1 text-[10px] font-bold rounded transition-colors
                  ${interval === tf.value ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}
                `}
             >
                {tf.label}
             </button>
          ))}
       </div>
    </div>
  );
};

export default React.memo(TradingViewWidget);