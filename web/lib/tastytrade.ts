// ============================================================================
// Conector tastytrade — tiempo real vía DXLink (WebSocket). SOLO LECTURA.
// Portado de Evolet (futuros/tastytrade.py). Da precio real de futuros (MES/MNQ)
// y gamma + Open Interest de las opciones del índice (SPX/NDX) para GEX real.
//
// Claves en el entorno (server-only): TASTYTRADE_CLIENT_SECRET,
// TASTYTRADE_REFRESH_TOKEN, TASTYTRADE_ENV. Nunca se exponen al cliente.
// ============================================================================

import WebSocket from "ws";

const BASE: Record<string, string> = {
  production: "https://api.tastyworks.com",
  sandbox: "https://api.cert.tastyworks.com",
};

export class TastyError extends Error {}

function env(k: string): string {
  return (process.env[k] ?? "").trim();
}

export function hasTastytrade(): boolean {
  return Boolean(env("TASTYTRADE_CLIENT_SECRET") && env("TASTYTRADE_REFRESH_TOKEN"));
}

function base(): string {
  return BASE[env("TASTYTRADE_ENV") || "production"] ?? BASE.production;
}

// ── OAuth + quote token (REST), con caché en memoria ─────────────────────────
let tok: { access: string; exp: number } | null = null;
let qt: { token: string; url: string; exp: number } | null = null;

