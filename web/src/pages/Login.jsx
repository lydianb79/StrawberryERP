import { useState } from 'react';
import { api } from '../lib.js';
import { Field } from '../components/ui.jsx';

function Shell({ children }) {
  return (
    <div className="login">
      <section className="login-art">
        <div className="brand" style={{ padding: 0, fontSize: 20 }}><img src="/favicon.svg" alt="" /><span>Strawberry<span>ERP</span></span></div>
        <div>
          <h1>Das ERP für Schweizer KMU.</h1>
          <p>Von der Offerte bis zum Jahresabschluss – alle Geschäftsprozesse an einem Ort.</p>
        </div>
        <ul>
          <li>Kunden &amp; Lieferanten</li><li>Lager &amp; Einkauf</li>
          <li>Offerten &amp; Aufträge</li><li>QR-Rechnung &amp; Mahnwesen</li>
          <li>Debitoren / Kreditoren</li><li>Bilanz &amp; Erfolgsrechnung</li>
          <li>Jahresabschluss</li><li>Reporting</li>
        </ul>
      </section>
      <section className="login-form">{children}</section>
    </div>
  );
}

/** Neues Passwort setzen über den Link aus der E-Mail (/passwort-zuruecksetzen?token=…). */
export function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [form, setForm] = useState({ password: '', repeat: '' });
  const [state, setState] = useState({ error: '', done: false, busy: false });
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.repeat) return setState({ ...state, error: 'Die Passwörter stimmen nicht überein.' });
    setState({ error: '', done: false, busy: true });
    try {
      await api('/auth/reset', { method: 'POST', body: { token, password: form.password } });
      return setState({ error: '', done: true, busy: false });
    } catch (err) { return setState({ error: err.message, done: false, busy: false }); }
  };
  return (
    <Shell>
      <form onSubmit={submit}>
        <div><h1>Neues Passwort setzen</h1></div>
        {state.error && <div className="alert error">{state.error}</div>}
        {state.done ? (
          <>
            <div className="alert ok">Ihr Passwort wurde geändert. Alle bisherigen Sitzungen wurden beendet.</div>
            <a className="btn primary" href="/" style={{ height: 40 }}>Zur Anmeldung</a>
          </>
        ) : (
          <>
            <Field label="Neues Passwort (mind. 10 Zeichen)"><input className="input" type="password" autoComplete="new-password" required minLength={10} autoFocus value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Passwort wiederholen"><input className="input" type="password" autoComplete="new-password" required value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} /></Field>
            <button className="btn primary" disabled={state.busy || !token} style={{ height: 40 }}>Passwort speichern</button>
            {!token && <div className="alert error">Der Link ist unvollständig. Bitte fordern Sie einen neuen an.</div>}
          </>
        )}
      </form>
    </Shell>
  );
}

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [mode, setMode] = useState('login'); // login | forgot | sent
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, code: needCode ? code : undefined }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return onLogin(data);
      if (data.twoFactorRequired) {
        if (needCode) setError(data.error);
        setNeedCode(true);
        return undefined;
      }
      return setError(data.error || `Fehler ${res.status}`);
    } catch (err) {
      return setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot', { method: 'POST', body: { email } });
      setMode('sent');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (mode !== 'login') {
    return (
      <Shell>
        <form onSubmit={forgot}>
          <div>
            <h1>Passwort vergessen</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>Wir senden Ihnen einen Link, mit dem Sie ein neues Passwort setzen können.</p>
          </div>
          {error && <div className="alert error">{error}</div>}
          {mode === 'sent' ? (
            <div className="alert ok">Falls zu dieser Adresse ein Konto besteht, ist eine E-Mail mit dem Link unterwegs. Er ist 60 Minuten gültig. Kommt nichts an, wenden Sie sich an Ihren Administrator.</div>
          ) : (
            <>
              <Field label="E-Mail"><input className="input" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <button className="btn primary" disabled={busy} style={{ height: 40 }}>Link anfordern</button>
            </>
          )}
          <button type="button" className="btn ghost" onClick={() => { setMode('login'); setError(''); }}>Zurück zur Anmeldung</button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit}>
        <div>
          <h1>Anmelden</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{needCode ? 'Bitte geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.' : 'Bitte melden Sie sich mit Ihrem Benutzerkonto an.'}</p>
        </div>
        {error && <div className="alert error">{error}</div>}
        {!needCode ? (
          <>
            <Field label="E-Mail">
              <input className="input" type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Passwort">
              <input className="input" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Sicherheitscode">
            <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        <button className="btn primary" disabled={busy} style={{ height: 40 }}>{busy ? 'Anmelden…' : needCode ? 'Bestätigen' : 'Anmelden'}</button>
        {needCode
          ? <button type="button" className="btn ghost" onClick={() => { setNeedCode(false); setCode(''); setError(''); }}>Zurück</button>
          : <button type="button" className="btn ghost" onClick={() => { setMode('forgot'); setError(''); }}>Passwort vergessen?</button>}
      </form>
    </Shell>
  );
}
