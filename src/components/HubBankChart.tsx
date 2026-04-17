import React, { useMemo, useState, useCallback, useRef } from 'react';
import { HubSlot, FlightInfo, Region } from '../types';
import { REGION_COLORS, BLR_CATCHMENT, AIRPORT_REGIONS, INDIAN_AIRPORTS } from '../constants';

interface HubBankChartProps {
  data: HubSlot[];
  mct: number;
  maxConnectionWindow: number;
  onManualDrop: (slotIdx: number, type: 'arrival' | 'departure', flight: FlightInfo) => void;
  onUpdateManual: (id: string, updates: Partial<FlightInfo>) => void;
  onDeleteManual: (id: string) => void;
  freqMode: 'weekly' | 'daily';
  setFreqMode: (mode: 'weekly' | 'daily') => void;
  highlightCatchment: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOT_W = 80;
const CELL_H = 30;

function toMins(t: string): number {
  if (!t?.includes(':')) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minsToTime(mins: number): string {
  const n = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

// Region grouping for the connectivity panel
function getRegionLabel(code: string): string {
  const r = AIRPORT_REGIONS[code];
  if (!r) return 'OTHER';
  if (r === Region.AsiaPacific) return 'ASIA/PACIFIC';
  if (r === Region.MiddleEast) return 'MIDDLE EAST';
  if (r === Region.Europe) return 'EUROPE';
  if (r === Region.Americas) return 'AMERICAS';
  if (r === Region.Africa) return 'AFRICA';
  return 'OTHER';
}

function isBLRCatchment(code: string): boolean {
  return BLR_CATCHMENT.has(code);
}

const HubBankChart: React.FC<HubBankChartProps> = ({
  data, mct, maxConnectionWindow, onManualDrop, onUpdateManual, onDeleteManual,
  freqMode, setFreqMode, highlightCatchment
}) => {
  const [hoveredFlight, setHoveredFlight] = useState<FlightInfo | null>(null);
  const [hoveredType, setHoveredType] = useState<'arrival' | 'departure' | null>(null);
  const [pinnedFlight, setPinnedFlight] = useState<FlightInfo | null>(null);
  const [pinnedType, setPinnedType] = useState<'arrival' | 'departure' | null>(null);
  const [selectedFlights, setSelectedFlights] = useState<FlightInfo[]>([]);
  const [pendingDrop, setPendingDrop] = useState<{ slotIdx: number; type: 'arrival' | 'departure'; flight: FlightInfo } | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [analyzerTab, setAnalyzerTab] = useState<'two-way' | 'outbound' | 'inbound' | 'ai'>('two-way');
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chartScale, setChartScale] = useState(0.53);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<{ idx: number; type: 'arrival' | 'departure' } | null>(null);
  const [subMct, setSubMct] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Consolidate data (merge duplicate flights in same slot)
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

  // Consistent flight key
  const flightKey = (f: FlightInfo) => f.id || `${f.code}-${f.airline}-${f.originalHubTime}`;

  // MCT connection finder — direction-aware
  // If focal is an ARRIVAL: find departures that depart [MCT, window] AFTER the arrival (outbound)
  // If focal is a DEPARTURE: find arrivals that arrive [MCT, window] BEFORE the departure (inbound feeders)
  // Two-way: treat focal as arrival AND departure simultaneously (for analyzer)
  const getTwoWaySummary = useCallback((focal: FlightInfo, forceType?: 'arrival' | 'departure' | 'two-way') => {
    const focalMins = toMins(focal.exactTime || focal.originalHubTime || '00:00');
    const effectiveMct = (subMct ? mct * 0.5 : mct) * 60;
    const windowMins = maxConnectionWindow * 60;
    const outbound: FlightInfo[] = []; // departures connectable FROM this arrival
    const inbound: FlightInfo[] = [];  // arrivals that feed INTO this departure

    consolidatedData.forEach(slot => {
      // Outbound: departures that leave [MCT..window] after focal
      slot.departures.forEach(dep => {
        if (flightKey(dep) === flightKey(focal)) return; // skip self
        const depMins = toMins(dep.exactTime || dep.originalHubTime || '00:00');
        const diff = (depMins - focalMins + 1440) % 1440;
        if (diff >= effectiveMct && diff <= windowMins) outbound.push(dep);
      });

      // Inbound: arrivals that land [MCT..window] before focal
      slot.arrivals.forEach(arr => {
        if (flightKey(arr) === flightKey(focal)) return; // skip self
        const arrMins = toMins(arr.exactTime || arr.originalHubTime || '00:00');
        const diff = (focalMins - arrMins + 1440) % 1440;
        if (diff >= effectiveMct && diff <= windowMins) inbound.push(arr);
      });
    });

    return { outbound, inbound };
  }, [consolidatedData, mct, maxConnectionWindow, subMct]);

  // Connected flight IDs for highlighting — direction-aware
  const connectedIds = useMemo(() => {
    const focal = pinnedFlight || hoveredFlight;
    const type = pinnedFlight ? pinnedType : hoveredType;
    if (!focal) return new Set<string>();

    const { outbound, inbound } = getTwoWaySummary(focal);

    let toHighlight: FlightInfo[] = [];
    if (type === 'arrival') {
      // Clicked an arrival → highlight outbound departures only
      toHighlight = outbound;
    } else if (type === 'departure') {
      // Clicked a departure → highlight inbound arrivals only
      toHighlight = inbound;
    } else {
      // Fallback two-way
      toHighlight = [...outbound, ...inbound];
    }

    return new Set(toHighlight.map(flightKey));
  }, [pinnedFlight, hoveredFlight, pinnedType, hoveredType, getTwoWaySummary]);

  const hasFocal = !!(pinnedFlight || hoveredFlight);
  const focalFlight = hoveredFlight || pinnedFlight;

  // --- Cell styling ---
  const getCellClasses = (f: FlightInfo) => {
    const fk = flightKey(f);
    const isPinned = !!pinnedFlight && flightKey(pinnedFlight) === fk;
    const isHov = !!hoveredFlight && flightKey(hoveredFlight) === fk;
    const isSelected = selectedFlights.some(sf => flightKey(sf) === fk);
    const isConnected = connectedIds.has(fk);
    const isCatchment = BLR_CATCHMENT.has(f.code);

    const base = 'relative flex items-center justify-between px-1.5 rounded text-[9px] font-black cursor-grab active:cursor-grabbing select-none transition-all duration-100';

    // Catchment highlight overrides region color when toggle is on
    let colorCls = REGION_COLORS[f.region] || REGION_COLORS[Region.Unknown];
    if (highlightCatchment && isCatchment) {
      colorCls = 'bg-orange-500 text-white';
    }

    const catchDot = isCatchment && !highlightCatchment
      ? "after:content-[''] after:absolute after:-top-0.5 after:-right-0.5 after:w-1.5 after:h-1.5 after:bg-amber-400 after:rounded-full after:border after:border-white"
      : '';
    const manualBorder = f.isManual ? 'border-2 border-indigo-400' : 'border border-transparent';
    const pinCls = isPinned ? 'ring-2 ring-white ring-offset-1 z-20 scale-105 shadow-lg' : '';
    const hovCls = isHov && !isPinned ? 'scale-105 shadow z-10' : '';
    const selCls = isSelected ? 'ring-2 ring-yellow-300 ring-offset-1' : '';
    const connCls = isConnected ? 'ring-2 ring-[#00ff9d] ring-offset-1 z-10' : '';
    const dimCls = hasFocal && !isConnected && !isPinned && !isHov ? 'opacity-25' : '';

    return `${base} ${colorCls} ${catchDot} ${manualBorder} ${pinCls} ${hovCls} ${selCls} ${connCls} ${dimCls}`;
  };

  // --- Event handlers ---
  const handleFlightClick = (e: React.MouseEvent, f: FlightInfo, slotType: 'arrival' | 'departure') => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      setSelectedFlights(prev => prev.some(sf => flightKey(sf) === flightKey(f))
        ? prev.filter(sf => flightKey(sf) !== flightKey(f))
        : [...prev, f]
      );
      setPinnedFlight(null);
      setPinnedType(null);
    } else {
      const alreadyPinned = !!pinnedFlight && flightKey(pinnedFlight) === flightKey(f);
      setPinnedFlight(alreadyPinned ? null : f);
      setPinnedType(alreadyPinned ? null : slotType);
      setSelectedFlights([]);
    }
  };

