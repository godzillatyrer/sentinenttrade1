
import React, { useState, useEffect } from 'react';
import { testProxyConnection } from '../services/binanceService';
import { DEFAULT_PROXY_URL, DEFAULT_SENSITIVITY_MULTIPLIER } from '../constants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedTimeframes: string[];
  onToggleTimeframe: (tf: string) => void;
  volatilityThreshold: number; // This is now the Multiplier
  onUpdateThreshold: (val: number) => void;
}

const AVAILABLE_TIMEFRAMES = ['15m', '1h', '4h', '1d', '1w'];

const SettingsModal: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  selectedTimeframes, 
  onToggleTimeframe,
  volatilityThreshold,
  onUpdateThreshold
}) => {
  const [customProxy, setCustomProxy] = useState('');
  const [testStatus, setTestStatus] = useState<'IDLE' | 'TESTING' | 'SUCCESS' | 'FAIL'>('IDLE');
  const [showHelp, setShowHelp] = useState(false);
  const [localSensitivity, setLocalSensitivity] = useState(volatilityThreshold);

  useEffect(() => {
    const saved = localStorage.getItem('sentient_custom_proxy');
    if (saved) setCustomProxy(saved);
    setLocalSensitivity(volatilityThreshold);
  }, [isOpen, volatilityThreshold]);

  const handleSave = () => {
    if (customProxy.trim()) {
        localStorage.setItem('sentient_custom_proxy', customProxy.trim());
    } else {
        localStorage.removeItem('sentient_custom_proxy');
    }
    onUpdateThreshold(localSensitivity);
    onClose();
    // Force reload to apply proxy immediately next cycle
    if (customProxy !== (localStorage.getItem('sentient_custom_proxy') || '')) {
      window.location.reload();
    }
  };

  const runTest = async () => {
      setTestStatus('TESTING');
      const urlToUse = customProxy.trim() || DEFAULT_PROXY_URL;
      
      const success = await testProxyConnection(urlToUse);
      setTestStatus(success ? 'SUCCESS' : 'FAIL');
      setTimeout(() => setTestStatus('IDLE'), 3000);
  };

  const CLOUDFLARE_CODE = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response("Missing url", { status: 400 });
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const newRes = new Response(response.body, response);
    newRes.headers.set("Access-Control-Allow-Origin", "*");
    return newRes;
  }
}`;

  const handleCopyCode = () => {
      navigator.clipboard.writeText(CLOUDFLARE_CODE);
      alert("Worker Code copied to clipboard!");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-surfaceHighlight rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-surfaceHighlight flex justify-between items-center bg-surfaceHighlight/10">
          <h2 className="text-lg font-bold text-white">Scanner Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
           {/* Timeframes Section */}
           <div>
               <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wide">Analysis Timeframes</h3>
               <div className="flex flex-wrap gap-3">
                 {AVAILABLE_TIMEFRAMES.map(tf => {
                   const isSelected = selectedTimeframes.includes(tf);
                   return (
                     <button
                       key={tf}
                       onClick={() => onToggleTimeframe(tf)}
                       className={`
                         px-4 py-2 rounded-lg text-sm font-bold border transition-all
                         ${isSelected 
                           ? 'bg-primary/20 border-primary text-primary shadow-[0_0_10px_rgba(59,130,246,0.3)]' 
                           : 'bg-surfaceHighlight/50 border-white/5 text-gray-400 hover:border-white/20 hover:text-white'}
                       `}
                     >
                       {tf}
                     </button>
                   )
                 })}
               </div>
           </div>

           {/* Volatility Threshold */}
           <div>
              <h3 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wide">Volatility Alert Sensitivity</h3>
              <div className="p-4 bg-surfaceHighlight/10 rounded border border-white/5">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-white">Alert Multiplier:</span>
                    <span className="text-sm font-bold text-primary">{localSensitivity.toFixed(1)}x</span>
                 </div>
                 <input 
                   type="range" 
                   min="0.5" 
                   max="2.0" 
                   step="0.1"
                   value={localSensitivity}
                   onChange={(e) => setLocalSensitivity(parseFloat(e.target.value))}
                   className="w-full accent-primary h-2 bg-surfaceHighlight rounded-lg appearance-none cursor-pointer"
                 />
                 
                 <div className="mt-3 bg-black/30 rounded p-2 text-[10px] space-y-1">
                    <p className="font-bold text-gray-400 mb-1">Effective 10-Min Thresholds at {localSensitivity}x:</p>
                    <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Mega Cap (&gt;7B)</span>
                        <span className="font-mono text-white">{(15.0 * localSensitivity).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Large Cap (1B-7B)</span>
                        <span className="font-mono text-white">{(20.0 * localSensitivity).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-1">
                        <span>Mid Cap (500M-1B)</span>
                        <span className="font-mono text-white">{(25.0 * localSensitivity).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Small Cap (&lt;500M)</span>
                        <span className="font-mono text-white">{(40.0 * localSensitivity).toFixed(1)}%</span>
                    </div>
                 </div>
              </div>
           </div>

           {/* Proxy Section */}
           <div className="p-4 bg-surfaceHighlight/10 rounded border border-white/5">
               <div className="flex justify-between items-start mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-white mb-1">
                            Premium / Custom Data Feed
                        </h3>
                        <p className="text-[10px] text-gray-400">
                            Willing to pay for reliability? Purchase a high-speed CORS proxy (e.g. CorsProxy.io Premium, WebShare) or deploy your own Cloudflare Worker.
                        </p>
                    </div>
               </div>
               
               <div className="flex gap-2 mt-4">
                   <div className="flex-1 relative">
                     <input 
                       type="text" 
                       placeholder="e.g. https://my-private-proxy.com/?url="
                       value={customProxy}
                       onChange={(e) => setCustomProxy(e.target.value)}
                       className="w-full bg-black/30 border border-surfaceHighlight rounded p-2 text-xs text-white placeholder-gray-600 focus:border-primary outline-none font-mono"
                     />
                     {!customProxy && (
                       <span className="absolute right-2 top-2 text-[10px] text-gray-500 font-bold px-1.5 py-0.5 rounded bg-white/5 pointer-events-none">
                         Default (Free)
                       </span>
                     )}
                   </div>
                   <button 
                     onClick={runTest}
                     disabled={testStatus === 'TESTING'}
                     className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${
                         testStatus === 'SUCCESS' ? 'bg-success/20 border-success text-success' :
                         testStatus === 'FAIL' ? 'bg-danger/20 border-danger text-danger' :
                         'bg-surfaceHighlight border-white/10 text-gray-300 hover:text-white'
                     }`}
                   >
                       {testStatus === 'TESTING' ? 'Testing...' : 
                        testStatus === 'SUCCESS' ? 'Working' : 
                        testStatus === 'FAIL' ? 'Failed' : 'Test URL'}
                   </button>
               </div>

               <div className="mt-4 pt-3 border-t border-white/5">
                   <button onClick={() => setShowHelp(!showHelp)} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                       <span>{showHelp ? "▼ Hide Free DIY Guide" : "▶ Free Option: Create Your Own Worker"}</span>
                   </button>
               </div>

               {showHelp && (
                   <div className="mt-2 text-xs text-gray-300 space-y-2">
                       <ol className="list-decimal list-inside space-y-1 text-gray-400 ml-1">
                           <li>Go to <a href="https://workers.cloudflare.com" target="_blank" className="text-blue-400 underline">workers.cloudflare.com</a> (Free Tier is enough)</li>
                           <li>Create a new Worker, click "Edit Code".</li>
                           <li>Paste the code below & Deploy.</li>
                           <li>Paste your new Worker URL above.</li>
                       </ol>
                       <div className="relative mt-2">
                           <pre className="bg-black/50 p-2 rounded text-[10px] text-gray-500 font-mono overflow-x-auto border border-white/5">
                               {CLOUDFLARE_CODE}
                           </pre>
                           <button onClick={handleCopyCode} className="absolute top-2 right-2 bg-surfaceHighlight hover:bg-white/10 text-white px-2 py-1 rounded text-[10px]">Copy</button>
                       </div>
                   </div>
               )}
           </div>
           
           {!customProxy && (
               <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded text-blue-400 text-xs flex items-center gap-2">
                 <span className="font-bold">Info:</span> App is currently using free public proxies + Multi-Exchange backup (Bybit).
               </div>
           )}
        </div>

        <div className="p-4 border-t border-surfaceHighlight bg-surfaceHighlight/20 flex justify-end">
           <button 
             onClick={handleSave}
             className="px-6 py-2 bg-white text-black font-bold text-sm rounded hover:bg-gray-200 transition"
           >
             Save Settings
           </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
