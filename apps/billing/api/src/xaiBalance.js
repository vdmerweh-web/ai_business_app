// Twice-daily Grok prepaid-balance check at 07:00 and 19:00 Africa/Johannesburg (SAST).
// Runs inside the API process so it uses the server's IP (allowed on the management key).
// If XAI_MANAGEMENT_KEY is empty, the job records status 'key needed' and skips the HTTP call.
import {q} from './db.js';

const TZ = 'Africa/Johannesburg';
const HOURS = [7, 19];
const DEFAULT_TEAM = '43eb7c23-1ec6-46f2-8596-5e8aa3b2ae5c';
const URL_BASE = 'https://management-api.x.ai/v1/billing/teams';

function serverName() {
  if (process.env.SERVER_NAME) return String(process.env.SERVER_NAME).slice(0, 80);
  return '';
}

function teamId() {
  return (process.env.XAI_TEAM_ID || DEFAULT_TEAM).trim();
}

function zarRate() {
  const n = Number(process.env.XAI_ZAR_PER_USD);
  return Number.isFinite(n) && n > 0 ? n : 17.5;
}

// xAI returns total.val in USD cents on an inverted ledger: -1000 means $10.00 left.
export function remainingUsdFromCents(val) {
  const cents = Number(val);
  if (!Number.isFinite(cents)) return null;
  return cents < 0 ? Math.abs(cents) / 100 : 0;
}

export async function xaiBalanceInit() {
  await q(`
    create table if not exists xai_balance_checks (
      id bigserial primary key,
      checked_at timestamptz not null default now(),
      team_id text,
      raw_cents text,
      balance_usd numeric(12,4),
      balance_zar numeric(12,4),
      zar_per_usd numeric(12,4),
      status text not null,
      error_message text,
      server_name text,
      http_status int
    );
    create index if not exists xai_balance_checks_time on xai_balance_checks(checked_at desc);
  `);
  startScheduler();
}

async function record(row) {
  const [saved] = await q(`
    insert into xai_balance_checks(
      team_id, raw_cents, balance_usd, balance_zar, zar_per_usd,
      status, error_message, server_name, http_status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    returning *
  `, [
    row.team_id || null, row.raw_cents ?? null, row.balance_usd ?? null,
    row.balance_zar ?? null, row.zar_per_usd ?? null, row.status,
    row.error_message || null, serverName(), row.http_status ?? null,
  ]);
  return saved;
}

export async function checkXaiBalance() {
  const key = (process.env.XAI_MANAGEMENT_KEY || '').trim();
  const team = teamId();
  if (!key) {
    return record({
      team_id: team || null,
      status: 'key_needed',
      error_message: 'A management key needs to be set.',
    });
  }
  if (!team) {
    return record({status: 'error', error_message: 'XAI_TEAM_ID is missing.'});
  }
  try {
    const r = await fetch(`${URL_BASE}/${encodeURIComponent(team)}/prepaid/balance`, {
      method: 'GET',
      signal: AbortSignal.timeout(20_000),
      headers: {Authorization: 'Bearer ' + key, Accept: 'application/json'},
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || data?.error || `The xAI billing service returned ${r.status}`;
      return record({
        team_id: team,
        status: 'error',
        http_status: r.status,
        error_message: String(msg).slice(0, 400),
      });
    }
    const raw = data?.total?.val;
    const usd = remainingUsdFromCents(raw);
    const rate = zarRate();
    return record({
      team_id: team,
      raw_cents: raw == null ? null : String(raw),
      balance_usd: usd,
      balance_zar: usd == null ? null : Math.round(usd * rate * 10000) / 10000,
      zar_per_usd: rate,
      status: 'ok',
      http_status: r.status,
    });
  } catch (e) {
    return record({
      team_id: team,
      status: 'error',
      error_message: String(e.message || e).slice(0, 400),
    });
  }
}

function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    checked_at: row.checked_at instanceof Date ? row.checked_at.toISOString() : row.checked_at,
    team_id: row.team_id,
    raw_cents: row.raw_cents,
    balance_usd: row.balance_usd == null ? null : +row.balance_usd,
    balance_zar: row.balance_zar == null ? null : +row.balance_zar,
    zar_per_usd: row.zar_per_usd == null ? null : +row.zar_per_usd,
    status: row.status,
    error_message: row.error_message,
    server_name: row.server_name,
    http_status: row.http_status,
  };
}

export async function xaiBalanceSummary() {
  const [latest] = await q('select * from xai_balance_checks order by checked_at desc, id desc limit 1');
  const history = await q('select * from xai_balance_checks order by checked_at desc, id desc limit 60');
  return {latest: publicRow(latest), history: history.map(publicRow), nextChecks: '07:00 and 19:00 Africa/Johannesburg (SAST)'};
}

function nextSlotMs() {
  const now = Date.now();
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const day = new Date(now + i * 864e5);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23',
      }).formatToParts(day).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
    );
    for (const h of HOURS) {
      const t = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${String(h).padStart(2, '0')}:00:00+02:00`);
      if (t > now + 15_000) slots.push(t);
    }
  }
  return Math.min(...slots) - now;
}

function startScheduler() {
  const run = async () => {
    try {
      await checkXaiBalance();
    } catch (e) {
      console.error('xai balance check failed', e.message || e);
    }
    const wait = Math.max(15_000, nextSlotMs());
    setTimeout(run, wait);
  };
  // One check shortly after boot so the usage page has a row, then 07:00 / 19:00 SAST.
  setTimeout(run, 8_000);
}

export {startScheduler as startXaiBalanceScheduler};
