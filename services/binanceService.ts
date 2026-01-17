
import { CryptoTicker, Kline } from '../types';
import { BINANCE_FUTURES_API, EXCLUDED_COINS, DEFAULT_PROXY_URL } from '../constants';

// --- CONFIGURATION ---
const BYBIT_API = 'https://api.bybit.com/v5/market';

// List of CORS proxies to try in order (Fallback only)
const PROXIES = [
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`
];

// --- PROXY HELPERS ---

export const createProxyUrl = (targetUrl: string, customProxy?: string | null): string => {
    const proxyBase = customProxy || DEFAULT_PROXY_URL;
    if (proxyBase) {
        const cleanProxy = proxyBase.trim();
        if (cleanProxy.includes('?')) return `${cleanProxy}${encodeURIComponent(targetUrl)}`;
        if (cleanProxy.endsWith('=')) return `${cleanProxy}${encodeURIComponent(targetUrl)}`;
        const separator = cleanProxy.includes('?') ? '' : '?url=';
        return `${cleanProxy}${separator}${encodeURIComponent(targetUrl)}`;
    }
    return targetUrl; 
}

/**
 * Robust Fetch that handles JSON parsing and proxy rotation.
 */
const robustFetch = async (targetUrl: string): Promise<any> => {
  let lastError: Error | null = null;
  const userSetting = localStorage.getItem('sentient_custom_proxy');
  const activeProxy = userSetting || DEFAULT_PROXY_URL; 

  // 1. Try Primary Proxy
  if (activeProxy) {
      try {
          const proxyUrl = createProxyUrl(targetUrl, activeProxy);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(proxyUrl, { 
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
          });
          clearTimeout(timeoutId);

          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } 
          catch(e) {
               if (text.includes('contents')) { // AllOrigins check
                   const w = JSON.parse(text);
                   data = JSON.parse(w.contents);
               } else { throw e; }
          }
          
          if (data && data.contents && typeof data.contents === 'string') {
              try { return JSON.parse(data.contents); } catch(e) {}
          }
          if (data && data.status && data.status.http_code) return data.contents; 

          return data;
      } catch (error: any) {
          console.warn(`Primary proxy failed: ${error.message}. trying backups...`);
      }
  }

  // 2. Try Backup Public Proxies
  for (const formatProxyUrl of PROXIES) {
    try {
      const proxyUrl = formatProxyUrl(targetUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(proxyUrl, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { continue; }

      if (proxyUrl.includes('allorigins') && data.contents) {
          try { return JSON.parse(data.contents); } catch(e) { return data.contents; }
      }
      return data;
    } catch (error: any) {
      lastError = error;
    }
  }
  throw lastError || new Error('All proxies failed');
};

// --- DATA FETCHERS (MULTI-EXCHANGE) ---

// 1. BINANCE
const fetchBinanceTickers = async (limit: number): Promise<CryptoTicker[]> => {
    const url = `${BINANCE_FUTURES_API}/ticker/24hr`;
    const data = await robustFetch(url);
    if (!Array.isArray(data)) throw new Error('Binance data not array');
    
    return data
      .filter((t: any) => t.symbol.endsWith('USDT'))
      .filter((t: any) => {
        const base = t.symbol.replace('USDT', '');
        return !EXCLUDED_COINS.some(ex => base.includes(ex));
      })
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map((t: any) => ({
        symbol: t.symbol,
        priceChangePercent: t.priceChangePercent,
        lastPrice: t.lastPrice,
        quoteVolume: t.quoteVolume
      }));
};

// 2. BYBIT (BACKUP)
const fetchBybitTickers = async (limit: number): Promise<CryptoTicker[]> => {
    const url = `${BYBIT_API}/tickers?category=linear`;
    const data = await robustFetch(url);
    
    if (data && data.retCode === 0 && data.result?.list) {
        return data.result.list
            .filter((t: any) => t.symbol.endsWith('USDT'))
            .filter((t: any) => {
                const base = t.symbol.replace('USDT', '');
                return !EXCLUDED_COINS.some(ex => base.includes(ex));
            })
            .sort((a: any, b: any) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h)) 
            .slice(0, limit)
            .map((t: any) => ({
                symbol: t.symbol,
                priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(2),
                lastPrice: t.lastPrice,
                quoteVolume: t.turnover24h
            }));
    }
    throw new Error('Invalid Bybit Response');
};

// MAIN TICKER FUNCTION
export const fetchTopVolumeTickers = async (limit: number = 50): Promise<CryptoTicker[]> => {
  try {
      return await fetchBinanceTickers(limit).catch(() => fetchBybitTickers(limit));
  } catch (error) {
      console.error("All Exchanges Failed:", error);
      return [];
  }
};

// --- KLINES (MULTI-EXCHANGE) ---
const mapBinanceKline = (k: any[]): Kline => ({
  openTime: k[0],
  open: k[1],
  high: k[2],
  low: k[3],
  close: k[4],
  volume: k[5],
  closeTime: k[6]
});

const mapBybitKline = (k: any[]): Kline => ({
  openTime: parseInt(k[0]),
  open: k[1],
  high: k[2],
  low: k[3],
  close: k[4],
  volume: k[5], 
  closeTime: parseInt(k[0]) + 60000 
});

const getBybitInterval = (tf: string) => {
    const map: Record<string, string> = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
    return map[tf] || '60';
};

export const fetchKlines = async (symbol: string, interval: string = '1h', limit: number = 100): Promise<Kline[]> => {
  try {
      const url = `${BINANCE_FUTURES_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const data = await robustFetch(url);
      if (Array.isArray(data)) return data.map(mapBinanceKline);
  } catch (e) {}

  try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const data = await robustFetch(url);
      if (Array.isArray(data)) return data.map(mapBinanceKline);
  } catch (e) {}

  try {
      const bybitInterval = getBybitInterval(interval);
      const url = `${BYBIT_API}/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=${Math.min(limit, 200)}`;
      const data = await robustFetch(url);
      if (data && data.retCode === 0 && data.result?.list) {
          const klines = data.result.list.map(mapBybitKline);
          return klines.reverse();
      }
  } catch (e) {
      console.error("Bybit Kline Fetch Failed", e);
  }

  return [];
};

