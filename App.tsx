
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchTopVolumeTickers, fetchMarketContext, subscribeToTickerUpdates } from './services/binanceService';
import { analyzeMarket, getSecondOpinion } from './services/analysisService';
import TradingViewWidget from './components/TradingViewWidget';
import SignalCard from './components/SignalCard';
import HistoryPanel from './components/HistoryPanel';
import BacktestPanel from './components/BacktestPanel';
import SettingsModal from './components/SettingsModal';
import DiagnosticsModal from './components/DiagnosticsModal';
import TopSetupsBar from './components/TopSetupsBar';
import CapitalGrowthPanel from './components/CapitalGrowthPanel';
import DisclaimerModal from './components/DisclaimerModal';
import { CryptoTicker, AnalysisResult, SignalType } from './types';
import { DEFAULT_SENSITIVITY_MULTIPLIER } from './constants';

// CONFIGURATION
const SCAN_COOL_DOWN_MS = 5 * 60 * 1000; 
const SCAN_DELAY_MS = 4500; // Delay between bulk scan requests (~13 RPM)
const MIN_CONFIDENCE_THRESHOLD = 80; 
const FLASH_ALERT_THRESHOLD_PERCENT = 5.0; // Static 5% threshold for flash alerts

// Icons
const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
);
const ActivityIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
);
const BellIcon = ({ active }: { active: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-primary" : "text-gray-400"}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
const ListIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
);
const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
);
const ZapIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
);
const TrendingUpIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
);
const BugIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
);
const AlertTriangle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
);
const ScanIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
);
const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>
);

type SignalFilter = 'ALL' | 'LONG' | 'SHORT' | 'HIGH_CONF';
type ViewMode = 'CHART' | 'GROWTH';

const formatCompact = (num: number) => {
  if (!num || num === 0) return 'N/A';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  return `$${num.toLocaleString()}`;
};

