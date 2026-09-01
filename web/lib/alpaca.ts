// Cliente de Alpaca (data.alpaca.markets) para la CAPA DE AGRESIVIDAD — la que
// MarketSnack aportaba (lado ask/bid + griegos por contrato). Solo servidor.
//
// Alpaca NO entrega el "lado" de cada trade, pero sí el último trade y la
// cotización (bid/ask) por contrato en el snapshot de la cadena. El lado se
// INFIERE comparando el precio contra el bid/ask (regla estándar de mercado) —
// exactamente lo que MarketSnack hacía por dentro.
//
// Auth: ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY en .env.local.
// Devuelve RawTrade[] con el MISMO formato que marketsnack.ts, así que es un
// reemplazo directo de fetchFlow en la ruta de flujo.

import type { RawTrade } from "./flow";
import type { FlowResult, FetchFlowOptions } from "./marketsnack";

const DATA_URL = "https://data.alpaca.markets";

export class AlpacaError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AlpacaError";
    this.status = status;
  }
}

function keys(): { id: string; secret: string } {
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) {
    throw new AlpacaError(
      "Faltan ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY en .env.local.",
    );
  }
  return { id: id.trim(), secret: secret.trim() };
}

function authHeaders(): Record<string, string> {
  const { id, secret } = keys();
  return { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": secret, Accept: "application/json" };
}

/** ¿Hay credenciales de Alpaca configuradas? (para elegir fuente en la ruta). */
export function hasAlpacaKeys(): boolean {
  return Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);
}

// ── Clasificación del lado (PURO) ───────────────────────────────────────────
// Devuelve el vocabulario que entiende flow.ts (ASK_SIDES / BID_SIDES / MIDMKT).
export function classifyAlpacaSide(price: number, bid: number, ask: number): string {
  if (!(price > 0) || !(bid > 0) || !(ask > 0) || ask < bid) return "UNKNOWN";
  if (price > ask) return "ABOVE_ASK";
  if (price >= ask) return "AT_ASK";
  if (price < bid) return "BELOW_BID";
  if (price <= bid) return "AT_BID";
  return "MIDMKT";
}

