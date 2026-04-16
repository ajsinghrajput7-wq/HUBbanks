import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { HubSlot, Region, MarketSegment, FlightInfo, WorkspaceSnapshot, AirportDataset } from './types';
import { AIRPORT_REGIONS, TIME_SLOTS, REGION_COLORS, INDIAN_AIRPORTS } from './constants';
import HubBankChart from './components/HubBankChart';
import DataTable from './components/DataTable';
import blrJun26Raw from '../public/data/BLRbank_june26_JobId3667673.csv?raw';
// ── TO ADD A NEW DATASET ─────────────────────────────────────────────────────
// 1. Drop the CSV into public/data/
// 2. Add an import line here:      import myNewRaw from '../public/data/YOURFILE.csv?raw';
// 3. Add a PRELOADED_DATASETS entry below (id, code, period, label, fileName)
// 4. Add to BUNDLED_RAW below:     'your-id': myNewRaw,
// That's it — it will appear as a clickable card on the landing screen.
// Example for BLR December 2026:
//   import blrDec26Raw from '../public/data/BLRbank_dec26_JobId999.csv?raw';
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_SETTINGS = 'aerohub_settings_v1';
const STORAGE_BLOCKS = 'aerohub_blocks_v1';
const STORAGE_SNAPSHOTS = 'aerohub_snapshots_v1';
const STORAGE_DATASETS = 'aerohub_datasets_v1';

const getMins = (t: string) => { if (!t?.includes(':')) return 0; const [h,m] = t.split(':').map(Number); return h*60+m; };
const minsToTime = (m: number) => { const n=((m%1440)+1440)%1440; return `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.round(n%60).toString().padStart(2,'0')}`; };

// ── Parse OAG/IATA dual-sided bank CSV ──────────────────────────────────────
// Arrivals: cols 0-8  → Airline,FlightNo,Origin,OpDays,Equip,SvcType,Seats,DepTime,HubTime
// Departures: cols 8-16 → HubTime,ArrTime,Seats,SvcType,Equip,OpDays,Destination,FlightNo,Airline
const parseFreq = (s: string) => (s?.match(/[1-7]/g) || []).length || 0;
const safeInt   = (s: string) => { const n = parseInt((s || '').trim()); return isNaN(n) ? 0 : n; };

function parseCSV(text: string): any[] {
  const rawRows = text.split('\n').filter(r => r.trim());
  if (rawRows.length < 2) return [];
  const results: any[] = [];
  rawRows.slice(1).forEach(raw => {
    const c = raw.split(',').map(x => x.trim());
    if (c.length < 9) return;
    const hubTime = c[8]?.trim();
    if (!hubTime || !hubTime.includes(':')) return;

    if (c[0]?.trim()) {
      // ARRIVAL row
      const origin = c[2]?.trim();
      if (!origin || origin.length < 3) return;
      results.push({
        arrivalAirline: c[0].trim(), arrivalFlightNo: c[1].trim(),
        arrivalCode: origin, arrivalFreq: parseFreq(c[3]),
        arrivalSeats: safeInt(c[6]), hub_time: hubTime,
        departureCode: '', departureAirline: '', departureFlightNo: '',
        departureFreq: 0, departureSeats: 0,
      });
    } else if (c.length >= 17 && c[14]?.trim()) {
      // DEPARTURE row
      const dest = c[14].trim();
      if (!dest || dest.length < 3) return;
      results.push({
        arrivalAirline: '', arrivalFlightNo: '', arrivalCode: '',
        arrivalFreq: 0, arrivalSeats: 0, hub_time: hubTime,
        departureCode: dest, departureAirline: c[16].trim(),
        departureFlightNo: c[15].trim(), departureFreq: parseFreq(c[13]),
        departureSeats: safeInt(c[10]), arrivalTime: c[9]?.trim() || '',
      });
    }
  });
  return results;
}