  const handleFlightDoubleClick = (f: FlightInfo) => {
    if (!f.isManual) return;
    const t = prompt('New hub time (HH:mm):', f.exactTime || f.originalHubTime);
    if (t && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) onUpdateManual(f.id!, { exactTime: t });
    const c = prompt('New airport code:', f.code);
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

  const fitToScreen = () => {
    if (!chartRef.current || !containerRef.current) return;
    setChartScale(Math.min(1, (containerRef.current.clientWidth - 32) / chartRef.current.scrollWidth));
  };

  const maxArrH = useMemo(() => Math.max(4, ...consolidatedData.map(s => s.arrivals.length)), [consolidatedData]);
  const maxDepH = useMemo(() => Math.max(4, ...consolidatedData.map(s => s.departures.length)), [consolidatedData]);

  // --- AI generation ---
  const fmtFreq = (freq: number) => freqMode === 'weekly' ? `${freq}` : (freq / 7).toFixed(1);
  const freqLabel = freqMode === 'weekly' ? '/wk' : '/day';

  const generateAI = async () => {
    const focal = pinnedFlight || (selectedFlights.length > 0 ? selectedFlights[0] : null);
    if (!focal) return;
    setIsAiLoading(true);
    setAiInsight(null);
    try {
      const { outbound, inbound } = getTwoWaySummary(focal);
      const connPorts = new Set([...outbound, ...inbound].map(f => f.code));

      // Build detailed connection data for the prompt
      const outDetails = outbound.slice(0, 15).map(f => {
        const diff = (toMins(f.exactTime || f.originalHubTime || '00:00') - toMins(focal.exactTime || focal.originalHubTime || '00:00') + 1440) % 1440;
        return `${f.code}(${f.airline || ''},${f.freq}wk,+${Math.floor(diff/60)}h${String(diff%60).padStart(2,'0')}m)`;
      }).join(', ');

      const inDetails = inbound.slice(0, 15).map(f => {
        const diff = (toMins(focal.exactTime || focal.originalHubTime || '00:00') - toMins(f.exactTime || f.originalHubTime || '00:00') + 1440) % 1440;
        return `${f.code}(${f.airline || ''},${f.freq}wk,-${Math.floor(diff/60)}h${String(diff%60).padStart(2,'0')}m)`;
      }).join(', ');

      const prompt = `You are a senior aviation network strategist specializing in Indian hub airports. Analyze the hub bank connectivity for the following flight at BLR (Kempegowda International, Bengaluru).

FOCAL FLIGHT: ${focal.code} | Airline: ${focal.airline || 'Unknown'} | Flight: ${focal.flightNo || 'N/A'} | Hub time: ${focal.exactTime || focal.originalHubTime} | Weekly freq: ${focal.freq}
MCT: ${mct}h | Connection window: ${mct}h–${maxConnectionWindow}h

OUTBOUND CONNECTIONS (${outbound.length} departures reachable after this arrival):
${outDetails || 'None within window'}

INBOUND FEEDERS (${inbound.length} arrivals that connect into this departure):
${inDetails || 'None within window'}

Total connectable ports: ${connPorts.size}

Provide a structured strategic analysis with these 4 sections:

1. HUB VALUE ASSESSMENT
Rate the connectivity quality (Strong/Moderate/Weak) and explain why based on the number of connections, frequency, and geographic spread.

2. TOP CONNECTION OPPORTUNITIES
List the 3–5 most strategically valuable connections from the data above. For each: port code, why it matters (market size, traffic type), and the connection gap time.

3. NETWORK GAPS
Identify 2–3 specific missing or weak connections that would improve hub value. Be specific — name actual airport codes and explain the commercial rationale.

4. OPTIMIZATION RECOMMENDATION
One concrete, actionable recommendation to improve this flight's hub contribution — timing adjustment, frequency change, or new route suggestion with specific details.

Be specific, use IATA codes throughout, keep it concise and actionable.`;

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `API error ${response.status}`);
      }

      const result = await response.json();
      const text = result.text?.trim();
      setAiInsight(text || 'No response received.');
    } catch (err: any) {
      console.error('AI error:', err);
      setAiInsight(`Analysis unavailable: ${err?.message || 'Unknown error'}.\n\nNote: The AI strategy feature requires the Anthropic API to be accessible. If running on a deployed site, ensure the API key is configured in your environment.`);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Group connections by region for the connectivity panel
  const getGroupedConnections = (flights: FlightInfo[]) => {
    const groups: Record<string, FlightInfo[]> = {};
    flights.forEach(f => {
      // Separate BLR-Catchment from INTL
      const grp = isBLRCatchment(f.code) ? 'BLR-C' : INDIAN_AIRPORTS.has(f.code) ? 'DOMESTIC' : getRegionLabel(f.code);
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(f);
    });
    return groups;
  };

  // Build the intel card stat columns (INTL | BLR-C | OTHER)
  const getIntelColumns = (focal: FlightInfo) => {
    const { outbound, inbound } = getTwoWaySummary(focal);
    const all = [...outbound, ...inbound];
    const seen = new Set<string>();
    const intl: { code: string; freq: number }[] = [];
    const blrc: { code: string; freq: number }[] = [];
    const other: { code: string; freq: number }[] = [];

    all.forEach(f => {
      if (seen.has(f.code)) return;
      seen.add(f.code);
      const freq = all.filter(x => x.code === f.code).reduce((s, x) => s + x.freq, 0);
      if (isBLRCatchment(f.code)) blrc.push({ code: f.code, freq });
      else if (!INDIAN_AIRPORTS.has(f.code)) intl.push({ code: f.code, freq });
      else other.push({ code: f.code, freq });
    });

    return {
      intl: intl.sort((a, b) => b.freq - a.freq).slice(0, 4),
      blrc: blrc.sort((a, b) => b.freq - a.freq).slice(0, 4),
      other: other.sort((a, b) => b.freq - a.freq).slice(0, 4),
    };
  };

  // Compute valid connection interval
  const getConnectionInterval = (focal: FlightInfo) => {
    const mctMins = mct * 60;
    const focalMins = toMins(focal.exactTime || focal.originalHubTime || '00:00');
    const start = minsToTime(focalMins + mctMins);
    const end = minsToTime(focalMins + maxConnectionWindow * 60);
    return { start, end };
  };

  return (
    <div className="h-full flex flex-col gap-2 relative" onClick={() => { setPinnedFlight(null); setPinnedType(null); setSelectedFlights([]); }}>

      {/* ── Sub-controls row: Weekly/Daily + controls bar ── */}
      <div className="flex items-center justify-between bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm shrink-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">HUB STRUCTURE MATRIX</span>
          <div className="h-3 w-px bg-slate-200" />
          {/* WEEKLY / DAILY toggle — matching original sub-nav look */}
          <div className="flex bg-slate-900 p-0.5 rounded-lg">
            <button onClick={() => setFreqMode('weekly')}
              className={`px-3 py-1 rounded text-[9px] font-black uppercase transition-all ${freqMode === 'weekly' ? 'bg-[#006a4e] text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              WEEKLY
            </button>
            <button onClick={() => setFreqMode('daily')}
              className={`px-3 py-1 rounded text-[9px] font-black uppercase transition-all ${freqMode === 'daily' ? 'bg-[#006a4e] text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              DAILY
            </button>
          </div>
          <div className="h-3 w-px bg-slate-200" />
          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-black">ZOOM: {Math.round(chartScale * 100)}%</span>
          <button onClick={() => setChartScale(s => Math.max(0.25, parseFloat((s - 0.05).toFixed(2))))}
            className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black">−</button>
          <button onClick={() => setChartScale(s => Math.min(1.5, parseFloat((s + 0.05).toFixed(2))))}
            className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black">+</button>
        </div>
        <div className="flex items-center gap-2">
          {/* ANALYZE CONNECTIVITY — appears when flights are ctrl+clicked */}
          {selectedFlights.length >= 1 && (
            <button
              onClick={e => { e.stopPropagation(); setAnalyzerOpen(true); setAnalyzerTab('two-way'); setAiInsight(null); }}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-400 text-slate-900 rounded-full text-[9px] font-black uppercase hover:bg-amber-300 shadow-md transition-all">
              ☀ ANALYZE CONNECTIVITY
            </button>
          )}
          {selectedFlights.length >= 1 && (
            <button onClick={e => { e.stopPropagation(); setSelectedFlights([]); setPinnedFlight(null); }}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-full text-[9px] font-black uppercase hover:bg-slate-50">
              CLEAR
            </button>
          )}
          <div onDragOver={e => e.preventDefault()}
            onDrop={e => { const raw = e.dataTransfer.getData('flight'); if (raw) { const f = JSON.parse(raw); if (f.isManual && f.id) onDeleteManual(f.id); } }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all ${isDragging ? 'bg-rose-100 text-rose-500 border-2 border-dashed border-rose-300 scale-110' : 'bg-slate-100 text-slate-400'}`}>
            🗑
          </div>
          <button onClick={fitToScreen}
            className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-[9px] font-black hover:bg-slate-50">
            ✦ FIT TO SCREEN
          </button>
        </div>
      </div>

      {/* ── Main horizontal bank chart ── */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-200 shadow-inner" style={{ scrollbarWidth: 'thin' }} onClick={e => e.stopPropagation()}>
        <div ref={chartRef} className="inline-flex flex-col origin-top-left transition-transform duration-150 p-3"
          style={{ transform: `scale(${chartScale})`, transformOrigin: 'top left', minWidth: `${24 * SLOT_W + 48}px` }}>

          {/* ARRIVALS */}
          <div className="flex items-end">
            <div className="shrink-0 flex items-center justify-center" style={{ width: 48, height: maxArrH * CELL_H }}>
              <span className="text-[7px] font-black text-indigo-400 uppercase tracking-widest"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>ARRIVALS</span>
            </div>
            {HOURS.map(hr => {
              const flights = consolidatedData[hr]?.arrivals || [];
              const isOver = dragOverSlot?.idx === hr && dragOverSlot?.type === 'arrival';
              return (
                <div key={hr}
                  style={{ width: SLOT_W, minHeight: maxArrH * CELL_H }}
                  className={`flex flex-col-reverse justify-start items-stretch gap-0.5 px-0.5 pb-0.5 border-r border-slate-100 transition-colors ${isOver ? 'bg-indigo-50/80' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOverSlot({ idx: hr, type: 'arrival' }); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSlot(null); }}
                  onDrop={e => handleDrop(e, hr, 'arrival')}>
                  {flights.map((f, fi) => (
                    <div key={f.id || fi}
                      draggable
                      onDragStart={e => handleDragStart(e, f)}
                      onDragEnd={() => { setIsDragging(false); setDragOverSlot(null); }}
                      onMouseEnter={() => { setHoveredFlight(f); setHoveredType('arrival'); }}
                      onMouseLeave={() => { setHoveredFlight(null); setHoveredType(null); }}
                      onClick={e => handleFlightClick(e, f, 'arrival')}
                      onDoubleClick={() => handleFlightDoubleClick(f)}
                      className={getCellClasses(f)}
                      style={{ height: CELL_H - 2 }}
                      title={`${f.airline || ''} ${f.code} · ${f.freq}`}>
                      <span className="truncate font-black text-[9px]">{f.code}</span>
                      <span className="opacity-55 text-[7px] ml-0.5 shrink-0">
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
            <div className="shrink-0 flex items-center justify-center bg-slate-900 border-r border-slate-700" style={{ width: 48 }}>
              <span className="text-[7px] font-black text-slate-400 uppercase">HUB</span>
            </div>
            {HOURS.map(hr => (
              <div key={hr} style={{ width: SLOT_W }}
                className="flex items-center justify-center border-r border-slate-700 bg-slate-900 shrink-0">
                <span className="text-[11px] font-black text-white tabular-nums">{String(hr).padStart(2, '0')}</span>
              </div>
            ))}
          </div>

          {/* DEPARTURES */}
          <div className="flex items-start">
            <div className="shrink-0 flex items-start justify-center pt-2" style={{ width: 48, minHeight: maxDepH * CELL_H }}>
              <span className="text-[7px] font-black text-emerald-500 uppercase tracking-widest"
                style={{ writingMode: 'vertical-rl' }}>DEPARTURES</span>
            </div>
            {HOURS.map(hr => {
              const flights = consolidatedData[hr]?.departures || [];
              const isOver = dragOverSlot?.idx === hr && dragOverSlot?.type === 'departure';
              return (
                <div key={hr}
                  style={{ width: SLOT_W, minHeight: maxDepH * CELL_H }}
                  className={`flex flex-col justify-start items-stretch gap-0.5 px-0.5 pt-0.5 border-r border-slate-100 transition-colors ${isOver ? 'bg-emerald-50/80' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOverSlot({ idx: hr, type: 'departure' }); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSlot(null); }}
                  onDrop={e => handleDrop(e, hr, 'departure')}>
                  {flights.map((f, fi) => (
                    <div key={f.id || fi}
                      draggable
                      onDragStart={e => handleDragStart(e, f)}
                      onDragEnd={() => { setIsDragging(false); setDragOverSlot(null); }}
                      onMouseEnter={() => { setHoveredFlight(f); setHoveredType('departure'); }}
                      onMouseLeave={() => { setHoveredFlight(null); setHoveredType(null); }}
                      onClick={e => handleFlightClick(e, f, 'departure')}
                      onDoubleClick={() => handleFlightDoubleClick(f)}
                      className={getCellClasses(f)}
                      style={{ height: CELL_H - 2 }}
                      title={`${f.airline || ''} ${f.code} · ${f.freq}`}>
                      <span className="truncate font-black text-[9px]">{f.code}</span>
                      <span className="opacity-55 text-[7px] ml-0.5 shrink-0">
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

      {/* ── INTEL CARD (single click pin) — dark floating card top-right ── */}
      {pinnedFlight && !analyzerOpen && (() => {
        const { outbound, inbound } = getTwoWaySummary(pinnedFlight);
        const cols = getIntelColumns(pinnedFlight);
        const interval = getConnectionInterval(pinnedFlight);
        const totalOps = pinnedFlight.freq;
        const totalSeats = (pinnedFlight.seats || 0);
        const totalPax = (pinnedFlight.pax || 0);

        return (
          <div className="fixed top-20 right-4 w-80 bg-[#1a2332] rounded-2xl shadow-2xl overflow-hidden z-50 border border-slate-700/50"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 pt-5 pb-3 flex items-start justify-between">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-white tracking-tight">{pinnedFlight.code}</span>
                  <span className="text-sm font-bold text-indigo-400">{pinnedFlight.airline || ''} {pinnedFlight.flightNo || ''}</span>
                </div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  BANK FOCAL: {pinnedFlight.exactTime || pinnedFlight.originalHubTime || '--:--'}
                </p>
              </div>
              <button onClick={() => setPinnedFlight(null)}
                className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-700 text-slate-400 hover:text-white text-xs">✕</button>
            </div>

            {/* OPS / SEATS / PAX stats */}
            <div className="grid grid-cols-3 gap-px mx-4 mb-3 bg-slate-600 rounded-xl overflow-hidden">
              {[
                { label: freqMode === 'weekly' ? 'OPS/WK' : 'OPS/DAY', val: fmtFreq(pinnedFlight.freq) },
                { label: 'SEATS', val: totalSeats > 0 ? totalSeats.toLocaleString('en-IN') : '—' },
                { label: 'PAX', val: totalPax > 0 ? totalPax.toLocaleString('en-IN') : '—' },
              ].map(s => (
                <div key={s.label} className="bg-[#1f2d40] px-3 py-2.5 text-center">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
                  <p className="text-base font-black text-white tabular-nums">{s.val}</p>
                </div>
              ))}
            </div>

            {/* Valid connection interval */}
            <div className="mx-4 mb-3 bg-[#151e2b] rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[8px] text-slate-400 font-black uppercase tracking-widest">🔗 VALID CONNECTION INTERVAL</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-lg font-black text-indigo-400 tabular-nums">{interval.start} — {interval.end}</span>
                <span className="text-[8px] font-bold text-slate-500">MCT BUFF <span className="text-slate-300">{mct}h</span></span>
              </div>
            </div>

            {/* INTL | BLR-C | OTHER columns */}
            <div className="mx-4 mb-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'INTL', items: cols.intl, col: 'text-emerald-400' },
                  { label: 'BLR-C', items: cols.blrc, col: 'text-orange-400' },
                  { label: 'OTHER', items: cols.other, col: 'text-slate-300' },
                ].map(({ label, items, col }) => (
                  <div key={label}>
                    <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${col}`}>{label}</p>
                    {items.length === 0
                      ? <p className="text-[9px] text-slate-600 italic">—</p>
                      : items.map((it, i) => (
                        <div key={i} className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-black text-white">{it.code}</span>
                          <span className="text-[9px] font-bold text-slate-400 tabular-nums">{fmtFreq(it.freq)}{freqLabel}</span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Outbound / Inbound counts */}
            <div className="mx-4 mb-4 flex gap-2">
              <div className="flex-1 bg-[#151e2b] rounded-lg px-3 py-2 text-center">
                <p className="text-[8px] text-indigo-400 font-black uppercase">Outbound</p>
                <p className="text-lg font-black text-white">{outbound.length}</p>
              </div>
              <div className="flex-1 bg-[#151e2b] rounded-lg px-3 py-2 text-center">
                <p className="text-[8px] text-emerald-400 font-black uppercase">Inbound</p>
                <p className="text-lg font-black text-white">{inbound.length}</p>
              </div>
              <div className="flex-1 bg-[#151e2b] rounded-lg px-3 py-2 text-center">
                <p className="text-[8px] text-slate-400 font-black uppercase">Ports</p>
                <p className="text-lg font-black text-white">{new Set([...outbound, ...inbound].map(f => f.code)).size}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CONNECTIVITY ANALYZER FULL SCREEN ── */}
      {analyzerOpen && (pinnedFlight || selectedFlights.length >= 1) && (() => {
        const focal = pinnedFlight || selectedFlights[0];
        const { outbound, inbound } = getTwoWaySummary(focal);
        const both = [...outbound, ...inbound];
        const interval = getConnectionInterval(focal);
        const focalArrTime = focal.exactTime || focal.originalHubTime || '00:00';
        const focalDepTime = minsToTime(toMins(focalArrTime) + mct * 60);

        // Group by region
        const groupFlights = (list: FlightInfo[]) => {
          const groups: Record<string, FlightInfo[]> = {};
          list.forEach(f => {
            const grp = getRegionLabel(f.code);
            if (!groups[grp]) groups[grp] = [];
            if (!groups[grp].find(x => x.code === f.code)) groups[grp].push(f);
          });
          return groups;
        };

        const displayList = analyzerTab === 'two-way' ? both : analyzerTab === 'outbound' ? outbound : inbound;
        const grouped = groupFlights(displayList);

        return (
          <div className="fixed inset-0 bg-[#0d1520] z-[100] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Analyzer header */}
            <div className="bg-[#111c2b] border-b border-slate-700/50 px-6 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#006a4e] rounded-xl flex items-center justify-center shadow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8M12 3v4"/>
                  </svg>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-black text-white">{focal.code}</span>
                    <span className="text-sm font-bold text-indigo-400">{focal.airline || ''} {focal.flightNo || ''}</span>
                  </div>
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">CONNECTION SYNERGY PLATFORM</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Market filter */}
                <div className="flex items-center gap-1 bg-slate-800 rounded-lg px-2 py-1">
                  <span className="text-[8px] font-black text-slate-500 uppercase mr-1">MARKET</span>
                  {['ALL', 'DOMESTIC', 'INTERNATIONAL'].map(m => (
                    <button key={m} onClick={e => e.stopPropagation()} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase transition-all ${m === 'ALL' ? 'bg-white text-slate-900' : 'text-slate-500 hover:text-white'}`}>{m}</button>
                  ))}
                </div>
                {/* Sub MCT toggle */}
                <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-3 py-1.5">
                  <span className="text-[8px] font-black text-slate-400 uppercase">SUB MCT</span>
                  <button onClick={e => { e.stopPropagation(); setSubMct(!subMct); }} className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors ${subMct ? 'bg-indigo-500' : 'bg-slate-600'}`}>
                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${subMct ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {/* Tabs */}
                <div className="flex items-center bg-slate-800 rounded-xl p-0.5 gap-0.5">
                  {[
                    { key: 'two-way', label: '⇄ TWO-WAY' },
                    { key: 'outbound', label: '→ OUTBOUND' },
                    { key: 'inbound', label: '← INBOUND' },
                    { key: 'ai', label: '✦ AI STRATEGY' },
                  ].map(tab => (
                    <button key={tab.key}
                      onClick={e => { e.stopPropagation(); setAnalyzerTab(tab.key as any); if (tab.key === 'ai' && !aiInsight) generateAI(); }}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${analyzerTab === tab.key ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-white'}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setAnalyzerOpen(false); setAiInsight(null); }}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-700 text-slate-400 hover:text-white text-sm">✕</button>
              </div>
            </div>

            {/* Big arrival / departure time display */}
            <div className="shrink-0 bg-white mx-6 mt-5 rounded-2xl flex divide-x divide-slate-200 overflow-hidden shadow-sm">
              <div className="flex-1 flex flex-col items-center justify-center py-5 gap-1">
                <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">HUB ARRIVAL BANK</p>
                <div className="flex items-center gap-2">
                  <span className="text-3xl">🛬</span>
                  <span className="text-4xl font-black text-slate-900 tabular-nums tracking-tight">{focalArrTime}:00</span>
                </div>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center py-5 gap-1">
                <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">HUB DEPARTURE BANK</p>
                <div className="flex items-center gap-2">
                  <span className="text-3xl">🛫</span>
                  <span className="text-4xl font-black text-slate-900 tabular-nums tracking-tight">{focalDepTime}:00</span>
                </div>
              </div>
            </div>

            {/* AI tab */}
            {analyzerTab === 'ai' ? (
              <div className="flex-1 overflow-y-auto mx-6 mt-5 mb-5" style={{ scrollbarWidth: 'thin' }}>
                <div className="bg-[#111c2b] rounded-2xl p-6 border border-slate-700/30">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">✦ AI Strategic Analysis</span>
                    {!isAiLoading && (
                      <button onClick={() => { setAiInsight(null); generateAI(); }}
                        className="px-3 py-1.5 bg-[#006a4e] text-white rounded-lg text-[9px] font-black hover:bg-[#005a40]">
                        {aiInsight ? '↺ Regenerate' : '✦ Generate'}
                      </button>
                    )}
                  </div>
                  {isAiLoading ? (
                    <div className="flex items-center gap-3 py-8">
                      <div className="w-5 h-5 border-2 border-slate-600 border-t-[#00ff9d] rounded-full animate-spin" />
                      <span className="text-[10px] text-slate-400 uppercase font-bold">Synthesizing network data...</span>
                    </div>
                  ) : aiInsight ? (
                    <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{aiInsight}</p>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic py-4">Click Generate to produce strategic insights for {focal.code}.</p>
                  )}
                </div>
              </div>
            ) : (
              /* Connection port cards grouped by region */
              <div className="flex-1 overflow-y-auto mx-6 mt-5 mb-5 space-y-4" style={{ scrollbarWidth: 'thin' }}>
                {Object.keys(grouped).length === 0 && (
                  <div className="text-center py-12 text-slate-500 font-bold">
                    No {analyzerTab === 'outbound' ? 'outbound connections' : analyzerTab === 'inbound' ? 'inbound feeders' : 'connections'} found within MCT window.
                  </div>
                )}
                {Object.entries(grouped).map(([region, ports]) => (
                  <div key={region}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <h3 className="text-xs font-black text-white uppercase tracking-widest">
                        {region} ({ports.length} {ports.length === 1 ? 'PORT' : 'PORTS'})
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {ports.map((port, i) => {
                        // Get all flights for this port in the display list
                        const portFlights = displayList.filter(f => f.code === port.code);
                        const outFlights = outbound.filter(f => f.code === port.code);
                        const inFlights = inbound.filter(f => f.code === port.code);

                        return (
                          <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <div className="px-3 pt-3 pb-2 flex items-start justify-between">
                              <div>
                                <span className="text-sm font-black text-slate-900">{port.code}</span>
                                <p className="text-[8px] text-slate-400 font-bold uppercase">{region} · <span className="text-emerald-600">↑{fmtFreq(port.freq)}</span></p>
                              </div>
                              <span className="text-[7px] bg-slate-100 text-slate-500 font-black rounded px-1 py-0.5 uppercase">
                                {fmtFreq(portFlights.reduce((s, f) => s + f.freq, 0))}{freqLabel}
                              </span>
                            </div>

                            {/* Outbound flights for this port */}
                            {outFlights.length > 0 && (
                              <div className="mx-2 mb-2">
                                <div className="bg-indigo-600 rounded text-center py-0.5 mb-1">
                                  <span className="text-[7px] font-black text-white uppercase">OUTBOUNDS ({outFlights.length})</span>
                                </div>
                                {outFlights.map((f, fi) => {
                                  const depTime = f.exactTime || f.originalHubTime || '—';
                                  const diff = (toMins(depTime) - toMins(focalArrTime) + 1440) % 1440;
                                  const sign = `+${Math.floor(diff / 60)}h${String(diff % 60).padStart(2, '0')}m`;
                                  return (
                                    <div key={fi} className="flex items-center justify-between px-1 py-0.5">
                                      <div>
                                        <p className="text-[8px] text-slate-400 font-bold">{sign}</p>
                                        <p className="text-[10px] font-black text-slate-900 tabular-nums">{depTime}</p>
                                        <p className="text-[7px] text-slate-400">{f.airline} {f.flightNo || ''}</p>
                                      </div>
                                      <span className="text-[9px] font-black text-slate-700">{fmtFreq(f.freq)}{freqLabel}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Inbound flights for this port */}
                            {inFlights.length > 0 && (
                              <div className="mx-2 mb-2">
                                <div className="bg-emerald-600 rounded text-center py-0.5 mb-1">
                                  <span className="text-[7px] font-black text-white uppercase">INBOUNDS ({inFlights.length})</span>
                                </div>
                                {inFlights.map((f, fi) => {
                                  const arrTime = f.exactTime || f.originalHubTime || '—';
                                  const diff = (toMins(focalArrTime) - toMins(arrTime) + 1440) % 1440;
                                  const sign = `-${Math.floor(diff / 60)}h${String(diff % 60).padStart(2, '0')}m`;
                                  return (
                                    <div key={fi} className="flex items-center justify-between px-1 py-0.5">
                                      <div>
                                        <p className="text-[8px] text-slate-400 font-bold">{sign}</p>
                                        <p className="text-[10px] font-black text-slate-900 tabular-nums">{arrTime}</p>
                                        <p className="text-[7px] text-slate-400">{f.airline} {f.flightNo || ''}</p>
                                      </div>
                                      <span className="text-[9px] font-black text-slate-700">{fmtFreq(f.freq)}{freqLabel}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