/** Hash estable de un símbolo OCC → entero positivo (id numérico del RawTrade). */
export function symbolId(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── Forma del snapshot de Alpaca (subconjunto que usamos) ────────────────────
export interface AlpacaSnapshot {
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  impliedVolatility?: number;
  latestQuote?: { bp?: number; ap?: number; t?: string };
  latestTrade?: { p?: number; s?: number; t?: string };
  dailyBar?: { v?: number; c?: number };
}

/**
 * Convierte un contrato del snapshot en un RawTrade (PURO).
 * `premium` se mide como el DINERO DEL DÍA en ese contrato (volumen × precio × 100)
 * y el lado sale del último trade contra el bid/ask. Devuelve null si no hay con
 * qué medir (sin precio o sin volumen).
 */
export function buildRawTrade(
  symbol: string,
  snap: AlpacaSnapshot,
  spot: number | null,
): RawTrade | null {
  const price = snap.latestTrade?.p ?? 0;
  const dayVol = snap.dailyBar?.v ?? 0;
  const size = dayVol > 0 ? dayVol : snap.latestTrade?.s ?? 0;
  if (!(price > 0) || !(size > 0)) return null;

  const bid = snap.latestQuote?.bp ?? 0;
  const ask = snap.latestQuote?.ap ?? 0;
  const g = snap.greeks ?? {};

  return {
    id: symbolId(symbol),
    symbol,
    price,
    size,
    side: classifyAlpacaSide(price, bid, ask),
    bid_price: bid,
    ask_price: ask,
    premium: size * price * 100,
    delta: g.delta ?? 0,
    gamma: g.gamma ?? 0,
    theta: g.theta ?? 0,
    vega: g.vega ?? 0,
    implied_volatility: snap.impliedVolatility ?? 0,
    open_interest: 0, // el snapshot de Alpaca no trae Open Interest
    volume: dayVol,
    score: 0,
    sentiment: "",
    timestamp: snap.latestTrade?.t ?? new Date().toISOString(),
    asset_price: spot ?? undefined,
    // trade_condition_id: Alpaca usa códigos de texto, no el id OPRA → sin multileg.
  };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

/** Precio del subyacente (mejor esfuerzo, feed gratuito IEX). */
async function fetchAlpacaSpot(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${DATA_URL}/v2/stocks/${encodeURIComponent(ticker)}/trades/latest?feed=iex`,
      { headers: authHeaders(), cache: "no-store" },
    );
    if (!res.ok) return null;
    const json: { trade?: { p?: number } } = await res.json();
    return json.trade?.p ?? null;
  } catch {
    return null;
  }
}

/**
 * Descarga la cadena de opciones de un ticker desde el snapshot de Alpaca y la
 * convierte en RawTrade[] (una fila por contrato, con lado inferido). Filtra por
 * `minPremium` (dinero del día). Reemplazo directo de fetchFlow.
 *
 * `period` / `targetDays` se ignoran: el snapshot es una foto actual, no un tape
 * histórico (limitación declarada — ver docs).
 */
export async function fetchAlpacaFlow(
  ticker: string,
  opts: FetchFlowOptions = {},
): Promise<FlowResult> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new AlpacaError("Ticker vacío.");
  const headers = authHeaders();
  const maxPages = opts.maxPages ?? 10;
  const minPremium = opts.minPremium ?? 0;

  const spot = await fetchAlpacaSpot(clean);

  const trades: RawTrade[] = [];
  let token: string | null = null;
  let page = 0;
  let truncated = false;

  do {
    page += 1;
    const params = new URLSearchParams({ feed: "indicative", limit: "1000" });
    if (token) params.set("page_token", token);
    const url = `${DATA_URL}/v1beta1/options/snapshots/${encodeURIComponent(clean)}?${params.toString()}`;

    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      throw new AlpacaError("Claves de Alpaca inválidas o sin permiso de datos de opciones.", res.status);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AlpacaError(`Alpaca respondió ${res.status}. ${body.slice(0, 200)}`.trim(), res.status);
    }

    const json: { snapshots?: Record<string, AlpacaSnapshot>; next_page_token?: string | null } =
      await res.json();
    const snaps = json.snapshots ?? {};
    for (const [symbol, snap] of Object.entries(snaps)) {
      const t = buildRawTrade(symbol, snap, spot);
      if (t && t.premium >= minPremium) trades.push(t);
    }
    await opts.onPage?.(page, trades.length);

    token = json.next_page_token ?? null;
    if (page >= maxPages) {
      truncated = Boolean(token);
      break;
    }
  } while (token);

  // Más dinero primero: la tabla y los scores priorizan lo grande.
  trades.sort((a, b) => b.premium - a.premium);
  return { trades, pages: page, truncated };
}

/**
 * Universo curado para el escaneo de mercado (/ideas). Alpaca no expone un feed
 * de "todo el mercado", así que se barre esta lista de los subyacentes con más
 * flujo de opciones. Añadir un nombre = añadirlo aquí.
 */
export const MARKET_SCAN_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD",
  "AVGO", "MU", "NFLX", "PLTR", "COIN", "SMCI", "MSTR", "SPY",
  "QQQ", "IWM", "JPM", "BAC", "XOM", "CVX", "DIS", "BABA",
  "UBER", "F", "GM", "SHOP",
];

/**
 * Equivalente a fetchMarketFlow (MarketSnack) pero con Alpaca: barre el universo
 * curado con concurrencia limitada y junta el flujo de todos. Reemplazo directo
 * en /ideas. Un ticker que falla simplemente no aporta.
 */
export async function fetchAlpacaMarketFlow(opts: FetchFlowOptions = {}): Promise<FlowResult> {
  if (!hasAlpacaKeys()) throw new AlpacaError("Faltan las claves de Alpaca.");
  const minPremium = opts.minPremium ?? 0;
  const universe = MARKET_SCAN_UNIVERSE;
  const trades: RawTrade[] = [];
  let done = 0;
  let idx = 0;
  const CONCURRENCY = 6;

  async function worker() {
    while (idx < universe.length) {
      const t = universe[idx++];
      try {
        const r = await fetchAlpacaFlow(t, { minPremium, maxPages: 2 });
        trades.push(...r.trades);
      } catch {
        // ticker fallido → se omite, no rompe el escaneo
      }
      done++;
      await opts.onPage?.(done, trades.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  trades.sort((a, b) => b.premium - a.premium);
  return { trades, pages: universe.length, truncated: false };
}
