import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

export function StatusBadge({ status, overdue }) {
  const [label, color] = STATUS[overdue ? 'overdue' : status] || [status, ''];
  return <span className={`badge ${color}`}>{label}</span>;
}

// ---------- Datentabelle ----------
/**
 * columns: [{ key, label, render?, num?, csv? }]
 */
export function DataTable({ columns, rows, onRowClick, empty = 'Keine Einträge vorhanden.', footer, exportName, toolbar, searchable = true }) {
  const [term, setTerm] = useState('');
  const filtered = useMemo(() => {
    if (!term.trim() || !rows) return rows || [];
    const t = term.toLowerCase();
    return rows.filter((r) => Object.values(r).some((v) => v != null && typeof v !== 'object' && String(v).toLowerCase().includes(t)));
  }, [rows, term]);
  return (
    <div className="card">
      {(searchable || toolbar || exportName) && (
        <div className="card-head no-print">
          {searchable && <input className="input search" placeholder="Suchen…" value={term} onChange={(e) => setTerm(e.target.value)} />}
          {toolbar}
          <div className="spacer" />
          <span className="muted small">{filtered.length} {filtered.length === 1 ? 'Eintrag' : 'Einträge'}</span>
          {exportName && (
            <button className="btn sm" onClick={() => downloadCsv(`${exportName}.csv`, columns.filter((c) => c.label), filtered)}>
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
            {filtered.map((row, i) => (
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
