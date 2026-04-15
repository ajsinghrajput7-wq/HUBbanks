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

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOT_W = 80;
const CELL_H = 30;

function toMins(t: string): number {
  if (!t?.includes(':')) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const HubBankChart: React.FC<HubBankChartProps> = ({
  data, mct, maxConnectionWindow, onManualDrop, onUpdateManual, onDeleteManual, freqMode, setFreqMode
}) => {
  const [hoveredFlight, setHoveredFlight] = useState<FlightInfo | null>(null);
  const [pinnedFlight, setPinnedFlight] = useState<FlightInfo | null>(null);
  const [selectedFlights, setSelectedFlights] = useState<FlightInfo[]>([]);
  const [pendingDrop, setPendingDrop] = useState<{ slotIdx: number; type: 'arrival' | 'departure'; flight: FlightInfo } | null>(null);
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chartScale, setChartScale] = useState(0.53);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<{ idx: number; type: 'arrival' | 'departure' } | null>(null);

  const chartRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const focalMins = toMins(focal.exactTime || focal.originalHubTime || '00:00');
    const mctMins = mct * 60;
    const windowMins = maxConnectionWindow * 60;
    const outbound: FlightInfo[] = [];
    const inbound: FlightInfo[] = [];

    consolidatedData.forEach(slot => {
      slot.departures.forEach(dep => {
        const diff = (toMins(dep.exactTime || dep.originalHubTime || '00:00') - focalMins + 1440) % 1440;
        if (diff >= mctMins && diff <= windowMins) outbound.push(dep);
      });
      slot.arrivals.forEach(arr => {
        const diff = (focalMins - toMins(arr.exactTime || arr.originalHubTime || '00:00') + 1440) % 1440;
        if (diff >= mctMins && diff <= windowMins) inbound.push(arr);
      });
    });

    return {
      outbound,
      inbound,
      networkBreadth: new Set([...outbound, ...inbound].map(f => f.code)).size,
      synergy: (([...outbound, ...inbound].reduce((s, f) => s + f.freq, 0)) / 100).toFixed(2),
    };
  }, [consolidatedData, mct, maxConnectionWindow]);

  const connectedIds = useMemo(() => {
    const focal = pinnedFlight || hoveredFlight;
    if (!focal) return new Set<string>();
    const { outbound, inbound } = getTwoWaySummary(focal);
    return new Set([...outbound, ...inbound].map(f => f.id || `${f.code}-${f.airline}-${f.originalHubTime}`));
  }, [pinnedFlight, hoveredFlight, getTwoWaySummary]);

  const hasFocal = !!(pinnedFlight || hoveredFlight);
  const focalFlight = hoveredFlight || pinnedFlight;

  const getCellClasses = (f: FlightInfo) => {
    const id = f.id || `${f.code}-${f.airline}-${f.originalHubTime}`;
    const isPinned = !!pinnedFlight && (pinnedFlight.id === f.id || (pinnedFlight.code === f.code && pinnedFlight.originalHubTime === f.originalHubTime));
    const isHov = !!hoveredFlight && (hoveredFlight.id === f.id || (hoveredFlight.code === f.code && hoveredFlight.originalHubTime === f.originalHubTime));
    const isSelected = selectedFlights.some(sf => sf.id === f.id);
    const isConnected = connectedIds.has(id);

    const base = 'relative flex items-center justify-between px-1.5 rounded text-[9px] font-black cursor-grab active:cursor-grabbing select-none transition-all duration-100';
    const regionCls = REGION_COLORS[f.region] || REGION_COLORS[Region.Unknown];
    const catchDot = BLR_CATCHMENT.has(f.code) ? "after:content-[''] after:absolute after:-top-0.5 after:-right-0.5 after:w-1.5 after:h-1.5 after:bg-amber-400 after:rounded-full after:border after:border-white" : '';
    const manualBorder = f.isManual ? 'border-2 border-indigo-400' : 'border border-transparent';
    const pinCls = isPinned ? 'ring-2 ring-white ring-offset-1 z-20 scale-105 shadow-lg' : '';
    const hovCls = isHov && !isPinned ? 'scale-105 shadow z-10' : '';
    const selCls = isSelected ? 'ring-2 ring-yellow-300 ring-offset-1' : '';
    const connCls = isConnected ? 'ring-2 ring-[#00ff9d] ring-offset-1 z-10' : '';
    const dimCls = hasFocal && !isConnected && !isPinned && !isHov ? 'opacity-25' : '';

    return `${base} ${regionCls} ${catchDot} ${manualBorder} ${pinCls} ${hovCls} ${selCls} ${connCls} ${dimCls}`;
  };

  const handleFlightClick = (e: React.MouseEvent, f: FlightInfo) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      setSelectedFlights(prev => prev.some(sf => sf.id === f.id) ? prev.filter(sf => sf.id !== f.id) : [...prev, f]);
    } else {
      const alreadyPinned = pinnedFlight?.id === f.id;
      setPinnedFlight(alreadyPinned ? null : f);
      if (!alreadyPinned) { setIsAnalyzerOpen(true); setAiInsight(null); }
      else setIsAnalyzerOpen(false);
    }
  };

  const handleFlightDoubleClick = (f: FlightInfo) => {
    if (!f.isManual) return;
    const t = prompt('New hub time (HH:mm):', f.exactTime || f.originalHubTime);
    if (t && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) onUpdateManual(f.id!, { exactTime: t });
    const c = prompt('New airport code (3 letters):', f.code);
    if (c && c.length >= 3) onUpdateManual(f.id!, { code: c.toUpperCase().slice(0, 3) });
  };

  const handleDragStart = (e: React.DragEvent, f: FlightInfo) => {
    e.dataTransfer.setData('flight', JSON.stringify(f));
    setIsDragging(true);
  };

  const handleDrop = (e: React.DragEvent, slotIdx: number, type: 'arrival' | 'departure') => {
    e.preventDefault();
    setIsDragging(false);
    setDragOverSlot(null);
    const raw = e.dataTransfer.getData('flight');
    if (!raw) return;
    setPendingDrop({ slotIdx, type, flight: JSON.parse(raw) as FlightInfo });
  };

  const confirmDrop = () => {
    if (pendingDrop) { onManualDrop(pendingDrop.slotIdx, pendingDrop.type, pendingDrop.flight); setPendingDrop(null); }
  };

  const generateAI = async () => {
    const focal = pinnedFlight || (selectedFlights.length >= 2 ? null : selectedFlights[0]);
    setIsAiLoading(true);
    setAiInsight(null);
    try {
      let prompt = '';
      if (pinnedFlight) {
        const s = getTwoWaySummary(pinnedFlight);
        const topOut = s.outbound.slice(0, 10).map(f => `${f.code}(${f.freq})`).join(', ');
        const topIn = s.inbound.slice(0, 10).map(f => `${f.code}(${f.freq})`).join(', ');
        prompt = `You are a senior aviation network strategist. Analyze hub connectivity for ${pinnedFlight.code} (${pinnedFlight.airline || 'airline'}) at BLR, hub time ${pinnedFlight.exactTime || pinnedFlight.originalHubTime}.\n\nMCT: ${mct}h | Window: ${maxConnectionWindow}h\nOutbound connections: ${topOut || 'none'}\nInbound feeders: ${topIn || 'none'}\nNetwork breadth: ${s.networkBreadth} ports\n\nProvide a concise 3-point strategic assessment covering: connection quality, network gaps, and optimization opportunities.`;
      } else {
        const summaries = selectedFlights.map(f => {
          const s = getTwoWaySummary(f);
          return `${f.code} (${f.airline}): breadth=${s.networkBreadth}, outbound=${s.outbound.length}, inbound=${s.inbound.length}`;
        }).join('\n');
        prompt = `Compare these BLR hub connections:\n${summaries}\nMCT: ${mct}h | Window: ${maxConnectionWindow}h\n\nProvide a concise strategic comparison: which has best connectivity, gaps, and recommendations.`;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
      });
      const result = await response.json();
      setAiInsight(result.content?.map((c: any) => c.text || '').join('') || 'No response.');
    } catch {
      setAiInsight('Unable to generate analysis. Check network connection.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const fitToScreen = () => {
    if (!chartRef.current || !containerRef.current) return;
    setChartScale(Math.min(1, (containerRef.current.clientWidth - 32) / chartRef.current.scrollWidth));
  };

  const maxArrH = useMemo(() => Math.max(4, ...consolidatedData.map(s => s.arrivals.length)), [consolidatedData]);
  const maxDepH = useMemo(() => Math.max(4, ...consolidatedData.map(s => s.departures.length)), [consolidatedData]);

  return (
    <div className="h-full flex flex-col gap-2 relative" onClick={() => { if (!isAnalyzerOpen) { setPinnedFlight(null); } }}>

      {/* ── Controls bar ── */}
      <div className="flex items-center justify-between bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm shrink-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">BANK SCHEDULE</span>
          <div className="h-3 w-px bg-slate-200" />
          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-black">ZOOM: {Math.round(chartScale * 100)}%</span>
          <button onClick={() => setChartScale(s => Math.max(0.25, parseFloat((s - 0.05).toFixed(2))))}
            className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black leading-none">−</button>
          <button onClick={() => setChartScale(s => Math.min(1.5, parseFloat((s + 0.05).toFixed(2))))}
            className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black leading-none">+</button>
          <span className="px-2 py-0.5 bg-[#006a4e] text-white rounded text-[9px] font-black">MODE: {freqMode === 'weekly' ? 'WEEKLY FREQ' : 'DAILY DEP'}</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedFlights.length >= 2 && (
            <button onClick={e => { e.stopPropagation(); setIsAnalyzerOpen(true); setAiInsight(null); generateAI(); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[9px] font-black hover:bg-indigo-700">
              ✦ ANALYZE {selectedFlights.length} FLIGHTS
            </button>
          )}
          <div onDragOver={e => e.preventDefault()}
            onDrop={e => { const raw = e.dataTransfer.getData('flight'); if (raw) { const f = JSON.parse(raw); if (f.isManual && f.id) onDeleteManual(f.id); } }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all ${isDragging ? 'bg-rose-100 text-rose-500 border-2 border-dashed border-rose-300 scale-110' : 'bg-slate-100 text-slate-400'}`}>
            🗑
          </div>
          <button onClick={fitToScreen}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[9px] font-black hover:bg-slate-700">
            ✦ RESET ZOOM
          </button>
        </div>
      </div>

      {/* ── Main horizontal chart ── */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-200 shadow-inner" style={{ scrollbarWidth: 'thin' }}>
        <div ref={chartRef} className="inline-flex flex-col origin-top-left transition-transform duration-150 p-3"
          style={{ transform: `scale(${chartScale})`, transformOrigin: 'top left', minWidth: `${24 * SLOT_W + 40}px` }}
          onClick={e => e.stopPropagation()}>

          {/* ARRIVALS — stacked upward from timeline */}
          <div className="flex items-end" style={{ marginBottom: 0 }}>
            <div className="shrink-0 flex items-center justify-end pr-1" style={{ width: 40 }}>
              <span className="text-[7px] font-black text-indigo-400 uppercase tracking-widest"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>ARR</span>
            </div>
            {HOURS.map(hr => {
              const flights = consolidatedData[hr]?.arrivals || [];
              const isOver = dragOverSlot?.idx === hr && dragOverSlot?.type === 'arrival';
              return (
                <div key={hr}
                  style={{ width: SLOT_W, minHeight: maxArrH * CELL_H }}
                  className={`flex flex-col-reverse justify-start items-stretch gap-0.5 px-0.5 pb-0.5 border-r border-slate-100 transition-colors ${isOver ? 'bg-indigo-50/80 ring-1 ring-indigo-200 ring-inset' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOverSlot({ idx: hr, type: 'arrival' }); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSlot(null); }}
                  onDrop={e => handleDrop(e, hr, 'arrival')}>
                  {flights.map((f, fi) => (
                    <div key={`${f.id || fi}`}
                      draggable
                      onDragStart={e => handleDragStart(e, f)}
                      onDragEnd={() => { setIsDragging(false); setDragOverSlot(null); }}
                      onMouseEnter={() => setHoveredFlight(f)}
                      onMouseLeave={() => setHoveredFlight(null)}
                      onClick={e => handleFlightClick(e, f)}
                      onDoubleClick={() => handleFlightDoubleClick(f)}
                      className={getCellClasses(f)}
                      style={{ height: CELL_H - 2 }}
                      title={`${f.airline || ''} ${f.code} · ${f.freq} ${freqMode === 'weekly' ? 'wkly' : 'daily'}`}>
                      <span className="truncate font-black text-[9px] leading-none">{f.code}</span>
                      <span className="opacity-55 text-[7px] ml-0.5 shrink-0 leading-none">
                        {freqMode === 'weekly' ? f.freq : (f.freq / 7).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* TIMELINE AXIS */}
          <div className="flex items-stretch shrink-0" style={{ height: 26 }}>
            <div className="shrink-0 flex items-center justify-center bg-slate-900 border-r border-slate-700" style={{ width: 40 }}>
              <span className="text-[7px] font-black text-slate-400 uppercase">UTC</span>
            </div>
            {HOURS.map(hr => (
              <div key={hr} style={{ width: SLOT_W }}
                className="flex items-center justify-center border-r border-slate-700 bg-slate-900 shrink-0">
                <span className="text-[11px] font-black text-white tabular-nums leading-none">
                  {String(hr).padStart(2, '0')}
                </span>
              </div>
            ))}
          </div>

          {/* DEPARTURES — stacked downward from timeline */}
          <div className="flex items-start" style={{ marginTop: 0 }}>
            <div className="shrink-0 flex items-center justify-end pr-1 pt-1" style={{ width: 40 }}>
              <span className="text-[7px] font-black text-emerald-500 uppercase tracking-widest"
                style={{ writingMode: 'vertical-rl' }}>DEP</span>
            </div>
            {HOURS.map(hr => {
              const flights = consolidatedData[hr]?.departures || [];
              const isOver = dragOverSlot?.idx === hr && dragOverSlot?.type === 'departure';
              return (
                <div key={hr}
                  style={{ width: SLOT_W, minHeight: maxDepH * CELL_H }}
                  className={`flex flex-col justify-start items-stretch gap-0.5 px-0.5 pt-0.5 border-r border-slate-100 transition-colors ${isOver ? 'bg-emerald-50/80 ring-1 ring-emerald-200 ring-inset' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOverSlot({ idx: hr, type: 'departure' }); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSlot(null); }}
                  onDrop={e => handleDrop(e, hr, 'departure')}>
                  {flights.map((f, fi) => (
                    <div key={`${f.id || fi}`}
                      draggable
                      onDragStart={e => handleDragStart(e, f)}
                      onDragEnd={() => { setIsDragging(false); setDragOverSlot(null); }}
                      onMouseEnter={() => setHoveredFlight(f)}
                      onMouseLeave={() => setHoveredFlight(null)}
                      onClick={e => handleFlightClick(e, f)}
                      onDoubleClick={() => handleFlightDoubleClick(f)}
                      className={getCellClasses(f)}
                      style={{ height: CELL_H - 2 }}
                      title={`${f.airline || ''} ${f.code} · ${f.freq} ${freqMode === 'weekly' ? 'wkly' : 'daily'}`}>
                      <span className="truncate font-black text-[9px] leading-none">{f.code}</span>
                      <span className="opacity-55 text-[7px] ml-0.5 shrink-0 leading-none">
                        {freqMode === 'weekly' ? f.freq : (f.freq / 7).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

        </div>
      </div>

      {/* ── HOVERING MINI CARD ── */}
      {focalFlight && !isAnalyzerOpen && (
        <div className="fixed bottom-6 right-6 w-60 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 pointer-events-none">
          <div className={`px-4 py-2.5 flex items-center justify-between ${REGION_COLORS[focalFlight.region]}`}>
            <span className="text-sm font-black">{focalFlight.code}</span>
            <span className="text-[8px] font-bold opacity-70">{focalFlight.airline}</span>
          </div>
          <div className="px-4 py-2.5 space-y-1">
            {(() => {
              const s = getTwoWaySummary(focalFlight);
              return (
                <>
                  <div className="flex justify-between text-[9px] font-bold">
                    <span className="text-slate-400">Hub time</span>
                    <span>{focalFlight.exactTime || focalFlight.originalHubTime}</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-bold">
                    <span className="text-slate-400">Weekly freq</span>
                    <span>{focalFlight.freq}</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-bold">
                    <span className="text-slate-400">Connectable ports</span>
                    <span className="text-indigo-600 font-black">{s.networkBreadth}</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-bold">
                    <span className="text-slate-400">Out / In</span>
                    <span className="text-[#006a4e] font-black">{s.outbound.length} / {s.inbound.length}</span>
                  </div>
                  <div className="pt-1 text-[8px] text-slate-400">Click to open analyzer →</div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── CONNECTION ANALYZER ── */}
      {isAnalyzerOpen && (pinnedFlight || selectedFlights.length >= 2) && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-4"
          onClick={e => { if (e.target === e.currentTarget) { setIsAnalyzerOpen(false); } }}>
          <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[85vh] shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Analyzer header */}
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#006a4e] rounded-xl flex items-center justify-center">
                  <span className="text-white text-xs">✈</span>
                </div>
                <div>
                  <h3 className="text-sm font-black text-white tracking-tight">
                    {pinnedFlight ? `${pinnedFlight.code} Connectivity Analysis` : `${selectedFlights.length}-Flight Comparison`}
                  </h3>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                    MCT {mct}h · Window {maxConnectionWindow}h
                  </p>
                </div>
              </div>
              <button onClick={() => { setIsAnalyzerOpen(false); setPinnedFlight(null); setAiInsight(null); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>

              {/* Single flight view */}
              {pinnedFlight && (() => {
                const s = getTwoWaySummary(pinnedFlight);
                return (
                  <div className="p-5 space-y-4">
                    {/* Flight badge */}
                    <div className={`rounded-2xl px-5 py-4 flex items-center justify-between ${REGION_COLORS[pinnedFlight.region]}`}>
                      <div>
                        <div className="text-xl font-black">{pinnedFlight.code}</div>
                        <div className="text-[9px] font-bold opacity-70">{pinnedFlight.airline} · {pinnedFlight.exactTime || pinnedFlight.originalHubTime}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black">{pinnedFlight.freq}</div>
                        <div className="text-[8px] opacity-70">weekly</div>
                      </div>
                    </div>

                    {/* Stat pills */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Ports reachable', val: s.networkBreadth, bg: 'bg-slate-50 border-slate-100', col: 'text-slate-900' },
                        { label: 'Outbound conx', val: s.outbound.length, bg: 'bg-indigo-50 border-indigo-100', col: 'text-indigo-700' },
                        { label: 'Inbound feeders', val: s.inbound.length, bg: 'bg-emerald-50 border-emerald-100', col: 'text-emerald-700' },
                      ].map(item => (
                        <div key={item.label} className={`${item.bg} rounded-xl p-3 border text-center`}>
                          <div className={`text-xl font-black ${item.col}`}>{item.val}</div>
                          <div className="text-[8px] font-black text-slate-400 uppercase">{item.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Connection lists */}
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { title: 'Outbound (departs after arrival)', list: s.outbound, color: 'text-indigo-400' },
                        { title: 'Inbound feeders (arrives before dep)', list: s.inbound, color: 'text-emerald-400' },
                      ].map(({ title, list, color }) => (
                        <div key={title}>
                          <p className={`text-[8px] font-black ${color} uppercase tracking-widest mb-1.5`}>{title}</p>
                          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                            {list.length === 0
                              ? <span className="text-[9px] text-slate-400 italic">None within window</span>
                              : list.map((f, i) => (
                                <span key={i} className={`px-1.5 py-0.5 rounded text-[8px] font-black ${REGION_COLORS[f.region]}`}>
                                  {f.code}<span className="opacity-60 ml-0.5">{f.freq}</span>
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI */}
                    <div className="bg-slate-900 rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">AI Strategic Analysis</span>
                        {!aiInsight && !isAiLoading && (
                          <button onClick={generateAI}
                            className="px-2.5 py-1 bg-[#006a4e] text-white rounded-lg text-[8px] font-black hover:bg-[#005a40]">
                            ✦ Generate
                          </button>
                        )}
                        {aiInsight && (
                          <button onClick={() => { setAiInsight(null); generateAI(); }}
                            className="px-2.5 py-1 bg-slate-700 text-slate-300 rounded-lg text-[8px] font-black hover:bg-slate-600">
                            ↺ Regenerate
                          </button>
                        )}
                      </div>
                      {isAiLoading ? (
                        <div className="flex items-center gap-2 py-3">
                          <div className="w-4 h-4 border-2 border-slate-600 border-t-[#00ff9d] rounded-full animate-spin shrink-0" />
                          <span className="text-[9px] text-slate-400 uppercase font-bold">Synthesizing...</span>
                        </div>
                      ) : aiInsight ? (
                        <p className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">{aiInsight}</p>
                      ) : (
                        <p className="text-[9px] text-slate-500 italic">Click Generate for strategic insights.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Multi-flight comparison */}
              {!pinnedFlight && selectedFlights.length >= 2 && (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {selectedFlights.map((f, i) => {
                      const s = getTwoWaySummary(f);
                      return (
                        <div key={i} className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
                          <div className={`px-3 py-2.5 ${REGION_COLORS[f.region]}`}>
                            <div className="text-base font-black">{f.code}</div>
                            <div className="text-[8px] opacity-70">{f.airline} · {f.exactTime || f.originalHubTime}</div>
                          </div>
                          <div className="px-3 py-2 space-y-1">
                            {[
                              ['Breadth', `${s.networkBreadth} ports`],
                              ['Outbound', `${s.outbound.length}`],
                              ['Inbound', `${s.inbound.length}`],
                              ['Freq', `${f.freq}/wk`],
                            ].map(([l, v]) => (
                              <div key={l} className="flex justify-between text-[9px] font-bold">
                                <span className="text-slate-400">{l}</span><span>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-slate-900 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">AI Comparison</span>
                      {!aiInsight && !isAiLoading && (
                        <button onClick={generateAI}
                          className="px-2.5 py-1 bg-[#006a4e] text-white rounded-lg text-[8px] font-black">✦ Generate</button>
                      )}
                    </div>
                    {isAiLoading ? (
                      <div className="flex items-center gap-2 py-3">
                        <div className="w-4 h-4 border-2 border-slate-600 border-t-[#00ff9d] rounded-full animate-spin" />
                        <span className="text-[9px] text-slate-400 uppercase font-bold">Generating...</span>
                      </div>
                    ) : aiInsight ? (
                      <p className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">{aiInsight}</p>
                    ) : (
                      <p className="text-[9px] text-slate-500 italic">Click Generate for comparison.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-[8px] font-bold text-slate-400 uppercase">
                MCT: {mct}h · Window: {maxConnectionWindow}h
              </span>
              <button onClick={() => { setIsAnalyzerOpen(false); setPinnedFlight(null); setSelectedFlights([]); setAiInsight(null); }}
                className="px-3 py-1 bg-slate-200 hover:bg-slate-300 rounded-lg text-[8px] font-black text-slate-600">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRM DROP ── */}
      {pendingDrop && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[200] p-6">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="p-7 text-center">
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">✈</div>
              <h3 className="text-base font-black text-slate-900 mb-1">Confirm Move</h3>
              <p className="text-sm text-slate-500">
                Move <span className="text-indigo-600 font-black">{pendingDrop.flight.code}</span> to{' '}
                <span className="font-black text-slate-800">{String(pendingDrop.slotIdx).padStart(2, '0')}:00</span> as {pendingDrop.type}?
              </p>
              <p className="text-[9px] text-slate-400 mt-2 uppercase tracking-widest">Reciprocal hub updates will apply</p>
            </div>
            <div className="flex border-t border-slate-100">
              <button onClick={() => setPendingDrop(null)} className="flex-1 py-3.5 text-sm font-black text-slate-500 hover:bg-slate-50">CANCEL</button>
              <button onClick={confirmDrop} className="flex-1 py-3.5 text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700">CONFIRM</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HubBankChart;
