
import React, { useState, useEffect } from 'react';
import { runNetworkDiagnostics } from '../services/binanceService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lastWsUpdate: number;
}

interface LogEntry {
    time: string;
    message: string;
    type: 'INFO' | 'ERROR' | 'SUCCESS' | 'WARN';
}

const DiagnosticsModal: React.FC<Props> = ({ isOpen, onClose, lastWsUpdate }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<Record<string, 'PENDING' | 'PASS' | 'FAIL' | 'WARN'>>({
      proxy: 'PENDING',
      api: 'PENDING',
      ws: 'PENDING',
      ai: 'PENDING'
  });
  const [metrics, setMetrics] = useState<any>({});

  const addLog = (message: string, type: 'INFO' | 'ERROR' | 'SUCCESS' | 'WARN' = 'INFO') => {
      const time = new Date().toLocaleTimeString();
      setLogs(prev => [...prev, { time, message, type }]);
  };

  const runTests = async () => {
      setIsRunning(true);
      setLogs([]);
      setResults({ proxy: 'PENDING', api: 'PENDING', ws: 'PENDING', ai: 'PENDING' });
      setMetrics({});

      addLog("Starting System Diagnostics...", 'INFO');

      // 1. Analysis Engine Check (Local)
      addLog("Checking Analysis Engine...", 'INFO');
      addLog("Local TA Engine enabled (no API key required).", 'SUCCESS');
      setResults(prev => ({ ...prev, ai: 'PASS' }));

      // 2. WebSocket Freshness
      addLog("Checking WebSocket Feed...", 'INFO');
      const wsDiff = Date.now() - lastWsUpdate;
      if (wsDiff < 5000) {
          addLog(`Feed is healthy. Last update: ${wsDiff}ms ago.`, 'SUCCESS');
          setResults(prev => ({ ...prev, ws: 'PASS' }));
          setMetrics(prev => ({ ...prev, wsLatency: wsDiff }));
      } else if (wsDiff < 15000) {
          addLog(`Feed is slow. Last update: ${wsDiff}ms ago.`, 'INFO');
          setResults(prev => ({ ...prev, ws: 'WARN' }));
      } else {
          addLog(`Feed STALLED. Last update: ${(wsDiff/1000).toFixed(1)}s ago.`, 'ERROR');
          setResults(prev => ({ ...prev, ws: 'FAIL' }));
      }

      // 3. Network / Proxy Check
      addLog("Testing Proxy & API Connection...", 'INFO');
      const netResult = await runNetworkDiagnostics();
      setMetrics(prev => ({ ...prev, ...netResult }));
      
      if (netResult.ok) {
          if (netResult.usingBackup) {
             addLog(`Primary Proxy Failed (${netResult.error}).`, 'WARN');
             addLog(`Rescued by Backup: ${netResult.latency}ms latency.`, 'SUCCESS');
             setResults(prev => ({ ...prev, proxy: 'WARN' }));
          } else {
             addLog(`Proxy Connected: ${netResult.latency}ms latency.`, 'SUCCESS');
             setResults(prev => ({ ...prev, proxy: 'PASS' }));
          }
          
          if (netResult.serverTimeDiff < 5000) {
             addLog(`Time Sync OK. Diff: ${netResult.serverTimeDiff}ms`, 'SUCCESS');
             setResults(prev => ({ ...prev, api: 'PASS' }));
          } else {
             addLog(`Time Sync Drift: ${netResult.serverTimeDiff}ms.`, 'INFO');
             setResults(prev => ({ ...prev, api: 'WARN' }));
          }
      } else {
          addLog(`Connection Failed: ${netResult.error}`, 'ERROR');
          setResults(prev => ({ ...prev, proxy: 'FAIL', api: 'FAIL' }));
      }

      addLog("Diagnostics Complete.", 'INFO');
      setIsRunning(false);
  };

  useEffect(() => {
      if (isOpen) runTests();
  }, [isOpen]);

  if (!isOpen) return null;

  const StatusIcon = ({ status }: { status: string }) => {
      if (status === 'PASS') return <span className="text-success font-bold">PASS</span>;
      if (status === 'FAIL') return <span className="text-danger font-bold">FAIL</span>;
      if (status === 'WARN') return <span className="text-yellow-500 font-bold">WARN</span>;
      return <span className="text-gray-500 animate-pulse">...</span>;
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="bg-surface border border-surfaceHighlight rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-surfaceHighlight flex justify-between items-center bg-surfaceHighlight/10">
          <div className="flex items-center gap-2">
             <div className="p-1.5 bg-primary/20 rounded">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
             </div>
             <h2 className="text-lg font-bold text-white">System Diagnostics</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Status Panel */}
            <div className="w-full md:w-1/2 p-6 border-b md:border-b-0 md:border-r border-surfaceHighlight space-y-6">
                <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-surfaceHighlight/20 rounded border border-white/5">
                        <span className="text-sm text-gray-300">Data Proxy</span>
                        <StatusIcon status={results.proxy} />
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surfaceHighlight/20 rounded border border-white/5">
                        <span className="text-sm text-gray-300">Binance API</span>
                        <StatusIcon status={results.api} />
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surfaceHighlight/20 rounded border border-white/5">
                        <span className="text-sm text-gray-300">WS Feed</span>
                        <StatusIcon status={results.ws} />
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surfaceHighlight/20 rounded border border-white/5">
                        <span className="text-sm text-gray-300">AI Engine</span>
                        <StatusIcon status={results.ai} />
                    </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                    <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Metrics</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <span className="block text-[10px] text-gray-500">Latency</span>
                            <span className="text-lg font-mono text-white">{metrics.latency ? `${metrics.latency}ms` : '--'}</span>
                        </div>
                        <div>
                            <span className="block text-[10px] text-gray-500">WS Age</span>
                            <span className="text-lg font-mono text-white">{metrics.wsLatency ? `${metrics.wsLatency}ms` : '--'}</span>
                        </div>
                    </div>
                    {metrics.error && (
                        <div className="mt-3 p-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger break-words">
                            {metrics.error}
                        </div>
                    )}
                </div>
            </div>

            {/* Logs Panel */}
            <div className="w-full md:w-1/2 p-4 bg-black/30 flex flex-col">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-xs font-bold text-gray-500 uppercase">Live Log</h3>
                    <button 
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(logs))}
                        className="text-[10px] text-primary hover:underline"
                    >
                        Copy Logs
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1 p-2 border border-white/5 rounded custom-scrollbar">
                    {logs.length === 0 && <span className="text-gray-600 italic">Ready to run...</span>}
                    {logs.map((log, i) => (
                        <div key={i} className={`
                            ${log.type === 'ERROR' ? 'text-red-400' : ''}
                            ${log.type === 'SUCCESS' ? 'text-green-400' : ''}
                            ${log.type === 'WARN' ? 'text-yellow-400' : ''}
                            ${log.type === 'INFO' ? 'text-gray-400' : ''}
                        `}>
                            <span className="opacity-50 mr-2">[{log.time}]</span>
                            {log.message}
                        </div>
                    ))}
                </div>
                <button 
                    onClick={runTests}
                    disabled={isRunning}
                    className={`mt-4 w-full py-2 rounded text-sm font-bold transition-all ${isRunning ? 'bg-gray-700 text-gray-400' : 'bg-primary hover:bg-blue-600 text-white'}`}
                >
                    {isRunning ? 'Running Checks...' : 'Run Full System Check'}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsModal;
