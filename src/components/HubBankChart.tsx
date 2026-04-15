import React, { useMemo, useState, useCallback, useRef } from 'react';
import { HubSlot, FlightInfo, Region } from '../types';
import { REGION_COLORS, BLR_CATCHMENT } from '../constants';

interface HubBankChartProps {
  data: HubSlot[];
  mct: number;
  maxConnectionWindow: number;
  onManualDrop: (slotIdx: number, type: 'arrival' | 'departure', flight: FlightInfo) => void;
  onUpdateManual: (id: string, updates: Partial<FlightInfo>) => void;
  onDeleteManual: (id: string) => void;
  freqMode: 'weekly' | 'daily';
  setFreqMode: (mode: 'weekly' | 'daily') => void;
}

const HubBankChart: React.FC<HubBankChartProps> = ({
  data, mct, maxConnectionWindow, onManualDrop, onUpdateManual, onDeleteManual, freqMode, setFreqMode
}) => {
  const [hoveredFlight, setHoveredFlight] = useState<FlightInfo | null>(null);
  const [pinnedFlight, setPinnedFlight] = useState<FlightInfo | null>(null);
  const [selectedFlights, setSelectedFlights] = useState<FlightInfo[]>([]);
  const [pendingDrop, setPendingDrop] = useState<{ slotIdx: number, type: 'arrival' | 'departure', flight: FlightInfo } | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chartScale, setChartScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const consolidatedData = useMemo(() => {
    return data.map(slot => {
      const merge = (list: FlightInfo[]) => {
        const map = new Map<string, FlightInfo>();
        list.forEach(f => {
          const key = f.isManual ? f.id! : `${f.code}-${f.airline}-${f.originalHubTime}`;
          if (map.has(key)) { map.get(key)!.freq += f.freq; }
          else { map.set(key, { ...f }); }
        });
        return Array.from(map.values());
      };
      return { ...slot, arrivals: merge(slot.arrivals), departures: merge(slot.departures) };
    });
  }, [data]);

  const getTwoWaySummary = useCallback((focal: FlightInfo) => {
    const focalTime = focal.exactTime || focal.originalHubTime || "00:00";
    const [fh, fm] = focalTime.split(':').map(Number);
    const focalMins = fh * 60 + fm;
    const outbound: FlightInfo[] = [];
    const inbound: FlightInfo[] = [];
    consolidatedData.forEach(slot => {
      slot.departures.forEach(dep => {
        const [dh, dm] = (dep.exactTime || dep.originalHubTime || "00:00").split(':').map(Number);
        const diff = ((dh * 60 + dm) - focalMins + 1440) % 1440;
        if (diff >= mct * 60 && diff <= maxConnectionWindow * 60) outbound.push(dep);
      });
      slot.arrivals.forEach(arr => {
        const [ah, am] = (arr.exactTime || arr.originalHubTime || "00:00").split(':').map(Number);
        const diff = (focalMins - (ah * 60 + am) + 1440) % 1440;
        if (diff >= mct * 60 && diff <= maxConnectionWindow * 60) inbound.push(arr);
      });
    });
    const totalFreq = [...outbound, ...inbound].reduce((acc, f) => acc + f.freq, 0);
    return { outbound, inbound, synergy: (totalFreq / 100).toFixed(2) };
  }, [consolidatedData, mct, maxConnectionWindow]);

  const getSummary = (focal: FlightInfo) => {
    const { outbound, inbound, synergy } = getTwoWaySummary(focal);
    const ports = new Set([...outbound, ...inbound].map(f => f.code));
    return { networkBreadth: ports.size, efficiencyIndex: synergy, topConnecting: Array.from(ports).slice(0, 5).join(', ') };
  };

  const getCellClasses = (f: FlightInfo) => {
    const isHovered = hoveredFlight?.id === f.id || (hoveredFlight?.code === f.code && hoveredFlight?.originalHubTime === f.originalHubTime);
    const isPinned = pinnedFlight?.id === f.id || (pinnedFlight?.code === f.code && pinnedFlight?.originalHubTime === f.originalHubTime);
    const isSelected = selectedFlights.some(sf => sf.id === f.id);
    const base = "relative h-8 px-2 rounded-md flex items-center justify-between text-[10px] font-black transition-all cursor-grab active:cursor-grabbing select-none";
    const manualBorder = f.isManual ? "border-2 border-indigo-400" : "border border-transparent";
    const catchment = BLR_CATCHMENT.has(f.code) ? "after:content-[''] after:absolute after:-top-1 after:-right-1 after:w-2 after:h-2 after:bg-amber-400 after:rounded-full after:border-2 after:border-white" : "";
    const regionColor = REGION_COLORS[f.region] || REGION_COLORS[Region.Unknown];
    const hoverEffect = isHovered ? "scale-105 z-10 shadow-xl ring-2 ring-white" : "";
    const pinEffect = isPinned ? "ring-2 ring-indigo-600 ring-offset-2 z-20" : "";
    const selectEffect = isSelected ? "ring-4 ring-indigo-500/30 z-10" : "";
    return `${base} ${regionColor} ${manualBorder} ${catchment} ${hoverEffect} ${pinEffect} ${selectEffect}`;
  };

  const handleFlightClick = (e: React.MouseEvent, f: FlightInfo) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedFlights(prev => prev.some(sf => sf.id === f.id) ? prev.filter(sf => sf.id !== f.id) : [...prev, f]);
    } else {
      setPinnedFlight(pinnedFlight?.id === f.id ? null : f);
    }
  };

  const handleFlightDoubleClick = (f: FlightInfo) => {
    if (!f.isManual) return;
    const newTime = prompt("Enter new time (HH:mm):", f.exactTime || f.originalHubTime);
    if (newTime && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newTime)) onUpdateManual(f.id!, { exactTime: newTime });
    const newCode = prompt("Enter new airport code:", f.code);
    if (newCode && newCode.length === 3) onUpdateManual(f.id!, { code: newCode.toUpperCase() });
  };

  const handleDragStart = (e: React.DragEvent, f: FlightInfo) => {
    e.dataTransfer.setData('flight', JSON.stringify(f));
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const handleDrop = (e: React.DragEvent, slotIdx: number, type: 'arrival' | 'departure') => {
    e.preventDefault();
    setIsDragging(false);
    const flightData = e.dataTransfer.getData('flight');
    if (!flightData) return;
    setPendingDrop({ slotIdx, type, flight: JSON.parse(flightData) as FlightInfo });
  };

  const confirmDrop = () => {
    if (pendingDrop) { onManualDrop(pendingDrop.slotIdx, pendingDrop.type, pendingDrop.flight); setPendingDrop(null); }
  };

  const generateAIComparison = async () => {
    if (selectedFlights.length < 2) return;
    setIsAiLoading(true);
    setAiInsight(null);
    try {
      const flightData = selectedFlights.map(f => {
        const s = getSummary(f);
        return `${f.code} (${f.airline}): Breadth ${s.networkBreadth}, Efficiency ${s.efficiencyIndex}`;
      }).join('\n');
      // AI analysis placeholder - connect your API key via environment variable
      await new Promise(r => setTimeout(r, 1500));
      setAiInsight(`Strategic Analysis for selected flights:\n\n${flightData}\n\nMCT: ${mct}h | Window: ${maxConnectionWindow}h\n\nNote: Connect a Gemini API key via VITE_GEMINI_API_KEY environment variable in Netlify to enable live AI analysis.`);
    } catch {
      setAiInsight("Unable to generate AI analysis. Please check your API key configuration.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const fitToScreen = () => {
    if (!chartRef.current) return;
    const containerWidth = chartRef.current.parentElement?.clientWidth || 0;
    setChartScale(Math.min(1, (containerWidth - 48) / chartRef.current.scrollWidth));
  };

  const focalFlight = hoveredFlight || pinnedFlight;

  return (
    <div className="h-full flex flex-col gap-4 relative">
      {/* Controls */}
      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200">
            <button onClick={() => setFreqMode('weekly')} className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all ${freqMode === 'weekly' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>WEEKLY</button>
            <button onClick={() => setFreqMode('daily')} className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all ${freqMode === 'daily' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>DAILY</button>
          </div>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-1">
            <button onClick={() => setChartScale(s => Math.max(0.4, s - 0.1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 text-xs">−</button>
            <span className="text-[10px] font-black text-slate-400 w-10 text-center">{Math.round(chartScale * 100)}%</span>
            <button onClick={() => setChartScale(s => Math.min(1.5, s + 0.1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 text-xs">+</button>
            <button onClick={fitToScreen} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-black text-slate-600">FIT</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {selectedFlights.length >= 2 && (
            <button onClick={() => { setIsCompareModalOpen(true); generateAIComparison(); }}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700">
              <i className="fas fa-wand-magic-sparkles text-xs" /> ANALYZE {selectedFlights.length} FLIGHTS
            </button>
          )}
          <div
            onDragOver={handleDragOver}
            onDrop={(e) => { const f = JSON.parse(e.dataTransfer.getData('flight') || '{}'); if (f.isManual && f.id) onDeleteManual(f.id); }}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${isDragging ? 'bg-rose-100 text-rose-600 border-2 border-dashed border-rose-300 scale-110' : 'bg-slate-100 text-slate-400'}`}
          >
            <i className="fas fa-trash-alt text-xs" />
          </div>
        </div>
      </div>

      {/* Region Legend */}
      <div className="flex items-center gap-2 px-1 shrink-0 flex-wrap">
        {[
          { label: 'Asia/Pacific', cls: 'bg-[#214a7c] text-white' },
          { label: 'Europe', cls: 'bg-[#e7d5b1] text-slate-800' },
          { label: 'Middle East', cls: 'bg-[#bdbdbd] text-slate-800' },
          { label: 'Americas', cls: 'bg-[#4a90e2] text-white' },
          { label: 'Africa', cls: 'bg-[#001529] text-white' },
        ].map(r => (
          <span key={r.label} className={`px-2 py-0.5 rounded text-[9px] font-black ${r.cls}`}>{r.label}</span>
        ))}
        <span className="text-[9px] text-slate-400 font-bold ml-2">● = Catchment overlap</span>
        <span className="text-[9px] text-slate-400 font-bold">Border = Manual block</span>
        <span className="text-[9px] text-slate-400 font-bold">Ctrl+click = Multi-select for AI analysis</span>
      </div>

      {/* Chart */}
      <div className="flex-1 overflow-auto bg-white rounded-3xl border border-slate-200 shadow-inner p-6 custom-scrollbar">
        <div ref={chartRef} className="min-w-max transition-transform duration-200 origin-top-left" style={{ transform: `scale(${chartScale})` }}>
          <div className="grid gap-x-8" style={{ gridTemplateColumns: '80px 1fr 80px 1fr' }}>
            <div className="col-start-2 text-center mb-6">
              <span className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black tracking-widest border border-indigo-100">
                ✈ INBOUND ARRIVALS
              </span>
            </div>
            <div className="col-start-4 text-center mb-6">
              <span className="px-4 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black tracking-widest border border-emerald-100">
                ✈ OUTBOUND DEPARTURES
              </span>
            </div>

            {consolidatedData.map((slot, idx) => (
              <React.Fragment key={idx}>
                <div className="flex items-start justify-end pr-3 pt-3 border-r-2 border-slate-100">
                  <span className="text-[11px] font-black text-slate-400 tabular-nums">{slot.label}</span>
                </div>
                <div
                  className={`min-h-[100px] p-3 rounded-2xl flex flex-wrap gap-1.5 content-start transition-all ${isDragging ? 'bg-indigo-50/50 ring-2 ring-dashed ring-indigo-200' : 'bg-slate-50/30'}`}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, idx, 'arrival')}
                >
                  {slot.arrivals.map((f, fi) => (
                    <div key={fi} draggable onDragStart={e => handleDragStart(e, f)}
                      onMouseEnter={() => setHoveredFlight(f)} onMouseLeave={() => setHoveredFlight(null)}
                      onClick={e => handleFlightClick(e, f)} onDoubleClick={() => handleFlightDoubleClick(f)}
                      className={getCellClasses(f)} title={`${f.airline || ''} ${f.code} — ${f.freq} freq`}
                      style={{ minWidth: '60px' }}>
                      <span className="truncate">{f.code}</span>
                      <span className="opacity-60 text-[8px] ml-1">{freqMode === 'weekly' ? f.freq : (f.freq / 7).toFixed(1)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-start justify-end pr-3 pt-3 border-r-2 border-slate-100">
                  <span className="text-[11px] font-black text-slate-400 tabular-nums">{slot.label}</span>
                </div>
                <div
                  className={`min-h-[100px] p-3 rounded-2xl flex flex-wrap gap-1.5 content-start transition-all ${isDragging ? 'bg-emerald-50/50 ring-2 ring-dashed ring-emerald-200' : 'bg-slate-50/30'}`}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, idx, 'departure')}
                >
                  {slot.departures.map((f, fi) => (
                    <div key={fi} draggable onDragStart={e => handleDragStart(e, f)}
                      onMouseEnter={() => setHoveredFlight(f)} onMouseLeave={() => setHoveredFlight(null)}
                      onClick={e => handleFlightClick(e, f)} onDoubleClick={() => handleFlightDoubleClick(f)}
                      className={getCellClasses(f)} title={`${f.airline || ''} ${f.code} — ${f.freq} freq`}
                      style={{ minWidth: '60px' }}>
                      <span className="truncate">{f.code}</span>
                      <span className="opacity-60 text-[8px] ml-1">{freqMode === 'weekly' ? f.freq : (f.freq / 7).toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                <div className="col-span-4 h-px bg-slate-100 my-1" />
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Floating Intel Card */}
      {focalFlight && (
        <div className="fixed bottom-6 right-6 w-72 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-50">
          {pinnedFlight && (
            <button onClick={() => setPinnedFlight(null)} className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 text-xs">✕</button>
          )}
          <div className={`h-20 p-5 flex flex-col justify-end ${REGION_COLORS[focalFlight.region]}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-black tracking-tighter">{focalFlight.code}</h3>
              <span className="text-[10px] font-black uppercase opacity-80">{focalFlight.airline}</span>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Weekly Freq</p>
                <p className="text-lg font-black text-slate-800">{focalFlight.freq}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Hub Time</p>
                <p className="text-lg font-black text-slate-800">{focalFlight.exactTime || focalFlight.originalHubTime}</p>
              </div>
            </div>
            <div className="space-y-2">
              {(() => {
                const s = getSummary(focalFlight);
                return (
                  <>
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-500">Network Breadth</span>
                      <span className="text-slate-800">{s.networkBreadth} Ports</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-500">Efficiency Index</span>
                      <span className="text-indigo-600">{s.efficiencyIndex}</span>
                    </div>
                    {s.topConnecting && (
                      <div className="pt-1">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Top Connections</p>
                        <p className="text-[10px] font-bold text-slate-600">{s.topConnecting}</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Drop Modal */}
      {pendingDrop && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <i className="fas fa-arrows-alt text-indigo-500 text-2xl" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">Confirm Move</h3>
              <p className="text-slate-500">Move <span className="text-indigo-600 font-black">{pendingDrop.flight.code}</span> to slot <span className="font-black">{pendingDrop.slotIdx}:00</span>?</p>
            </div>
            <div className="flex border-t border-slate-100">
              <button onClick={() => setPendingDrop(null)} className="flex-1 px-4 py-4 text-sm font-black text-slate-500 hover:bg-slate-50">CANCEL</button>
              <button onClick={confirmDrop} className="flex-1 px-4 py-4 text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700">CONFIRM</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Modal */}
      {isCompareModalOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[100] p-6">
          <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[80vh] shadow-2xl overflow-hidden flex flex-col">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <i className="fas fa-brain text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">Strategic Analysis</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI-Powered Network Insights</p>
                </div>
              </div>
              <button onClick={() => setIsCompareModalOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                {selectedFlights.map((f, i) => {
                  const s = getSummary(f);
                  return (
                    <div key={i} className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-2xl font-black text-slate-900">{f.code}</span>
                        <span className="text-[10px] font-black text-slate-400">{f.airline}</span>
                      </div>
                      <div className="space-y-2 text-sm font-bold">
                        <div className="flex justify-between"><span className="text-slate-400">Breadth</span><span>{s.networkBreadth} ports</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Efficiency</span><span className="text-indigo-600">{s.efficiencyIndex}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Freq</span><span>{f.freq}/wk</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-indigo-50/50 rounded-2xl p-6 border border-indigo-100">
                {isAiLoading ? (
                  <div className="py-8 flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    <p className="text-xs font-black text-indigo-400 uppercase">Synthesizing...</p>
                  </div>
                ) : aiInsight ? (
                  <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">{aiInsight}</p>
                ) : (
                  <p className="text-center text-slate-400 font-bold italic py-6">Select 2+ flights to generate strategic insights.</p>
                )}
              </div>
            </div>
            <div className="p-5 bg-slate-50 border-t border-slate-100 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MCT: {mct}h | Window: {maxConnectionWindow}h</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HubBankChart;