// ── Pre-loaded dataset registry ──────────────────────────────────────────────
// Add one object per dataset. id must be unique, match the key in BUNDLED_RAW below.
const PRELOADED_DATASETS = [
  { id: 'blr-jun26', code: 'BLR', period: 'June 2026',  label: 'BLR — June 2026',  fileName: 'BLRbank_june26_JobId3667673.csv' },
  // { id: 'blr-dec26', code: 'BLR', period: 'Dec 2026',   label: 'BLR — Dec 2026',   fileName: 'BLRbank_dec26_JobId999.csv' },
  // { id: 'del-jun26', code: 'DEL', period: 'June 2026',  label: 'DEL — June 2026',  fileName: 'DELbank_june26_JobId888.csv' },
];

const BUNDLED_RAW: Record<string, string> = {
  'blr-jun26': blrJun26Raw,
  // 'blr-dec26': blrDec26Raw,
  // 'del-jun26': delJun26Raw,
};

// Pre-parse at module level so clicking is instant
const PRELOADED_PARSED: Record<string, any[]> = {};
try {
  for (const entry of PRELOADED_DATASETS) {
    const raw = BUNDLED_RAW[entry.id];
    if (raw) PRELOADED_PARSED[entry.id] = parseCSV(raw);
  }
} catch (e) {
  console.error('Pre-parse failed:', e);
}