const App: React.FC = () => {
  const [tickers, setTickers] = useState<CryptoTicker[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  
  const [signals, setSignals] = useState<AnalysisResult[]>(() => {
    try {
      const saved = localStorage.getItem('sentient_active_signals');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [scanIndex, setScanIndex] = useState<number>(0);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);
  const [mobileTab, setMobileTab] = useState<'market' | 'chart' | 'signals' | 'growth'>('chart');
  const [viewMode, setViewMode] = useState<ViewMode>('CHART');
  const [signalTab, setSignalTab] = useState<'live' | 'history' | 'backtest'>('live');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('ALL');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>(['1h', '4h', '1d']);
  const [showDisclaimer, setShowDisclaimer] = useState<boolean>(false);
  const [isBulkScanning, setIsBulkScanning] = useState(false);
  
  const [lastWsUpdate, setLastWsUpdate] = useState<number>(Date.now());
  
  const [sensitivity, setSensitivity] = useState<number>(DEFAULT_SENSITIVITY_MULTIPLIER);
  const [flashAlert, setFlashAlert] = useState<{ symbol: string; percent: number; } | null>(null);
  const [lastError, setLastError] = useState<{ message: string, timestamp: number } | null>(null);

  const tickersRef = useRef<CryptoTicker[]>([]);
  const signalsRef = useRef<AnalysisResult[]>([]);
  const historyRef = useRef<AnalysisResult[]>([]);
  const notificationsEnabledRef = useRef<boolean>(true);
  const selectedTimeframesRef = useRef<string[]>(['1h', '4h', '1d']);
  const scanAbortControllerRef = useRef<AbortController | null>(null);
  
  const rollingHistoryRef = useRef<Record<string, { price: number; timestamp: number }[]>>({});
  const flashCooldownRef = useRef<Record<string, number>>({});

  useEffect(() => { 
    signalsRef.current = signals; 
    localStorage.setItem('sentient_active_signals', JSON.stringify(signals));
  }, [signals]);

  useEffect(() => { notificationsEnabledRef.current = notificationsEnabled; }, [notificationsEnabled]);
  useEffect(() => { selectedTimeframesRef.current = selectedTimeframes; }, [selectedTimeframes]);

  useEffect(() => {
      const accepted = localStorage.getItem('sentient_disclaimer_accepted');
      if (!accepted) setShowDisclaimer(true);
      
      const savedSens = localStorage.getItem('sentient_volatility_sensitivity');
      if (savedSens) setSensitivity(parseFloat(savedSens));

      const savedHist = localStorage.getItem('sentient_history');
      if (savedHist) {
        try {
            const h = JSON.parse(savedHist);
            setHistory(h);
            historyRef.current = h;
        } catch(e) {}
      }
  }, []);

  const handleDisclaimerAccept = () => {
      localStorage.setItem('sentient_disclaimer_accepted', 'true');
      setShowDisclaimer(false);
  };

  const updateSensitivity = (val: number) => {
      setSensitivity(val);
      localStorage.setItem('sentient_volatility_sensitivity', val.toString());
  };

  const addToHistory = (signal: AnalysisResult) => {
    if (historyRef.current.some(s => s.symbol === signal.symbol && s.timestamp === signal.timestamp)) return;
    const recent = historyRef.current.find(s => s.symbol === signal.symbol && (Date.now() - s.timestamp < 3600000));
    if (recent) return;

    const newHistory = [signal, ...historyRef.current].slice(0, 100);
    setHistory(newHistory);
    historyRef.current = newHistory;
    localStorage.setItem('sentient_history', JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    if (confirm('Clear all signal history?')) {
      setHistory([]);
      historyRef.current = [];
      localStorage.removeItem('sentient_history');
    }
  };

  const playAlertSound = (isUrgent: boolean = false) => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playBeep = (time: number, freq: number, type: 'sine' | 'square' = 'sine', duration: number = 0.1) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = type;
          osc.frequency.setValueAtTime(freq, time);
          gain.gain.setValueAtTime(isUrgent ? 0.3 : 0.1, time);
          gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
          osc.start(time);
          osc.stop(time + duration);
      };

      if (isUrgent) {
          const now = ctx.currentTime;
          playBeep(now, 600, 'square', 0.2);
          playBeep(now + 0.2, 800, 'square', 0.2);
          playBeep(now + 0.4, 600, 'square', 0.2);
          playBeep(now + 0.6, 800, 'square', 0.2);
      } else {
          playBeep(ctx.currentTime, 880);
          playBeep(ctx.currentTime + 0.15, 880); 
      }
    } catch (e) {
        console.error("Audio play failed", e);
    }
  };

  const performAnalysisForSymbol = useCallback(async (symbol: string, isFlashTrigger: boolean = false) => {
    if (analyzingSymbol) return false;
    
    setLastError(null); // Clear previous error
    setAnalyzingSymbol(symbol);
    
    if (isFlashTrigger) {
        setSelectedSymbol(symbol);
        setViewMode('CHART');
        setMobileTab('chart');
    }

    try {
        const context = await fetchMarketContext(symbol, selectedTimeframesRef.current);
        if (Object.keys(context).length > 0) {
            const result = await analyzeMarket(symbol, context);
            
            const threshold = isFlashTrigger ? 60 : MIN_CONFIDENCE_THRESHOLD;
            
            if (result && result.confidence >= threshold) {
                setSignals(prev => {
                    const filtered = prev.filter(s => s.symbol !== symbol);
                    if (isFlashTrigger && !result.keyFactors.includes('Flash Move')) {
                        result.keyFactors.push('Flash Move');
                        result.reasoning = `[VOLATILITY ALERT] ${result.reasoning}`;
                    }
                    const updated = [result, ...filtered];
                    signalsRef.current = updated;
                    return updated;
                });

                if (result.signal === SignalType.LONG || result.signal === SignalType.SHORT) {
                    addToHistory(result);
                }
                
                if (result.signal !== SignalType.WAIT && !isFlashTrigger) {
                    if (notificationsEnabledRef.current) playAlertSound(false);
                }
            }
        }
        setAnalyzingSymbol(null);
        return true; 
    } catch (error: any) {
        console.error(`Analysis failed for ${symbol}:`, error);
        setAnalyzingSymbol("Error");
        setLastError({
            message: `Analysis error: ${error.message || 'Unknown error while computing signals.'}`,
            timestamp: Date.now()
        });
        setTimeout(() => setAnalyzingSymbol(null), 4000);
        return false;
    }
  }, [analyzingSymbol]);
  
  const handleGetSecondOpinion = useCallback(async (symbol: string) => {
    setSignals(prev => prev.map(s => s.symbol === symbol ? { ...s, isGettingSecondOpinion: true } : s));
    setLastError(null);

    try {
        const context = await fetchMarketContext(symbol, selectedTimeframesRef.current);
        if (Object.keys(context).length === 0) throw new Error("Could not fetch market data.");

        const opinion = await getSecondOpinion(symbol, context);

        setSignals(prev => prev.map(s => s.symbol === symbol ? {
            ...s,
            isGettingSecondOpinion: false,
            secondOpinion: opinion
        } : s));

    } catch (error: any) {
        console.error(`Second opinion failed for ${symbol}:`, error);
        setLastError({
            message: `Second opinion failed for ${symbol}: ${error.message || 'Unknown error.'}`,
            timestamp: Date.now()
        });
        setSignals(prev => prev.map(s => s.symbol === symbol ? { ...s, isGettingSecondOpinion: false, secondOpinion: null } : s));
    }
  }, []);

  useEffect(() => {
    const loadTop50 = async () => {
      const data = await fetchTopVolumeTickers(50);
      setTickers(prev => {
        const next = data.length > 0 ? data : prev;
        tickersRef.current = next;
        return next;
      });
      if (selectedSymbol === 'BTCUSDT' && data.length > 0 && tickersRef.current.length === 0) {
        setSelectedSymbol(data[0].symbol);
      }
    };
    loadTop50();
    const restInterval = setInterval(loadTop50, 60000);
    
    const unsubscribe = subscribeToTickerUpdates((wsData) => {
        setLastWsUpdate(Date.now());
        const now = Date.now();
        const TEN_MINUTES_MS = 10 * 60 * 1000;
        
        wsData.forEach((t: any) => {
            const sym = t.s;
            const currentPrice = parseFloat(t.c);
            if (!currentPrice) return;
            if (!rollingHistoryRef.current[sym]) rollingHistoryRef.current[sym] = [];
            rollingHistoryRef.current[sym].push({ price: currentPrice, timestamp: now });
            const cutoff = now - TEN_MINUTES_MS;
            while(rollingHistoryRef.current[sym].length > 0 && rollingHistoryRef.current[sym][0].timestamp < cutoff) {
                 rollingHistoryRef.current[sym].shift();
            }
            if (rollingHistoryRef.current[sym].length < 2) return;
            const oldest = rollingHistoryRef.current[sym][0];
            const pctChange = ((currentPrice - oldest.price) / oldest.price) * 100;

            if (Math.abs(pctChange) >= FLASH_ALERT_THRESHOLD_PERCENT) {
                 const lastTrigger = flashCooldownRef.current[sym] || 0;
                 if (now - lastTrigger > 300000) {
                    console.warn(`FLASH ALERT: ${sym} moved ${pctChange.toFixed(2)}% in <10m (Thresh: ${FLASH_ALERT_THRESHOLD_PERCENT}%)`);
                    flashCooldownRef.current[sym] = now;
                    setFlashAlert({ symbol: sym, percent: pctChange });
                    if (notificationsEnabledRef.current) playAlertSound(true); 
                    performAnalysisForSymbol(sym, true);
                 }
            }
        });

        setTickers(prev => {
            if (prev.length === 0) return prev;
            const updates = new Map(wsData.map((t: any) => [t.s, t]));
            let updated = false;
            const next = prev.map(t => {
                const u = updates.get(t.symbol);
                if (u) { updated = true; return { ...t, lastPrice: u.c, priceChangePercent: u.P, quoteVolume: u.q }; }
                return t;
            });
            if (updated) { tickersRef.current = next; return next; }
            return prev;
        });
    });
    return () => { clearInterval(restInterval); unsubscribe(); };
  }, [performAnalysisForSymbol]); 

  const handleScanAll = async () => {
    if (isBulkScanning) {
        if (scanAbortControllerRef.current) {
            scanAbortControllerRef.current.abort();
        }
        setIsBulkScanning(false);
        setAnalyzingSymbol(null);
        return;
    }

    setIsBulkScanning(true);
    scanAbortControllerRef.current = new AbortController();
    const signal = scanAbortControllerRef.current.signal;

    const tickersToScan = tickersRef.current.filter(t => {
        const existingSignal = signalsRef.current.find(s => s.symbol === t.symbol);
        if (!existingSignal) return true;
        return (Date.now() - existingSignal.timestamp) > 30 * 60 * 1000;
    });

    for (const [index, ticker] of tickersToScan.entries()) {
        if (signal.aborted) {
            console.log("Scan aborted by user.");
            break;
        }
        
        setScanIndex(index + 1);
        const success = await performAnalysisForSymbol(ticker.symbol);
        
        if (!success) {
            console.warn("Scan paused due to error/rate-limit. Resuming in 65s.");
            const pausePromise = new Promise(resolve => setTimeout(resolve, 65000));
            const abortPromise = new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(new Error('Aborted')));
            });

            try {
                await Promise.race([pausePromise, abortPromise]);
            } catch (e) {
                console.log("Scan aborted during pause.");
                break;
            }
        }
        
        // Wait before next request
        await new Promise(resolve => setTimeout(resolve, SCAN_DELAY_MS));
    }

    setIsBulkScanning(false);
    scanAbortControllerRef.current = null;
    setScanIndex(0);
  };

  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      if ("Notification" in window) {
         try { await Notification.requestPermission(); } catch (e) {}
      }
      setNotificationsEnabled(true); 
      playAlertSound(); 
    } else { 
      setNotificationsEnabled(false); 
    }
  };

  const handleSymbolClick = (symbol: string) => {
    setSelectedSymbol(symbol);
    setMobileTab('chart');
    setViewMode('CHART');
  };

  const toggleTimeframe = (tf: string) => {
    setSelectedTimeframes(prev => prev.includes(tf) ? prev.filter(t => t !== tf) : [...prev, tf]);
  };

  const handleAnalyzeNow = () => performAnalysisForSymbol(selectedSymbol);

  const currentSignal = signals.find(s => s.symbol === selectedSymbol);
  const completedScans = signals.length;

  const activeSignals = useMemo(() => {
    let filtered = signals.filter(s => s.signal === SignalType.LONG || s.signal === SignalType.SHORT);
    if (signalFilter === 'LONG') filtered = filtered.filter(s => s.signal === SignalType.LONG);
    else if (signalFilter === 'SHORT') filtered = filtered.filter(s => s.signal === SignalType.SHORT);
    return filtered;
  }, [signals, signalFilter]);

  const marketBias = useMemo(() => {
    const longs = signals.filter(s => s.signal === SignalType.LONG).length;
    const shorts = signals.filter(s => s.signal === SignalType.SHORT).length;
    const totalActive = longs + shorts;
    if (totalActive === 0) return { percent: 50, label: 'Neutral' };
    const bullishness = (longs / totalActive) * 100;
    let label = 'Neutral';
    if (bullishness > 60) label = 'Bullish';
    if (bullishness < 40) label = 'Bearish';
    return { percent: bullishness, label };
  }, [signals]);

  return (
    <div className="flex flex-col h-full w-full bg-background text-gray-200 overflow-hidden font-sans pb-16 md:pb-0 relative">
      
      {showDisclaimer && <DisclaimerModal onAccept={handleDisclaimerAccept} />}

      {flashAlert && (
          <div className={`
             fixed top-14 left-1/2 transform -translate-x-1/2 z-[150] px-6 py-3 rounded-lg shadow-2xl border flex items-center gap-4 animate-bounce
             ${flashAlert.percent > 0 ? 'bg-success/90 border-success text-black' : 'bg-danger/90 border-danger text-white'}
          `}>
             <AlertTriangle />
             <div>
                 <div className="font-black text-lg uppercase tracking-wider">
                     VOLATILITY {flashAlert.percent > 0 ? 'PUMP' : 'CRASH'}
                 </div>
                 <div className="text-sm font-bold flex items-center gap-2">
                     {flashAlert.symbol} 
                     <span className="font-mono bg-black/20 px-1 rounded">
                         {flashAlert.percent > 0 ? '+' : ''}{flashAlert.percent.toFixed(2)}%
                     </span>
                     <span className="text-xs opacity-80 ml-2">in 10m</span>
                 </div>
             </div>
             <button onClick={() => setFlashAlert(null)} className="ml-2 bg-black/20 hover:bg-black/30 rounded-full p-1">✕</button>
          </div>
      )}

      {lastError && (
        <div className="fixed bottom-16 md:bottom-4 left-4 right-4 md:left-auto md:w-[420px] z-[200] bg-danger/90 border border-danger text-white p-4 rounded-lg shadow-2xl flex items-start gap-3 backdrop-blur-sm animate-fade-in-up">
            <div className="flex-shrink-0 pt-1">
                <AlertTriangle />
            </div>
            <div className="flex-1">
                <h4 className="font-bold mb-1">Analysis Error</h4>
                <p className="text-xs">{lastError.message}</p>
                <span className="text-[10px] opacity-60 mt-2 block">{new Date(lastError.timestamp).toLocaleTimeString()}</span>
            </div>
            <button onClick={() => setLastError(null)} className="p-1 -mt-2 -mr-2 rounded-full hover:bg-white/20 flex-shrink-0">
                ✕
            </button>
        </div>
      )}

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        selectedTimeframes={selectedTimeframes}
        onToggleTimeframe={toggleTimeframe}
        volatilityThreshold={sensitivity}
        onUpdateThreshold={updateSensitivity}
      />
      
      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        lastWsUpdate={lastWsUpdate}
      />

      <TopSetupsBar signals={signals} onClick={handleSymbolClick} />

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <div className={`
          w-full md:w-64 flex-col border-r border-surfaceHighlight bg-surface/50 min-h-0
          ${mobileTab === 'market' ? 'flex' : 'hidden md:flex'}
        `}>
          <div className="p-4 border-b border-surfaceHighlight flex items-center justify-between">
            <h1 className="font-bold text-lg tracking-tight flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary"></div>
              Sentient<span className="text-gray-400">Trader</span>
            </h1>
            <div className="text-xs text-gray-500 font-mono">v2.4 Pro</div>
          </div>
          <div className="p-3 bg-surfaceHighlight/30 text-xs font-mono text-gray-400 border-b border-surfaceHighlight flex justify-between">
            <span>TOP 50 BY VOLUME</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tickers.map((t) => {
              const isSelected = t.symbol === selectedSymbol;
              const priceChange = parseFloat(t.priceChangePercent);
              return (
                <div 
                  key={t.symbol}
                  onClick={() => handleSymbolClick(t.symbol)}
                  className={`
                    p-3 cursor-pointer border-b border-white/5 hover:bg-surfaceHighlight transition-colors
                    ${isSelected ? 'bg-surfaceHighlight border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'}
                  `}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-gray-300'}`}>{t.symbol}</span>
                    <span className={`text-xs ${priceChange >= 0 ? 'text-success' : 'text-danger'}`}>
                      {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-white text-sm font-medium">{parseFloat(t.lastPrice).toLocaleString()}</span>
                    <div className="flex flex-col items-end">
                       <span className="text-[9px] text-gray-600">Vol {formatCompact(parseFloat(t.quoteVolume))}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER VIEW */}
        <div className={`
          flex-1 flex-col min-w-0 min-h-0 relative
          ${(mobileTab === 'chart' || mobileTab === 'growth') ? 'flex' : 'hidden md:flex'}
        `}>
          <div className="h-14 border-b border-surfaceHighlight flex items-center px-4 justify-between bg-surface/30">
            <div className="flex items-center gap-4">
               <div className="flex bg-surfaceHighlight/50 rounded-lg p-0.5 border border-white/5">
                  <button onClick={() => { setViewMode('CHART'); setMobileTab('chart'); }} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'CHART' ? 'bg-surface border border-white/10 text-white shadow' : 'text-gray-400 hover:text-white'}`}><ActivityIcon /> Chart</button>
                  <button onClick={() => { setViewMode('GROWTH'); setMobileTab('growth'); }} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'GROWTH' ? 'bg-surface border border-white/10 text-success shadow' : 'text-gray-400 hover:text-white'}`}><TrendingUpIcon /> Growth</button>
               </div>
               {viewMode === 'CHART' && (
                 <>
                  <div className="h-6 w-px bg-white/10 mx-2 hidden sm:block"></div>
                  <h2 className="text-xl font-bold text-white hidden sm:block">{selectedSymbol}</h2>
                  <div className="flex items-center gap-2">
                    <button onClick={handleAnalyzeNow} disabled={!!analyzingSymbol} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all disabled:cursor-not-allowed disabled:bg-surfaceHighlight disabled:text-gray-500 bg-primary/20 text-primary hover:bg-primary/30 border border-primary/20"><ZapIcon /> Analyze</button>
                    <button onClick={handleScanAll} disabled={!!analyzingSymbol && !isBulkScanning} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all disabled:cursor-not-allowed disabled:bg-surfaceHighlight disabled:text-gray-500 ${isBulkScanning ? 'bg-danger/80 text-white hover:bg-danger' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                      {isBulkScanning ? <><StopIcon /> Stop</> : <><ScanIcon /> Scan All</>}
                    </button>
                  </div>
                 </>
               )}
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-surfaceHighlight px-3 py-1.5 rounded-full min-w-[100px] justify-center transition-all">
                <span className={`w-2 h-2 rounded-full ${analyzingSymbol?.includes('Rate') ? 'bg-yellow-500' : analyzingSymbol?.includes('Error') ? 'bg-danger' : analyzingSymbol ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`}></span>
                <span className="truncate max-w-[100px]">
                  {analyzingSymbol ? (analyzingSymbol.includes('Rate') ? 'Cooling...' : analyzingSymbol.includes('Error') ? 'Error' : `Scan: ${analyzingSymbol}`) : 'Monitoring'}
                </span>
              </div>
              <button className={`p-2 rounded-full transition ${notificationsEnabled ? 'text-primary bg-primary/10' : 'text-gray-400 hover:bg-surfaceHighlight'}`} onClick={toggleNotifications} title={notificationsEnabled ? "Alerts On" : "Enable Alerts"}><BellIcon active={notificationsEnabled} /></button>
              <button className="p-2 hover:bg-surfaceHighlight rounded-full text-gray-400 transition" onClick={() => setIsDiagnosticsOpen(true)} title="System Diagnostics"><BugIcon /></button>
              <button className="p-2 hover:bg-surfaceHighlight rounded-full text-gray-400 transition" onClick={() => setIsSettingsOpen(true)} title="Settings"><SettingsIcon /></button>
              <button className="p-2 hover:bg-surfaceHighlight rounded-full text-gray-400 transition" onClick={() => window.location.reload()}><RefreshIcon /></button>
            </div>
          </div>
          <div className="flex-1 p-0 sm:p-4 bg-background relative overflow-hidden">
             <div className={`w-full h-full ${viewMode === 'CHART' ? 'block' : 'hidden'}`}><TradingViewWidget symbol={selectedSymbol} activeSignal={currentSignal} /></div>
             <div className={`w-full h-full ${viewMode === 'GROWTH' ? 'block' : 'hidden'}`}><CapitalGrowthPanel signals={history} tickers={tickers} isVisible={viewMode === 'GROWTH'} /></div>
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className={`w-full md:w-[420px] border-l border-surfaceHighlight bg-surface/30 flex-col min-h-0 ${mobileTab === 'signals' ? 'flex' : 'hidden md:flex'}`}>
          {signalTab === 'live' && (
              <div className="px-4 py-3 bg-gradient-to-b from-surfaceHighlight/40 to-transparent border-b border-surfaceHighlight">
                <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Market Bias</span>
                    <span className={`text-[10px] font-bold ${marketBias.percent > 50 ? 'text-success' : 'text-danger'}`}>{marketBias.label} ({marketBias.percent.toFixed(0)}%)</span>
                </div>
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
                    <div className="h-full bg-success transition-all duration-500" style={{ width: `${marketBias.percent}%` }}></div>
                    <div className="h-full bg-danger transition-all duration-500" style={{ width: `${100 - marketBias.percent}%` }}></div>
                </div>
              </div>
          )}
          <div className="p-3 border-b border-surfaceHighlight flex gap-1">
             <button onClick={() => setSignalTab('live')} className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-colors ${signalTab === 'live' ? 'bg-primary text-white' : 'bg-surfaceHighlight text-gray-400'}`}>LIVE</button>
             <button onClick={() => setSignalTab('history')} className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-colors ${signalTab === 'history' ? 'bg-accent text-white' : 'bg-surfaceHighlight text-gray-400'}`}>HISTORY</button>
             <button onClick={() => setSignalTab('backtest')} className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-colors ${signalTab === 'backtest' ? 'bg-gray-700 text-white' : 'bg-surfaceHighlight text-gray-400'}`}>SIM</button>
          </div>
          {signalTab === 'live' && (
            <>
              <div className="flex gap-2 p-2 overflow-x-auto border-b border-surfaceHighlight no-scrollbar">
                  {[ { id: 'ALL', label: 'All' }, { id: 'LONG', label: 'Longs' }, { id: 'SHORT', label: 'Shorts' } ].map((f) => (
                      <button key={f.id} onClick={() => setSignalFilter(f.id as SignalFilter)} className={`px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap border transition-all ${signalFilter === f.id ? 'bg-white text-black border-white' : 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-500'}`}>{f.label}</button>
                  ))}
              </div>
              <div className="p-2 bg-surface/10 border-b border-surfaceHighlight flex justify-between items-center">
                <div className="text-xs text-gray-500 flex items-center gap-2"><ActivityIcon /><span>Scanning {isBulkScanning ? `${scanIndex}/${tickers.length}` : '--'}</span></div>
                <span className="text-xs text-gray-500">{completedScans} analyzed</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {activeSignals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-gray-600 space-y-2 mt-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <span className="text-xs">Gathering High Confidence Setups...</span>
                  </div>
                ) : (
                  activeSignals.map((signal) => {
                    const ticker = tickers.find(t => t.symbol === signal.symbol);
                    return <SignalCard key={`${signal.symbol}-${signal.timestamp}`} data={signal} currentPrice={ticker ? parseFloat(ticker.lastPrice) : undefined} onClick={handleSymbolClick} onGetSecondOpinion={handleGetSecondOpinion} />;
                  })
                )}
                {signalFilter === 'ALL' && signals.filter(s => s.signal === SignalType.WAIT).slice(0, 5).map(signal => (
                  <div key={signal.symbol} onClick={() => handleSymbolClick(signal.symbol)} className="flex items-center justify-between p-3 rounded bg-surfaceHighlight/20 hover:bg-surfaceHighlight/50 cursor-pointer border border-transparent hover:border-white/5 transition-all">
                      <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-500"></div><span className="font-bold text-sm text-gray-400">{signal.symbol}</span></div>
                      <span className="text-xs text-gray-600 bg-black/20 px-2 py-0.5 rounded">WAIT</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {signalTab === 'history' && <HistoryPanel history={history} tickers={tickers} onClear={clearHistory} onClick={handleSymbolClick} />}
          {signalTab === 'backtest' && <BacktestPanel tickers={tickers} onClose={() => setSignalTab('live')} />}
          <div className="p-3 border-t border-surfaceHighlight text-[10px] text-gray-600 text-center">Powered by Google Gemini • Not Financial Advice</div>
        </div>
      </div>
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-surfaceHighlight flex items-center justify-around z-50 pb-safe">
        <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 p-2 ${mobileTab === 'market' ? 'text-primary' : 'text-gray-500'}`}><ListIcon /><span className="text-[10px]">Market</span></button>
        <button onClick={() => { setViewMode('CHART'); setMobileTab('chart'); }} className={`flex flex-col items-center gap-1 p-2 ${mobileTab === 'chart' ? 'text-primary' : 'text-gray-500'}`}><ActivityIcon /><span className="text-[10px]">Chart</span></button>
        <button onClick={() => { setViewMode('GROWTH'); setMobileTab('growth'); }} className={`flex flex-col items-center gap-1 p-2 ${mobileTab === 'growth' ? 'text-primary' : 'text-gray-500'}`}><TrendingUpIcon /><span className="text-[10px]">Growth</span></button>
        <button onClick={() => setMobileTab('signals')} className={`flex flex-col items-center gap-1 p-2 ${mobileTab === 'signals' ? 'text-primary' : 'text-gray-500'}`}><BellIcon active={mobileTab === 'signals'} /><span className="text-[10px]">Analysis</span></button>
      </div>
    </div>
  );
};

export default App;
