// ============================================================================
// "Señal limpia" para /ideas — automatiza el paso manual de confirmar que el
// dinero de un ticker va CLARO a un lado Y comprándose (al ask), no vendiéndose.
// Evita la trampa de "84% en calls pero vendidas" (calls al bid = techo, no alza).
// PURO y testeable.
// ============================================================================

export type TickerSignal = "bull" | "bear" | "mixed";

export interface SignalTrade {
  type: "call" | "put" | "unknown";
  aggression: string; // "ask" | "bid" | "mid" | ...
  premium: number;
}

/** % de calls a partir del cual (o su espejo en puts) se considera dirección clara. */
export const CLEAN_PCT = 65;

/**
 * Clasifica el flujo AGREGADO de un ticker:
 * - "bull": ≥65% del dinero en calls Y esas calls se compran (ask > bid).
 * - "bear": ≥65% en puts Y esas puts se compran (ask > bid).
 * - "mixed": todo lo demás (repartido, o dirección clara pero VENDIDA).
 */
export function classifyTickerSignal(rows: SignalTrade[]): TickerSignal {
  let callP = 0, putP = 0, callAsk = 0, callBid = 0, putAsk = 0, putBid = 0;
  for (const r of rows) {
    if (r.type === "call") {
      callP += r.premium;
      if (r.aggression === "ask") callAsk += r.premium;
      else if (r.aggression === "bid") callBid += r.premium;
    } else if (r.type === "put") {
      putP += r.premium;
      if (r.aggression === "ask") putAsk += r.premium;
      else if (r.aggression === "bid") putBid += r.premium;
    }
  }
  const tot = callP + putP;
  if (tot <= 0) return "mixed";
  const callPct = (callP / tot) * 100;
  if (callPct >= CLEAN_PCT && callAsk > callBid) return "bull";
  if (callPct <= 100 - CLEAN_PCT && putAsk > putBid) return "bear";
  return "mixed";
}

/** ¿Esta idea (call/put) va en la misma dirección que la señal limpia del ticker? */
export function ideaRidesCleanSignal(
  type: "call" | "put",
  signal: TickerSignal,
): boolean {
  return (type === "call" && signal === "bull") || (type === "put" && signal === "bear");
}

/** Agrupa las filas de flujo por subyacente y clasifica cada ticker. */
export function signalByTicker(
  rows: { underlying: string; type: "call" | "put" | "unknown"; aggression: string; premium: number }[],
): Map<string, TickerSignal> {
  const byTicker = new Map<string, SignalTrade[]>();
  for (const r of rows) {
    const arr = byTicker.get(r.underlying) ?? [];
    arr.push({ type: r.type, aggression: r.aggression, premium: r.premium });
    byTicker.set(r.underlying, arr);
  }
  const out = new Map<string, TickerSignal>();
  for (const [ticker, trades] of byTicker) out.set(ticker, classifyTickerSignal(trades));
  return out;
}
