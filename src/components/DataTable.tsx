import React, { useState } from 'react';

interface DataTableProps {
  data: any[];
  freqMode: 'weekly' | 'daily';
}

const DataTable: React.FC<DataTableProps> = ({ data, freqMode }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PER_PAGE = 50;

  const filtered = data.filter(row => {
    if (!search) return true;
    return Object.values(row).some(v => String(v).toLowerCase().includes(search.toLowerCase()));
  });

  const paged = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  if (data.length === 0) return (
    <div className="h-full flex items-center justify-center text-slate-400">
      <p className="text-sm font-bold">No data loaded</p>
    </div>
  );

  const cols = ['hub_time', 'arrivalCode', 'arrivalAirline', 'arrivalFreq', 'arrivalSeats', 'departureCode', 'departureAirline', 'departureFreq', 'departureSeats'];

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <span className="text-xs font-bold text-slate-400">{filtered.length.toLocaleString()} rows</span>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-[11px] font-mono">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              {cols.map(c => (
                <th key={c} className="px-3 py-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                {cols.map(c => (
                  <td key={c} className="px-3 py-1.5 text-slate-700 border-b border-slate-100 whitespace-nowrap">
                    {c.includes('Freq') && freqMode === 'daily'
                      ? ((Number(row[c]) || 0) / 7).toFixed(1)
                      : (row[c] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="p-3 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1 text-xs font-bold bg-slate-100 rounded disabled:opacity-40">Prev</button>
          <span className="text-xs text-slate-400 font-bold">Page {page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
            className="px-3 py-1 text-xs font-bold bg-slate-100 rounded disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
};

export default DataTable;