export const fetchMarketContext = async (symbol: string, timeframes: string[]): Promise<Record<string, Kline[]>> => {
  try {
    const getLimit = (tf: string) => {
      if (tf.endsWith('m')) return 30; 
      if (tf === '1h') return 50;
      if (tf === '4h') return 40;
      if (tf === '1d') return 30;
      return 20; 
    };

    const promises = timeframes.map(tf => fetchKlines(symbol, tf, getLimit(tf)));
    const results = await Promise.all(promises);
    
    const context: Record<string, Kline[]> = {};
    timeframes.forEach((tf, index) => {
      if (results[index] && results[index].length > 0) {
        context[tf] = results[index];
      }
    });
    
    return context;
  } catch (error) {
    console.error("Context Fetch Error:", error);
    return {};
  }
};

export const fetchHistoricalData = async (symbol: string, interval: string, limit: number = 500): Promise<Kline[]> => {
  return fetchKlines(symbol, interval, limit);
};

export const subscribeToTickerUpdates = (onUpdate: (data: any[]) => void) => {
  let ws: WebSocket | null = null;
  let pollingInterval: any = null;
  let isClosed = false;

  const startPolling = () => {
      if (pollingInterval) return;
      console.log("Switching to Polling Mode due to WS failure...");
      pollingInterval = setInterval(async () => {
          if (isClosed) return;
          const tickers = await fetchTopVolumeTickers(50);
          if (tickers.length > 0) {
              const updateData = tickers.map(t => ({
                  s: t.symbol,
                  c: t.lastPrice,
                  P: t.priceChangePercent,
                  q: t.quoteVolume
              }));
              onUpdate(updateData);
          }
      }, 5000); 
  };

  const connectWs = () => {
      try {
          ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');
          
          ws.onmessage = (event) => {
              try {
                  const data = JSON.parse(event.data);
                  if (Array.isArray(data)) {
                      onUpdate(data);
                  }
              } catch (e) {}
          };

          ws.onerror = (e) => {
              console.warn("WS Error, attempting fallback", e);
              ws?.close();
          };

          ws.onclose = () => {
              if (!isClosed) startPolling();
          };
      } catch (e) {
          startPolling();
      }
  };

  connectWs();

  return () => {
      isClosed = true;
      if (ws) ws.close();
      if (pollingInterval) clearInterval(pollingInterval);
  };
};

export const runNetworkDiagnostics = async (): Promise<{
  proxyUsed: string;
  latency: number;
  serverTimeDiff: number;
  ok: boolean;
  error?: string;
  usingBackup?: boolean;
}> => {
  const start = Date.now();
  const userSetting = localStorage.getItem('sentient_custom_proxy');
  const primaryProxy = userSetting || DEFAULT_PROXY_URL;
  
  try {
      const data = await robustFetch(`${BINANCE_FUTURES_API}/time`);
      if (data && data.serverTime) {
          return {
              proxyUsed: primaryProxy,
              latency: Date.now() - start,
              serverTimeDiff: Math.abs(Date.now() - data.serverTime),
              ok: true,
              usingBackup: false
          };
      }
  } catch (e: any) {
       try {
          const start2 = Date.now();
          const data = await robustFetch(`${BYBIT_API}/time`);
          if (data && data.time) { 
               return {
                  proxyUsed: 'Backup (Bybit)',
                  latency: Date.now() - start2,
                  serverTimeDiff: 0,
                  ok: true,
                  usingBackup: true,
                  error: `Binance Unreachable (${e.message}). Using Bybit.`
              };
          }
      } catch (e2: any) {
          return {
              proxyUsed: primaryProxy,
              latency: 0,
              serverTimeDiff: 0,
              ok: false,
              error: "All Data Feeds Failed"
          };
      }
  }
   return {
      proxyUsed: primaryProxy,
      latency: 0,
      serverTimeDiff: 0,
      ok: false,
      error: "Unknown Error"
  };
};

export const testProxyConnection = async (proxyBaseUrl: string): Promise<boolean> => {
    try {
        const url = createProxyUrl(`${BINANCE_FUTURES_API}/time`, proxyBaseUrl);
        const res = await fetch(url);
        return res.ok;
    } catch {
        return false;
    }
};