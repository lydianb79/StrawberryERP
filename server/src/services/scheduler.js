// Wiederkehrende Hintergrundaufgaben: fällige Abo-Rechnungen erzeugen, optional Kurse aktualisieren.
import { runDue } from './recurring.js';
import { refreshRates } from './rates.js';
import { getSettings } from './settings.js';

let lastRatesDay = null;

async function tick() {
  try {
    const { created, errors } = await runDue(null);
    if (created.length) console.log(`[scheduler] ${created.length} Abo-Rechnung(en) erstellt`);
    for (const e of errors) console.error(`[scheduler] Abo ${e.recurring_id}: ${e.error}`);
  } catch (err) {
    console.error('[scheduler] Abo-Rechnungen:', err.message);
  }
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (lastRatesDay !== day && (await getSettings()).company.auto_rates) {
      const result = await refreshRates();
      lastRatesDay = day;
      console.log(`[scheduler] Kurse aktualisiert (${result.updated.map((u) => u.code).join(', ') || 'keine'})`);
    }
  } catch (err) {
    console.error('[scheduler] Kursabruf:', err.message);
  }
}

export function startScheduler() {
  if (process.env.SCHEDULER === 'false') return;
  setTimeout(tick, 15000).unref();
  setInterval(tick, 3 * 60 * 60 * 1000).unref();
}
