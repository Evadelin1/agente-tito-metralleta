// ============================================================================
// Vista "Mercado" — lectura rápida de SPY y QQQ (proxies de MES y MNQ):
// hacia dónde va el mercado y DÓNDE SE MUEVEN LOS MILLONES, de un vistazo.
// PURO y testeable. El I/O (traer el flujo) vive en la ruta.
// ============================================================================

import type { FlowRow } from "./flow";

export type MarketDirection = "alcista" | "bajista" | "lateral";

export interface BigFlow {
  strike: number;
  type: "call" | "put";
  premium: number;
}

export interface GexOption {
  strike: number;
  type: "C" | "P";
  gamma: number;
  oi: number;
}

export interface GexRead {
  net: number; // GEX neto (positivo = dealers estabilizan; negativo = amplifican)
  regime: string;
  magnet: number | null; // strike imán (mayor concentración de gamma)
  realtimePrice: number | null; // precio real del futuro (tastytrade)
}

export interface MarketRead {
  ticker: string;
  label: string;
  price: number | null;
  todayPct: number | null;
  callPct: number | null; // % del dinero en calls
  putPct: number | null;
  direction: MarketDirection;
  strength: "fuerte" | "suave" | "mixto";
  behavior: string; // "Compran calls, venden puts"
  resistance: number | null; // techo = strike de calls con más dinero arriba del precio
  support: number | null; // piso = strike de puts con más dinero abajo del precio
  topFlows: BigFlow[]; // los 3 contratos con más millones (dónde va el dinero)
  summary: string;
  gex?: GexRead | null; // GEX real del índice (tastytrade), si está disponible
}

/**
 * GEX a partir de gamma + Open Interest de las opciones del índice.
 * GEX por contrato = gamma × OI × 100 × spot² × 0.01 (+call / −put).
 */
export function gexFromOptions(options: GexOption[], spot: number): GexRead {
  let net = 0;
  const perStrike = new Map<number, number>();
  for (const o of options) {
    const g = o.gamma * o.oi * 100 * spot * spot * 0.01 * (o.type === "C" ? 1 : -1);
    net += g;
    perStrike.set(o.strike, (perStrike.get(o.strike) ?? 0) + Math.abs(g));
  }
  let magnet: number | null = null;
  let best = -1;
  for (const [k, v] of perStrike) if (v > best) { best = v; magnet = k; }
  const regime = net >= 0
    ? "γ+ estabiliza (el precio tiende a revertir)"
    : "γ− amplifica (el movimiento acelera)";
  return { net, regime, magnet, realtimePrice: null };
}

function topStrike(m: Map<number, number>, spot: number | null, side: "above" | "below"): number | null {
  let best: number | null = null;
  let bestP = -1;
  for (const [strike, prem] of m) {
    if (spot != null) {
      if (side === "above" && strike < spot) continue;
      if (side === "below" && strike > spot) continue;
    }
    if (prem > bestP) { bestP = prem; best = strike; }
  }
  return best;
}

/** Analiza el flujo de un índice y lo resume en una lectura de mercado. */
export function analyzeMarket(
  ticker: string,
  label: string,
  rows: FlowRow[],
  spot: number | null,
  prevClose: number | null,
): MarketRead {
  let callP = 0, putP = 0, callAsk = 0, callBid = 0, putAsk = 0, putBid = 0;
  const byStrikeCall = new Map<number, number>();
  const byStrikePut = new Map<number, number>();
  const flows: BigFlow[] = [];

  for (const r of rows) {
    if (r.type === "call") {
      callP += r.premium;
      if (r.aggression === "ask") callAsk += r.premium;
      else if (r.aggression === "bid") callBid += r.premium;
      if (r.strike != null) byStrikeCall.set(r.strike, (byStrikeCall.get(r.strike) ?? 0) + r.premium);
    } else if (r.type === "put") {
      putP += r.premium;
      if (r.aggression === "ask") putAsk += r.premium;
      else if (r.aggression === "bid") putBid += r.premium;
      if (r.strike != null) byStrikePut.set(r.strike, (byStrikePut.get(r.strike) ?? 0) + r.premium);
    }
    if (r.strike != null && (r.type === "call" || r.type === "put")) {
      flows.push({ strike: r.strike, type: r.type, premium: r.premium });
    }
  }

  const tot = callP + putP;
  const callPct = tot > 0 ? (callP / tot) * 100 : null;
  const putPct = callPct != null ? 100 - callPct : null;

  let direction: MarketDirection = "lateral";
  let strength: MarketRead["strength"] = "mixto";
  if (callPct != null) {
    if (callPct >= 60) { direction = "alcista"; strength = callPct >= 70 ? "fuerte" : "suave"; }
    else if (callPct <= 40) { direction = "bajista"; strength = callPct <= 30 ? "fuerte" : "suave"; }
    else { direction = "lateral"; strength = "mixto"; }
  }

  const parts: string[] = [];
  if (callAsk > callBid) parts.push("compran calls");
  else if (callBid > callAsk) parts.push("venden calls");
  if (putAsk > putBid) parts.push("compran puts");
  else if (putBid > putAsk) parts.push("venden puts");
  const behavior = parts.length
    ? parts.join(", ").replace(/^./, (c) => c.toUpperCase())
    : "Flujo repartido";

  const resistance = topStrike(byStrikeCall, spot, "above");
  const support = topStrike(byStrikePut, spot, "below");
  const todayPct = spot != null && prevClose != null && prevClose > 0
    ? ((spot - prevClose) / prevClose) * 100
    : null;

  const topFlows = flows.sort((a, b) => b.premium - a.premium).slice(0, 3);

  const dirWord = direction === "alcista" ? "al alza" : direction === "bajista" ? "a la baja" : "lateral";
  const summary = callPct != null
    ? `El dinero se inclina ${dirWord} (${Math.round(callPct)}% en calls). ${behavior}. ${
        direction === "lateral"
          ? "Sin apuesta dominante — zona de pelea."
          : `Sesgo ${strength === "fuerte" ? "claro" : "suave"} ${dirWord}.`
      }`
    : "Sin datos suficientes de flujo para leer la dirección.";

  return {
    ticker, label, price: spot, todayPct, callPct, putPct,
    direction, strength, behavior, resistance, support, topFlows, summary,
  };
}
