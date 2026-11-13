import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { STATUS, downloadCsv } from '../lib.js';

// ---------- Icons (24er Raster, Linienstil) ----------
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.870M16 3.130a4 4 0 0 1 0 7.750',
  truck: 'M1 4h13v12H1zM14 8h4l4 4v4h-8M5.500 19.500a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17.500 19.500a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  cart: 'M3 4h2l2.500 12h11l2-8H6.500M9 20.500a1 1 0 1 0 0-2 1 1 0 0 0 0 2M18 20.500a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  receipt: 'M5 3v18l2.500-1.500L10 21l2-1.500L14 21l2.500-1.500L19 21V3zM9 8h6M9 12h6M9 16h3',
  in: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  out: 'M12 15V3M7 8l5-5 5 5M4 21h16',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h6z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.010M3 12h.010M3 18h.010',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3.500 3.500 0 0 0 6 0zM19 7l-3 7a3.500 3.500 0 0 0 6 0zM8 21h8',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z',
  building: 'M4 21V5l8-2v18M12 9h8v12M8 8v.010M8 12v.010M8 16v.010M16 13v.010M16 17v.010M2 21h20',
  layout: 'M3 4h18v16H3zM3 9h18M9 9v11',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  x: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  pdf: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  key: 'M15 7a4 4 0 1 1-3.800 5.200L7 16.500V19H4.500v-2.500H2V14l6.800-6.800A4 4 0 0 1 15 7z',
  check: 'M5 12l5 5 9-10',
  back: 'M15 5l-7 7 7 7',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  coins: 'M9 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12M15.500 10.200A6 6 0 1 1 10.200 21',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  refresh: 'M20 11a8 8 0 0 0-14.900-3M4 4v4h4M4 13a8 8 0 0 0 14.900 3M20 20v-4h-4',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  clip: 'M20 11l-8.500 8.500a5 5 0 0 1-7-7L13 4a3.500 3.500 0 0 1 5 5l-8.500 8.500a2 2 0 0 1-3-3L14 7',
  undo: 'M4 8h10a6 6 0 0 1 0 12H8M4 8l4-4M4 8l4 4',
  tag: 'M3 12V4h8l10 10-8 8zM7.500 7.500h.010',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16M12 9v4l2.500 2M9 2h6',
  folder: 'M3 6h6l2 3h10v10H3z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l11-4 2 4M16 13.500h2',
  clipboard: 'M9 4h6v3H9zM7 5.500H5V21h14V5.500h-2M8.500 12l2 2 4.500-4.500',
  warehouse: 'M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 17h10',
  bank: 'M3 10l9-6 9 6M5 10v8M9.500 10v8M14.500 10v8M19 10v8M3 20h18',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.file} />
    </svg>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6500 : 3500);
  }, []);
  const value = useMemo(() => Object.assign((m) => push(m), { error: (m) => push(m, 'error') }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Formularfelder ----------
export function Field({ label, hint, className = '', children }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Generisches Eingabefeld gemäss Feldkonfiguration { name, label, type, options, required, span, hint }. */
export function AutoField({ field, value, onChange, disabled }) {
  const { type = 'text', label, options, required, span, hint, placeholder } = field;
  const cls = span === 2 ? 'span-2' : span === 'all' ? 'span-all' : '';
  if (type === 'checkbox') {
    return (
      <div className={`field ${cls}`} style={{ justifyContent: 'flex-end' }}>
        <label className="check">
          <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
        </label>
      </div>
    );
  }
  let input;
  if (type === 'select') {
    input = (
      <select className="input" value={value ?? ''} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {!required && <option value="">–</option>}
        {required && (value === '' || value == null) && <option value="">Bitte wählen…</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (type === 'textarea') {
    input = <textarea className="input" rows={3} value={value ?? ''} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  } else {
    input = (
      <input className={`input ${type === 'number' ? 'num' : ''}`} type={type} step={type === 'number' ? 'any' : undefined}
        value={value ?? ''} required={required} disabled={disabled} placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : 'off'} onChange={(e) => onChange(e.target.value)} />
    );
  }
  return <Field label={label + (required ? ' *' : '')} hint={hint} className={cls}>{input}</Field>;
}

export function StatusBadge({ status, overdue, type }) {
  const [label, color] = STATUS[overdue ? 'overdue' : `${type}:${status}`] || STATUS[overdue ? 'overdue' : status] || [status, ''];
  return <span className={`badge ${color}`}>{label}</span>;
}

// ---------- Datentabelle ----------
const PAGE_SIZE = 50;

/**
 * columns: [{ key, label, render?, num?, csv? }]
 * Grosse Listen werden seitenweise angezeigt. Mit onSearch sucht die Tabelle auf dem Server statt in den geladenen Zeilen.
 */
export function DataTable({ columns, rows, onRowClick, empty = 'Keine Einträge vorhanden.', footer, exportName, toolbar, searchable = true, onSearch, note, paging, onExport }) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!onSearch) return undefined;
    const timer = setTimeout(() => onSearch(term.trim()), 350);
    return () => clearTimeout(timer);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => {
    if (onSearch || !term.trim() || !rows) return rows || [];
    const t = term.toLowerCase();
    return rows.filter((r) => Object.values(r).some((v) => v != null && typeof v !== 'object' && String(v).toLowerCase().includes(t)));
  }, [rows, term, onSearch]);
  useEffect(() => { setPage(0); }, [term, rows]);
  // paging = { page, pageSize, total, onPage }: die Zeilen sind bereits die aktuelle Seite vom Server
  const size = paging?.pageSize || PAGE_SIZE;
  const count = paging ? paging.total : filtered.length;
  const pages = Math.max(1, Math.ceil(count / size));
  const current = paging ? paging.page : Math.min(page, pages - 1);
  const visible = paging ? filtered : filtered.slice(current * size, (current + 1) * size);
  const go = (n) => (paging ? paging.onPage(n) : setPage(n));
  return (
    <div className="card">
      {(searchable || toolbar || exportName) && (
        <div className="card-head no-print">
          {searchable && <input className="input search" placeholder="Suchen…" value={term} onChange={(e) => setTerm(e.target.value)} />}
          {toolbar}
          <div className="spacer" />
          <span className="muted small">{count} {count === 1 ? 'Eintrag' : 'Einträge'}{note ? ` · ${note}` : ''}</span>
          {exportName && (
            <button className="btn sm" onClick={async () => downloadCsv(`${exportName}.csv`, columns.filter((c) => c.label), onExport ? await onExport() : filtered)}>
              <Icon name="download" /> CSV
            </button>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.id ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.num ? 'num' : ''} ${c.key === '_actions' ? 'actions' : ''}`}
                    onClick={c.key === '_actions' ? (e) => e.stopPropagation() : undefined}>
                    {c.render ? c.render(row) : row[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && filtered.length > 0 && <tfoot>{footer(filtered)}</tfoot>}
        </table>
        {rows && filtered.length === 0 && <div className="empty">{empty}</div>}
        {!rows && <div className="empty">Lädt…</div>}
      </div>
      {pages > 1 && (
        <div className="pager no-print">
          <button className="btn sm" disabled={current === 0} onClick={() => go(current - 1)}>Zurück</button>
          <span className="muted small">Seite {current + 1} von {pages} · Zeilen {current * size + 1}–{Math.min(count, (current + 1) * size)}</span>
          <button className="btn sm" disabled={current >= pages - 1} onClick={() => go(current + 1)}>Weiter</button>
        </div>
      )}
    </div>
  );
}

/**
 * Auswahlfeld mit Suche – für lange Listen (Kunden, Artikel). options: [{ value, label, hint? }]
 */
export function Combo({ options: fixed = [], value, onChange, placeholder = 'Suchen…', disabled, emptyLabel, load, label }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [box, setBox] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const ref = useRef(null);
  // load(query) liefert die Treffer vom Server (für sehr grosse Stammdaten); label ist der Text des aktuell gewählten Werts
  useEffect(() => {
    if (!load || !open) return undefined;
    let active = true;
    const timer = setTimeout(() => load(query.trim()).then((list) => active && setLoaded(list)).catch(() => active && setLoaded([])), query ? 220 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [load, open, query]);
  const options = load ? loaded || [] : fixed;
  const selected = options.find((o) => String(o.value) === String(value)) || (label && value ? { value, label } : fixed.find((o) => String(o.value) === String(value)));
  const matches = useMemo(() => {
    const t = query.trim().toLowerCase();
    const list = t && !load ? options.filter((o) => `${o.label} ${o.hint || ''}`.toLowerCase().includes(t)) : options;
    return list.slice(0, 60);
  }, [options, query, load]);
  const show = () => {
    if (disabled) return;
    const r = ref.current.getBoundingClientRect();
    setBox({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 260) });
    setQuery('');
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target.closest?.('.combo-list')) setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  const pick = (v) => { onChange(v, options.find((o) => String(o.value) === String(v))?.row); setOpen(false); };
  return (
    <div className="combo" ref={ref}>
      <input className="input" disabled={disabled} placeholder={selected ? selected.label : placeholder} title={selected?.label}
        value={open ? query : selected?.label || ''} onFocus={show} onChange={(e) => { setQuery(e.target.value); if (!open) show(); }}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); e.target.blur(); } if (e.key === 'Enter' && open && matches[0]) { e.preventDefault(); pick(matches[0].value); e.target.blur(); } }} />
      {open && box && (
        <div className="combo-list" style={{ left: box.left, top: box.top, width: box.width }}>
          {emptyLabel && <div className="combo-item muted" onMouseDown={(e) => { e.preventDefault(); pick(''); }}>{emptyLabel}</div>}
          {matches.map((o) => (
            <div key={o.value} className={`combo-item ${String(o.value) === String(value) ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}>
              {o.label}{o.hint && <span className="muted small"> · {o.hint}</span>}
            </div>
          ))}
          {!matches.length && <div className="combo-item muted">{load && loaded === null ? 'Lädt…' : 'Keine Treffer'}</div>}
          {matches.length === 60 && <div className="combo-item muted small">Weitere Treffer – bitte Suche verfeinern</div>}
        </div>
      )}
    </div>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="spacer" />
      <div className="row no-print">{children}</div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs no-print">
      {tabs.map(([key, label]) => (
        <button key={key} className={`tab ${value === key ? 'active' : ''}`} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  );
}

/** Einfaches Balkendiagramm (SVG). data: [{ label, value }] */
export function BarChart({ data, height = 220, format = (v) => v }) {
  const W = 720, H = height, padL = 56, padB = 26, padT = 12;
  const max = Math.max(1, ...data.map((d) => d.value));
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 4, 6, 8, 10].map((m) => m * mag).find((t) => t >= max);
  const ticks = [0, .25, .5, .75, 1].map((f) => top * f);
  const innerW = W - padL - 8, innerH = H - padB - padT;
  const step = innerW / Math.max(1, data.length);
  const bw = Math.min(46, step * 0.62);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t) => {
        const y = padT + innerH - (t / top) * innerH;
        return (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={W - 8} y1={y} y2={y} />
            <text x={padL - 8} y={y + 4} textAnchor="end">{format(t)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / top) * innerH;
        const x = padL + i * step + (step - bw) / 2;
        return (
          <g key={d.label}>
            <rect className="bar" x={x} y={padT + innerH - h} width={bw} height={Math.max(0, h)} rx="3">
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            <text x={x + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