export async function accessToken(): Promise<string> {
  if (tok && Date.now() < tok.exp - 30_000) return tok.access;
  if (!hasTastytrade()) throw new TastyError("Faltan las claves TASTYTRADE_* en el entorno.");
  const res = await fetch(`${base()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: env("TASTYTRADE_REFRESH_TOKEN"),
      client_secret: env("TASTYTRADE_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });
  const j: { access_token?: string; expires_in?: number } = await res.json().catch(() => ({}));
  if (!j.access_token) throw new TastyError("Sin access_token de tastytrade.");
  tok = { access: j.access_token, exp: Date.now() + (j.expires_in ?? 900) * 1000 };
  return tok.access;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new TastyError(`tastytrade ${res.status} en ${path}`);
  return (await res.json()) as T;
}

export async function quoteToken(): Promise<{ token: string; url: string }> {
  if (qt && Date.now() < qt.exp - 30_000) return { token: qt.token, url: qt.url };
  const d = await getJson<{ data?: { token?: string; "dxlink-url"?: string; "websocket-url"?: string } }>(
    "/api-quote-tokens",
  );
  const token = d.data?.token;
  const url = d.data?.["dxlink-url"] ?? d.data?.["websocket-url"];
  if (!token || !url) throw new TastyError("Sin token/url de DXLink.");
  qt = { token, url, exp: Date.now() + 20 * 60_000 };
  return { token, url };
}

/** Símbolo de streaming (dxfeed) de un futuro, ej. '/MESU6' → '/MESU6:XCME'. */
export async function streamerSymbol(symbol: string): Promise<string> {
  try {
    const d = await getJson<{ data?: { "streamer-symbol"?: string } }>(
      `/instruments/futures/${encodeURIComponent(symbol)}`,
    );
    const s = d.data?.["streamer-symbol"];
    if (s) return s;
  } catch {
    // cae al respaldo
  }
  return symbol.startsWith("/") ? `${symbol}:XCME` : symbol;
}

// ── DXLink: abre un WS, autentica, suscribe y recolecta eventos ──────────────
type EventObj = Record<string, unknown>;

interface CollectOpts {
  url: string;
  token: string;
  eventFields: Record<string, string[]>;
  subscriptions: { type: string; symbol: string; fromTime?: number }[];
  /** Devuelve true cuando ya recolectó lo necesario (corta antes del timeout). */
  done: (events: EventObj[]) => boolean;
  timeoutMs?: number;
  aggregationPeriod?: number;
}

/** Abre DXLink, se suscribe y junta los FEED_DATA hasta `done` o timeout. */
function dxlinkCollect(opts: CollectOpts): Promise<EventObj[]> {
  const { url, token, eventFields, subscriptions, done } = opts;
  const timeoutMs = opts.timeoutMs ?? 8000;
  return new Promise((resolve) => {
    const events: EventObj[] = [];
    let settled = false;
    const ws = new WebSocket(url);
    const finish = () => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    let channelOpen = false;
    let authorized = false;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "SETUP", channel: 0, version: "0.1-tito", keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
      ws.send(JSON.stringify({ type: "AUTH", channel: 0, token }));
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      let m: EventObj;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      const t = m.type as string;
      if (t === "KEEPALIVE") {
        ws.send(JSON.stringify({ type: "KEEPALIVE", channel: 0 }));
      } else if (t === "AUTH_STATE" && m.state === "AUTHORIZED" && !authorized) {
        authorized = true;
        ws.send(JSON.stringify({ type: "CHANNEL_REQUEST", channel: 1, service: "FEED", parameters: { contract: "AUTO" } }));
      } else if (t === "CHANNEL_OPENED" && !channelOpen) {
        channelOpen = true;
        ws.send(JSON.stringify({
          type: "FEED_SETUP", channel: 1,
          acceptAggregationPeriod: opts.aggregationPeriod ?? 0.1,
          acceptDataFormat: "FULL",
          acceptEventFields: eventFields,
        }));
        ws.send(JSON.stringify({
          type: "FEED_SUBSCRIPTION", channel: 1,
          add: subscriptions.map((s) => s.fromTime != null
            ? { type: s.type, symbol: s.symbol, fromTime: s.fromTime }
            : { type: s.type, symbol: s.symbol }),
        }));
      } else if (t === "FEED_DATA") {
        const data = m.data as EventObj[] | undefined;
        if (Array.isArray(data)) {
          for (const ev of data) events.push(ev);
          if (done(events)) { clearTimeout(timer); finish(); }
        }
      }
    });

    ws.on("error", () => { clearTimeout(timer); finish(); });
    ws.on("close", () => { clearTimeout(timer); finish(); });
  });
}

function num(x: unknown): number | null {
  const n = typeof x === "string" ? parseFloat(x) : (x as number);
  return Number.isFinite(n) ? n : null;
}

/** Precio en TIEMPO REAL de un futuro (Trade o mid del Quote). null si falla. */
export async function precio(rootSymbol: string, timeoutMs = 6000): Promise<number | null> {
  if (!hasTastytrade()) return null;
  try {
    const { token, url } = await quoteToken();
    const sym = rootSymbol.startsWith("/") ? await streamerSymbol(rootSymbol) : rootSymbol;
    const events = await dxlinkCollect({
      url, token, timeoutMs,
      eventFields: {
        Trade: ["eventType", "eventSymbol", "price"],
        Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice"],
      },
      subscriptions: [{ type: "Trade", symbol: sym }, { type: "Quote", symbol: sym }],
      done: (evs) => evs.some((e) => e.eventType === "Trade" && num(e.price) != null),
    });
    for (const e of events) if (e.eventType === "Trade") { const p = num(e.price); if (p) return p; }
    for (const e of events) if (e.eventType === "Quote") {
      const b = num(e.bidPrice), a = num(e.askPrice);
      if (b && a && b > 0 && a > 0) return (b + a) / 2;
    }
    return null;
  } catch {
    return null;
  }
}

// ── GEX: gamma + Open Interest de las opciones del índice (SPX / NDX) ─────────
export interface OptionGO {
  strike: number;
  type: "C" | "P";
  gamma: number;
  oi: number;
  exp: string;
}

interface NestedChain {
  data?: {
    items?: {
      expirations?: {
        "days-to-expiration"?: number;
        "expiration-date"?: string;
        strikes?: {
          "strike-price"?: string;
          "call-streamer-symbol"?: string;
          "put-streamer-symbol"?: string;
        }[];
      }[];
    }[];
  };
}

/**
 * Gamma + OI de las opciones del índice cerca del precio (ventana ±winPct),
 * para calcular GEX. underlying = "SPX" (S&P/MES) o "NDX" (Nasdaq/MNQ).
 * Devuelve { options, spot }.
 */
// Spot aproximado por subyacente, solo como respaldo si el Trade no llega a
// tiempo (sin él, la ventana ATM saldría vacía). QQQ/SPY son los ETF líquidos
// que usamos como fuente de GEX cuando el índice tiene poco OI.
const SPOT_FALLBACK: Record<string, number> = { NDX: 24000, SPX: 6800, QQQ: 520, SPY: 580 };

export async function opcionesGammaOI(
  underlying: "SPX" | "NDX" | "QQQ" | "SPY",
  opts: { dteMax?: number; winPct?: number; maxStrikes?: number; timeoutMs?: number } = {},
): Promise<{ options: OptionGO[]; spot: number }> {
  if (!hasTastytrade()) return { options: [], spot: 0 };
  const dteMax = opts.dteMax ?? 1;
  const winPct = opts.winPct ?? 0.025;
  const maxStrikes = opts.maxStrikes ?? 60;

  const chain = await getJson<NestedChain>(`/option-chains/${underlying}/nested`);
  const items = chain.data?.items ?? [];
  if (!items.length) return { options: [], spot: 0 };

  const { token, url } = await quoteToken();

  // Spot del índice (Trade rápido) para centrar la ventana.
  const spotEv = await dxlinkCollect({
    url, token, timeoutMs: 5000,
    eventFields: { Trade: ["eventType", "eventSymbol", "price"] },
    subscriptions: [{ type: "Trade", symbol: underlying }],
    done: (evs) => evs.some((e) => e.eventSymbol === underlying && num(e.price) != null),
  });
  let spot = 0;
  for (const e of spotEv) if (e.eventSymbol === underlying) { const p = num(e.price); if (p) spot = p; }
  const centro = spot || SPOT_FALLBACK[underlying] || 1000;
  const lo = centro * (1 - winPct), hi = centro * (1 + winPct);

  // Candidatos cercanos al ATM (los que tienen gamma relevante).
  const cand: { dist: number; strike: number; cs?: string; ps?: string; exp: string }[] = [];
  for (const ex of items[0].expirations ?? []) {
    const dte = ex["days-to-expiration"];
    if (dte == null || dte > dteMax) continue;
    const exp = ex["expiration-date"] ?? "";
    for (const s of ex.strikes ?? []) {
      const k = num(s["strike-price"]);
      if (k == null || k < lo || k > hi) continue;
      cand.push({ dist: Math.abs(k - centro), strike: k, cs: s["call-streamer-symbol"], ps: s["put-streamer-symbol"], exp });
    }
  }
  cand.sort((a, b) => a.dist - b.dist);

  const meta = new Map<string, { strike: number; type: "C" | "P"; exp: string }>();
  for (const c of cand.slice(0, maxStrikes)) {
    if (c.cs) meta.set(c.cs, { strike: c.strike, type: "C", exp: c.exp });
    if (c.ps) meta.set(c.ps, { strike: c.strike, type: "P", exp: c.exp });
  }
  if (!meta.size) return { options: [], spot };

  const syms = [...meta.keys()];
  const subs = [
    ...syms.map((s) => ({ type: "Greeks", symbol: s })),
    ...syms.map((s) => ({ type: "Summary", symbol: s })),
    { type: "Trade", symbol: underlying },
  ];
  const events = await dxlinkCollect({
    url, token, timeoutMs: opts.timeoutMs ?? 20000, aggregationPeriod: 1,
    eventFields: {
      Greeks: ["eventType", "eventSymbol", "gamma"],
      Summary: ["eventType", "eventSymbol", "openInterest", "prevDayOpenInterest"],
      Trade: ["eventType", "eventSymbol", "price"],
    },
    subscriptions: subs,
    done: () => false, // recolecta hasta el timeout (muchos símbolos)
  });

  const greeks = new Map<string, number>();
  const oi = new Map<string, number>();
  for (const e of events) {
    const sym = e.eventSymbol as string;
    if (e.eventType === "Greeks") { const g = num(e.gamma); if (g != null) greeks.set(sym, g); }
    else if (e.eventType === "Summary") { const o = num(e.openInterest) ?? num(e.prevDayOpenInterest); if (o != null) oi.set(sym, o); }
    else if (e.eventType === "Trade" && sym === underlying) { const p = num(e.price); if (p) spot = p; }
  }

  const options: OptionGO[] = [];
  for (const [sym, mt] of meta) {
    const g = greeks.get(sym), o = oi.get(sym);
    if (g == null || o == null) continue;
    options.push({ strike: mt.strike, type: mt.type, gamma: g, oi: o, exp: mt.exp });
  }
  return { options, spot };
}
