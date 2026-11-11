// Guard rails for a public, shared demo deployment. All limits are off unless
// their env var is set, so local development is unaffected.
//   SIDELINE_AI_PER_IP_HOURLY   AI calls one visitor can make per hour (e.g. 40)
//   SIDELINE_AI_DAILY_CAP       AI calls the whole deployment can make per day (e.g. 400)
//   SIDELINE_IDLE_RESET_MINUTES reset the demo team after this many idle minutes (e.g. 30)
//   SIDELINE_MAX_CHARGES        most charges the shared demo team can hold (e.g. 25)

interface GuardGlobal {
  __sidelineAi?: { day: string; total: number; perIp: Map<string, number[]> };
  __sidelineLastSeen?: number;
}
const g = globalThis as unknown as GuardGlobal;

const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export class DemoLimitError extends Error {
  status = 429;
}

/** Count `cost` AI calls against this visitor and the whole deployment; throws when over a limit. */
export function chargeAi(req: Request, cost = 1): void {
  const perIp = num(process.env.SIDELINE_AI_PER_IP_HOURLY);
  const daily = num(process.env.SIDELINE_AI_DAILY_CAP);
  if (!perIp && !daily) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!g.__sidelineAi || g.__sidelineAi.day !== today) g.__sidelineAi = { day: today, total: 0, perIp: new Map() };
  const s = g.__sidelineAi;
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (s.perIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (daily && s.total + cost > daily) throw new DemoLimitError("This public demo has used its AI allowance for today. Run it locally (see the README) or try again tomorrow.");
  if (perIp && recent.length + cost > perIp) throw new DemoLimitError("You've used this demo's AI a lot in the last hour. Give it a few minutes, or run Sideline locally from the README.");
  s.total += cost;
  for (let i = 0; i < cost; i++) recent.push(now);
  s.perIp.set(ip, recent);
}

/** True when the shared demo has been idle long enough that the next visitor should get a fresh team. */
export function idleExpired(now = Date.now()): boolean {
  const minutes = num(process.env.SIDELINE_IDLE_RESET_MINUTES);
  const last = g.__sidelineLastSeen;
  g.__sidelineLastSeen = now;
  if (!minutes || last === undefined) return false;
  return now - last > minutes * 60_000;
}

export function maxCharges(): number | null {
  return num(process.env.SIDELINE_MAX_CHARGES);
}