const App: React.FC = () => {
  const [datasets, setDatasets] = useState<AirportDataset[]>([]);
  const [activeAirportId, setActiveAirportId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'hub' | 'raw'>('hub');
  const [loading, setLoading] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<Region[]>(Object.values(Region).filter(r => r !== Region.Unknown));
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);
  const [marketFilter, setMarketFilter] = useState<MarketSegment>(MarketSegment.All);
  const [alwaysFocusHub, setAlwaysFocusHub] = useState(true);
  const [highlightCatchment, setHighlightCatchment] = useState(false);
  const [airlineDropdownOpen, setAirlineDropdownOpen] = useState(false);
  const [airlineSearch, setAirlineSearch] = useState('');
  const [freqMode, setFreqMode] = useState<'weekly' | 'daily'>('weekly');
  const [manualBlocks, setManualBlocks] = useState<Record<string, Record<number, { arrivals: FlightInfo[], departures: FlightInfo[] }>>>({});
  const [isDraggingTrash, setIsDraggingTrash] = useState(false);
  const [maxConnectionWindow, setMaxConnectionWindow] = useState(6);
  const [mct, setMct] = useState(1.5);
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [snapshotMenuOpen, setSnapshotMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLDivElement>(null);

  const activeDataset = useMemo(() => datasets.find(d => d.id === activeAirportId) || datasets[0] || null, [datasets, activeAirportId]);

  useEffect(() => {
    if (datasets.length > 0 && !datasets.find(d => d.id === activeAirportId)) setActiveAirportId(datasets[0].id);
  }, [datasets, activeAirportId]);

  // Persist/restore
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_SETTINGS);
      if (s) { const p = JSON.parse(s); setMct(p.mct??1.5); setMaxConnectionWindow(p.maxConnectionWindow??6); setSelectedRegions(p.selectedRegions??Object.values(Region).filter(r=>r!==Region.Unknown)); setMarketFilter(p.marketFilter??MarketSegment.All); }
      const b = localStorage.getItem(STORAGE_BLOCKS); if (b) setManualBlocks(JSON.parse(b));
      const sn = localStorage.getItem(STORAGE_SNAPSHOTS); if (sn) setSnapshots(JSON.parse(sn));
      const ds = localStorage.getItem(STORAGE_DATASETS); if (ds) { const d=JSON.parse(ds); setDatasets(d); if(d.length>0) setActiveAirportId(d[0].id); }
    } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify({mct,maxConnectionWindow,selectedRegions,marketFilter})); } catch {} }, [mct,maxConnectionWindow,selectedRegions,marketFilter]);
  useEffect(() => { try { localStorage.setItem(STORAGE_BLOCKS, JSON.stringify(manualBlocks)); } catch {} }, [manualBlocks]);
  useEffect(() => { try { localStorage.setItem(STORAGE_SNAPSHOTS, JSON.stringify(snapshots)); } catch {} }, [snapshots]);
  useEffect(() => { try { localStorage.setItem(STORAGE_DATASETS, JSON.stringify(datasets)); } catch {} }, [datasets]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setAirlineDropdownOpen(false);
      if (snapshotRef.current && !snapshotRef.current.contains(e.target as Node)) setSnapshotMenuOpen(false);
    };
    const handleFS = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('fullscreenchange', handleFS);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('fullscreenchange', handleFS); };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.error);
    else document.exitFullscreen();
  };

  const createSnapshot = () => {
    const name = prompt("Scenario name:", `Scenario ${new Date().toLocaleTimeString()}`);
    if (!name) return;
    setSnapshots(prev => [{ id: Math.random().toString(36).slice(2), name, timestamp: Date.now(), manualBlocks, mct, maxConnectionWindow, selectedRegions, marketFilter }, ...prev]);
    setSnapshotMenuOpen(false);
  };

  const loadSnapshot = (s: WorkspaceSnapshot) => { setManualBlocks(s.manualBlocks); setMct(s.mct); setMaxConnectionWindow(s.maxConnectionWindow); setSelectedRegions(s.selectedRegions); setMarketFilter(s.marketFilter); setSnapshotMenuOpen(false); };
  const deleteSnapshot = (id: string, e: React.MouseEvent) => { e.stopPropagation(); setSnapshots(prev => prev.filter(s => s.id !== id)); };
  const clearWorkspace = () => { if (confirm("Reset workspace? All manual blocks will be removed.")) { setManualBlocks({}); setMct(1.5); setMaxConnectionWindow(6); } };

  const handleManualDrop = (slotIndex: number, type: 'arrival' | 'departure', block: FlightInfo) => {
    if (!activeDataset) return;
    setManualBlocks(prev => {
      const nb = { ...prev };
      const ab = { ...(nb[activeDataset.id] || {}) };
      const safeSlot = block.exactTime ? parseInt(block.exactTime.split(':')[0]) : slotIndex;
      if (!ab[safeSlot]) ab[safeSlot] = { arrivals: [], departures: [] };
      const newBlock: FlightInfo = { ...block, id: block.id || Math.random().toString(36).slice(2), isManual: true, exactTime: block.exactTime || `${safeSlot.toString().padStart(2,'0')}:00`, originalHubTime: block.originalHubTime || `${safeSlot.toString().padStart(2,'0')}:00` };
      if (type === 'arrival') ab[safeSlot].arrivals = [...(ab[safeSlot].arrivals||[]), newBlock];
      else ab[safeSlot].departures = [...(ab[safeSlot].departures||[]), newBlock];
      nb[activeDataset.id] = ab;
      return nb;
    });
  };

  const updateManualFlight = (id: string, updates: Partial<FlightInfo>) => {
    if (!activeDataset) return;
    setManualBlocks(prev => {
      const nb = { ...prev };
      const ab = { ...(nb[activeDataset.id] || {}) };
      Object.keys(ab).forEach(k => {
        const slot = ab[parseInt(k)];
        ['arrivals','departures'].forEach(dir => {
          (slot as any)[dir] = (slot as any)[dir].map((f: FlightInfo) => f.id === id ? { ...f, ...updates } : f);
        });
      });
      nb[activeDataset.id] = ab;
      return nb;
    });
  };

  const deleteManualFlight = (id: string) => {
    if (!activeDataset) return;
    setManualBlocks(prev => {
      const nb = { ...prev };
      const ab = { ...(nb[activeDataset.id] || {}) };
      Object.keys(ab).forEach(k => {
        const slot = ab[parseInt(k)];
        slot.arrivals = slot.arrivals.filter(f => f.id !== id);
        slot.departures = slot.departures.filter(f => f.id !== id);
      });
      nb[activeDataset.id] = ab;
      return nb;
    });
  };

  const processedHubData = useMemo(() => {
    if (!activeDataset) return [];
    const slots: HubSlot[] = TIME_SLOTS.map(time => ({ label: time, arrivals: [], departures: [] }));
    const agg: Record<number, { arrivals: any, departures: any }> = {};
    TIME_SLOTS.forEach((_,i) => agg[i] = { arrivals: {}, departures: {} });

    activeDataset.data.forEach((row: any) => {
      if (!row.hub_time?.includes(':')) return;
      const si = parseInt(row.hub_time.split(':')[0]);
      if (isNaN(si) || si < 0 || si > 23) return;

      (['arrival','departure'] as const).forEach(dir => {
        const code = row[`${dir}Code`]?.toUpperCase();
        if (!code || code.length < 3) return;
        const region = AIRPORT_REGIONS[code] || Region.Unknown;
        const airline = row[`${dir}Airline`];
        const market = INDIAN_AIRPORTS.has(code) ? MarketSegment.Domestic : MarketSegment.International;
        if (!selectedRegions.includes(region) && !(alwaysFocusHub && code === activeDataset.code)) return;
        if (selectedAirlines.length > 0 && airline && !selectedAirlines.includes(airline)) return;
        if (marketFilter !== MarketSegment.All && market !== marketFilter) return;
        const key = `${code}-${row.hub_time}-${row[`${dir}FlightNo`]||'X'}`;
        const target = agg[si][`${dir}s`];
        if (!target[key]) target[key] = { freq:0, seats:0, pax:0, airline, flightNo: row[`${dir}FlightNo`], exactTime: row.hub_time, id: Math.random().toString(36).slice(2) };
        target[key].freq += (row[`${dir}Freq`]||0);
        target[key].seats += (row[`${dir}Seats`]||0);
        target[key].pax += (row[`${dir}Pax`]||0);
      });
    });

    Object.keys(agg).forEach(k => {
      const idx = parseInt(k);
      const manual = (manualBlocks[activeDataset.id]||{})[idx] || { arrivals:[], departures:[] };
      const mapEntries = (obj: any) => Object.entries(obj).map(([ks, val]: [string,any]) => ({ code: ks.split('-')[0], freq:val.freq, seats:val.seats, pax:val.pax, region: AIRPORT_REGIONS[ks.split('-')[0]]||Region.Unknown, airline:val.airline, flightNo:val.flightNo, exactTime:val.exactTime, id:val.id, isManual:false } as FlightInfo));
      slots[idx].arrivals = [...mapEntries(agg[idx].arrivals), ...manual.arrivals];
      slots[idx].departures = [...mapEntries(agg[idx].departures), ...manual.departures];
    });
    return slots;
  }, [activeDataset, selectedRegions, selectedAirlines, marketFilter, alwaysFocusHub, manualBlocks]);

  const uniqueAirlines = useMemo(() => {
    if (!activeDataset) return [];
    return Array.from(new Set(activeDataset.data.flatMap(d => [d.arrivalAirline, d.departureAirline]).filter(Boolean))).sort() as string[];
  }, [activeDataset]);

  const filteredAirlines = useMemo(() => airlineSearch ? uniqueAirlines.filter(a => a.toLowerCase().includes(airlineSearch.toLowerCase())) : uniqueAirlines, [uniqueAirlines, airlineSearch]);

  const loadPreloaded = useCallback((entry: typeof PRELOADED_DATASETS[0]) => {
    if (datasets.find(d => d.id === entry.id)) {
      setActiveAirportId(entry.id);
      return;
    }
    const parsed = PRELOADED_PARSED[entry.id];
    if (!parsed || parsed.length === 0) {
      alert(`No data found for ${entry.label}. Try uploading the CSV manually.`);
      return;
    }
    const ds = { id: entry.id, code: entry.code, fileName: entry.fileName, data: parsed, period: entry.period } as AirportDataset & { period?: string };
    setDatasets(prev => [...prev, ds]);
    setActiveAirportId(entry.id);
  }, [datasets]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading(true);
    const nd: (AirportDataset & { period?: string })[] = [];
    for (const f of files) {
      const text = await f.text();
      const parsed = parseCSV(text);
      if (parsed.length > 0) {
        // Extract airport code and period from filename: e.g. BLRbank_june26_JobId...csv
        const nameUpper = f.name.toUpperCase();
        const codeMatch = nameUpper.match(/^([A-Z]{3})/);
        const code = codeMatch?.[1] || nameUpper.match(/[A-Z]{3}/)?.[0] || 'UNK';

        // Extract period: match patterns like jun26, june26, jan2026, q1_2026
        const periodMatch = f.name.match(/[_-]([a-zA-Z]+\d+)[_-]/i) || f.name.match(/[_-]([a-zA-Z]+\d+)\./i);
        const period = periodMatch ? periodMatch[1].replace(/(\D+)(\d+)/, (_, m, y) =>
          m.charAt(0).toUpperCase() + m.slice(1).toLowerCase() + ' 20' + (y.length === 2 ? y : y.slice(-2))
        ) : '';

        nd.push({ id: Math.random().toString(36).slice(2), code, fileName: f.name, data: parsed, period });
      }
    }
    setDatasets(prev => [...prev, ...nd]);
    setLoading(false);
    e.target.value = '';
  };

  const removeDataset = (id: string, e: React.MouseEvent) => { e.stopPropagation(); setDatasets(prev => prev.filter(d => d.id !== id)); };

  const REGION_LIST = [Region.AsiaPacific, Region.Europe, Region.MiddleEast, Region.Americas, Region.Africa];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-5 py-2 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#006a4e] rounded-lg flex items-center justify-center text-white shadow">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2L2 19h20L12 2z"/></svg>
          </div>
          <div>
            <h1 className="text-base font-black text-slate-800 leading-none tracking-tight">AeroHub</h1>
            <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Hub Bank Visualizer</p>
          </div>
        </div>

        {activeTab === 'hub' && activeDataset && (
          <div className="flex items-center gap-4 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-700">
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">MCT Simulator</span>
            <div className="flex items-center gap-2">
              <div draggable onDragStart={e => { e.dataTransfer.setData('flight', JSON.stringify({ code:'NEW', freq:1, region:Region.AsiaPacific, isManual:true })); }}
                className="bg-[#00ff9d] text-[#004d30] px-3 py-1 rounded text-[9px] font-black uppercase cursor-grab hover:brightness-110">+ Arr</div>
              <div draggable onDragStart={e => { e.dataTransfer.setData('flight', JSON.stringify({ code:'NEW', freq:1, region:Region.AsiaPacific, isManual:true })); }}
                className="bg-indigo-500 text-white px-3 py-1 rounded text-[9px] font-black uppercase cursor-grab hover:brightness-110">+ Dep</div>
            </div>
            <div className="h-4 w-px bg-slate-700" />
            <div className="flex flex-col gap-0.5 min-w-[90px]">
              <span className="text-[7px] font-black text-slate-400 uppercase">MCT: {mct}h</span>
              <input type="range" min="0" max="6" step="0.25" value={mct} onChange={e => setMct(parseFloat(e.target.value))} className="w-full accent-[#00ff9d] h-1 bg-slate-700 rounded cursor-pointer" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-[90px]">
              <span className="text-[7px] font-black text-slate-400 uppercase">Window: {maxConnectionWindow}h</span>
              <input type="range" min="1" max="12" step="0.5" value={maxConnectionWindow} onChange={e => setMaxConnectionWindow(parseFloat(e.target.value))} className="w-full accent-indigo-400 h-1 bg-slate-700 rounded cursor-pointer" />
            </div>
            <div onDragOver={e=>e.preventDefault()} onDragEnter={()=>setIsDraggingTrash(true)} onDragLeave={()=>setIsDraggingTrash(false)}
              onDrop={e => { e.preventDefault(); try { const f=JSON.parse(e.dataTransfer.getData('flight')); if(f.isManual&&f.id) deleteManualFlight(f.id); } catch {} setIsDraggingTrash(false); }}
              className={`w-7 h-7 rounded border flex items-center justify-center transition-all ${isDraggingTrash?'bg-red-500 border-red-400 text-white scale-110':'bg-slate-800 border-slate-600 text-slate-500'}`}>
              <svg width="10" height="10" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative" ref={snapshotRef}>
            <button onClick={() => setSnapshotMenuOpen(!snapshotMenuOpen)} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Scenarios
            </button>
            {snapshotMenuOpen && (
              <div className="absolute top-full right-0 w-68 mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[200] overflow-hidden flex flex-col max-h-[360px]">
                <div className="p-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                  <span className="text-[9px] font-black text-slate-400 uppercase">Snapshot Manager</span>
                  <button onClick={createSnapshot} className="text-[8px] font-black bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-500 uppercase">Capture</button>
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-1.5 no-scrollbar">
                  {snapshots.length === 0 && <p className="text-[9px] text-slate-500 text-center py-4 uppercase font-bold">No saved scenarios</p>}
                  {snapshots.map(s => (
                    <div key={s.id} onClick={() => loadSnapshot(s)} className="p-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-indigo-500 group cursor-pointer">
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-black text-white group-hover:text-indigo-400">{s.name}</span>
                        <button onClick={e => deleteSnapshot(s.id, e)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 text-[10px]">✕</button>
                      </div>
                      <p className="text-[8px] text-slate-500 font-bold mt-1">MCT {s.mct}h · {new Date(s.timestamp).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t border-slate-700 bg-slate-800/50">
                  <button onClick={clearWorkspace} className="w-full py-1.5 text-[8px] font-black text-red-400 hover:text-red-300 uppercase">Reset Workspace</button>
                </div>
              </div>
            )}
          </div>
          <button onClick={toggleFullscreen} className="text-slate-400 hover:text-slate-600 p-1.5">
            {isFullscreen ? '⊠' : '⊞'}
          </button>
          <label className="flex items-center gap-1.5 bg-[#006a4e] hover:bg-[#005a40] text-white px-3 py-1.5 rounded-lg cursor-pointer text-[10px] font-black uppercase shadow-sm">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
            Upload CSV
            <input type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      {/* Airport tabs */}
      {datasets.length > 0 && (
        <div className="bg-slate-50 px-5 border-b border-slate-200 flex items-center gap-0.5 overflow-x-auto no-scrollbar shrink-0 h-9">
          {datasets.map((d: any) => (
            <button key={d.id} onClick={() => setActiveAirportId(d.id)}
              className={`flex items-center gap-1.5 px-4 h-full text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${activeAirportId === d.id ? 'border-[#006a4e] text-[#006a4e] bg-white' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              <span>{d.code}</span>
              {d.period && <span className="text-[8px] font-bold opacity-60 normal-case">{d.period}</span>}
              <span onClick={e => removeDataset(d.id, e)} className="hover:text-red-500 cursor-pointer ml-0.5 opacity-50 hover:opacity-100">✕</span>
            </button>
          ))}
        </div>
      )}

      {/* Sub-nav */}
      <nav className="bg-white border-b border-slate-100 px-5 flex items-center justify-between shrink-0 h-9 z-40">
        <div className="flex h-full">
          {(['hub','raw'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-4 h-full text-[10px] font-black tracking-widest uppercase border-b-2 transition-all ${activeTab===t?'border-[#006a4e] text-[#006a4e]':'border-transparent text-slate-400 hover:text-slate-600'}`}>{t==='hub'?'Hub View':'Raw Data'}</button>
          ))}
        </div>
        {activeTab === 'hub' && activeDataset && (
          <div className="flex items-center gap-3 py-1">
            <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[8px] font-black text-slate-400 uppercase mr-1">Region:</span>
              {REGION_LIST.map(r => (
                <button key={r} onClick={() => setSelectedRegions(prev => prev.includes(r) ? prev.filter(x=>x!==r) : [...prev,r])}
                  className={`px-2 py-0.5 rounded text-[8px] font-black uppercase transition-all border ${selectedRegions.includes(r) ? REGION_COLORS[r] : 'bg-white text-slate-300 border-slate-100'}`}>
                  {r.split('/')[0].slice(0,4)}
                </button>
              ))}
            </div>
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              {Object.values(MarketSegment).map(s => (
                <button key={s} onClick={() => setMarketFilter(s)} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase transition-all ${marketFilter===s?'bg-white text-[#006a4e] shadow-sm':'text-slate-400'}`}>{s}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black text-slate-400 uppercase">Catchment</span>
              <button onClick={() => setHighlightCatchment(!highlightCatchment)} className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${highlightCatchment?'bg-orange-500':'bg-slate-300'}`}>
                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${highlightCatchment?'translate-x-3':'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="relative" ref={dropdownRef}>
              <button onClick={() => setAirlineDropdownOpen(!airlineDropdownOpen)}
                className={`px-2 py-1 rounded border text-[8px] font-black uppercase ${selectedAirlines.length>0?'bg-[#006a4e] border-[#006a4e] text-white':'bg-white border-slate-200 text-slate-600'}`}>
                Airlines ({selectedAirlines.length||'All'})
              </button>
              {airlineDropdownOpen && (
                <div className="absolute top-full right-0 w-56 mt-1 bg-white border border-slate-200 rounded-lg shadow-2xl z-[100] overflow-hidden flex flex-col max-h-[260px]">
                  <div className="p-2 border-b border-slate-100">
                    <input type="text" placeholder="Search..." value={airlineSearch} onChange={e => setAirlineSearch(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] focus:outline-none" />
                  </div>
                  <div className="overflow-y-auto flex-1 p-1">
                    {filteredAirlines.map(a => (
                      <button key={a} onClick={() => setSelectedAirlines(prev => prev.includes(a)?prev.filter(x=>x!==a):[...prev,a])}
                        className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-bold ${selectedAirlines.includes(a)?'bg-[#006a4e]/10 text-[#006a4e]':'text-slate-600 hover:bg-slate-50'}`}>{a}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black text-slate-400 uppercase">Focus Hub</span>
              <button onClick={() => setAlwaysFocusHub(!alwaysFocusHub)} className={`relative inline-flex h-3.5 w-6 items-center rounded-full ${alwaysFocusHub?'bg-[#006a4e]':'bg-slate-300'}`}>
                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${alwaysFocusHub?'translate-x-3':'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-hidden bg-slate-100">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#006a4e]" />
            <p className="text-[10px] font-black uppercase tracking-widest">Processing...</p>
          </div>
        ) : datasets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center m-6">
            <div className="w-full max-w-lg">
              {/* Logo / heading */}
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-[#006a4e] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                  <svg width="28" height="28" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 2L2 19h20L12 2z"/>
                  </svg>
                </div>
                <h2 className="text-xl font-black text-slate-800 tracking-tight">AeroHub Bank Visualizer</h2>
                <p className="text-sm text-slate-400 mt-1">Select a pre-loaded schedule or upload your own CSV</p>
              </div>

              {/* Pre-loaded datasets */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4 shadow-sm">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#006a4e]" />
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pre-loaded datasets</span>
                </div>
                <div className="p-3 space-y-2">
                  {PRELOADED_DATASETS.map(entry => (
                    <button key={entry.id} onClick={() => loadPreloaded(entry)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 hover:bg-[#006a4e]/5 border border-slate-100 hover:border-[#006a4e]/20 transition-all group">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-black text-white">{entry.code}</span>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-black text-slate-800 group-hover:text-[#006a4e]">{entry.label}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase">{entry.fileName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">OAG Schedule</span>
                        <svg width="14" height="14" fill="none" stroke="#006a4e" strokeWidth="2.5" viewBox="0 0 24 24" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">or upload your own</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Upload */}
              <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-300 rounded-2xl bg-white cursor-pointer hover:border-[#006a4e] hover:bg-[#006a4e]/5 transition-all group">
                <svg width="20" height="20" fill="none" stroke="#94a3b8" strokeWidth="2" viewBox="0 0 24 24" className="mb-2 group-hover:stroke-[#006a4e]">
                  <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                <span className="text-xs font-black text-slate-500 uppercase group-hover:text-[#006a4e]">Upload CSV</span>
                <span className="text-[9px] text-slate-400 mt-0.5">Airport code + period auto-detected from filename</span>
                <span className="text-[8px] text-slate-300 mt-0.5">e.g. BLRbank_june26_JobId123.csv</span>
                <input type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        ) : (
          <div className="h-full p-4">
            {activeTab === 'hub' ? (
              <HubBankChart
                data={processedHubData}
                mct={mct}
                maxConnectionWindow={maxConnectionWindow}
                onManualDrop={handleManualDrop}
                onUpdateManual={updateManualFlight}
                onDeleteManual={deleteManualFlight}
                freqMode={freqMode}
                setFreqMode={setFreqMode}
                highlightCatchment={highlightCatchment}
              />
            ) : (
              <DataTable data={activeDataset?.data || []} freqMode={freqMode} />
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
