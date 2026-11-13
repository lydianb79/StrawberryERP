import { useState } from 'react';
import { api } from '../lib.js';
import { Field } from '../components/ui.jsx';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api('/auth/login', { method: 'POST', body: { email, password } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand" style={{ padding: 0, fontSize: 20 }}><img src="/favicon.svg" alt="" /><span>Strawberry<span>ERP</span></span></div>
        <div>
          <h1>Das ERP für Schweizer KMU.</h1>
          <p>Von der Offerte bis zum Jahresabschluss – alle Geschäftsprozesse an einem Ort.</p>
        </div>
        <ul>
          <li>Kunden &amp; Lieferanten</li><li>Lagerverwaltung</li>
          <li>Offerten &amp; Aufträge</li><li>Rechnungsstellung</li>
          <li>Debitoren / Kreditoren</li><li>Bilanz &amp; Erfolgsrechnung</li>
          <li>Jahresabschluss</li><li>Reporting</li>
        </ul>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <div>
            <h1>Anmelden</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>Bitte melden Sie sich mit Ihrem Benutzerkonto an.</p>
          </div>
          {error && <div className="alert error">{error}</div>}
          <Field label="E-Mail">
            <input className="input" type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Passwort">
            <input className="input" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn primary" disabled={busy} style={{ height: 40 }}>{busy ? 'Anmelden…' : 'Anmelden'}</button>
        </form>
      </section>
    </div>
  );
}
