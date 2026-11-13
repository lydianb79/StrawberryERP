import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib.js';
import { useAuth } from '../auth.js';
import { AutoField, DataTable, Icon, Modal, PageHead, useToast } from './ui.jsx';

/**
 * Generische Stammdaten-Seite: Liste + Formular im Dialog.
 * props: title, subtitle, endpoint, writePerm, columns, fields, defaults, newLabel, rowActions(row, reload), exportName
 */
export default function CrudPage({ title, subtitle, endpoint, writePerm, columns, fields, defaults = {}, newLabel = 'Neu', rowActions, exportName, canDelete = true, headerActions }) {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const writable = can(writePerm);

  const load = useCallback(() => api(endpoint).then(setRows).catch((e) => { setRows([]); toast.error(e.message); }), [endpoint, toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = Object.fromEntries(fields.map((f) => [f.name, editing[f.name] ?? (f.type === 'checkbox' ? false : '')]));
      if (editing.id) await api(`${endpoint}/${editing.id}`, { method: 'PUT', body });
      else await api(endpoint, { method: 'POST', body });
      toast('Gespeichert.');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async (row) => {
    if (!window.confirm('Diesen Eintrag wirklich löschen?')) return;
    try {
      await api(`${endpoint}/${row.id}`, { method: 'DELETE' });
      toast('Gelöscht.');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const cols = [...columns];
  if (rowActions) cols.push({ key: '_actions', label: '', render: (row) => rowActions(row, load) });

  return (
    <>
      <PageHead title={title} subtitle={subtitle}>
        {writable && headerActions}
        {writable && <button className="btn primary" onClick={() => setEditing({ ...defaults })}><Icon name="plus" /> {newLabel}</button>}
      </PageHead>
      <DataTable columns={cols} rows={rows} exportName={exportName} onRowClick={(row) => setEditing({ ...row })} />
      {editing && (
        <Modal title={editing.id ? `${title}: bearbeiten` : newLabel} onClose={() => setEditing(null)} wide={fields.length > 8}>
          <form onSubmit={save}>
            <div className="form-grid">
              {fields.filter((f) => !f.onlyNew || !editing.id).map((f) => (
                <AutoField key={f.name} field={f} value={editing[f.name]} disabled={!writable}
                  onChange={(v) => setEditing((cur) => ({ ...cur, [f.name]: v }))} />
              ))}
            </div>
            <div className="row" style={{ marginTop: 20 }}>
              {writable && canDelete && editing.id && <button type="button" className="btn danger" onClick={() => remove(editing)}><Icon name="trash" /> Löschen</button>}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setEditing(null)}>{writable ? 'Abbrechen' : 'Schliessen'}</button>
              {writable && <button className="btn primary" disabled={busy}>Speichern</button>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
