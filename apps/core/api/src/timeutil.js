// Small time-zone helpers (no extra packages).
export function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'});
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second, wd: o.weekday.toLowerCase().slice(0, 3)};
}
// Local wall time in a zone -> UTC milliseconds.
export function zonedToUtc(y, m, d, h, min, tz) {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = tzParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return guess;
}
export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 60) return false;
  try { new Intl.DateTimeFormat('en', {timeZone: tz}); return true; } catch { return false; }
}
