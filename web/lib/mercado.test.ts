import { describe, it, expect } from "vitest";
import { analyzeMarket, marketLearningNote, type MarketRead, type GexRead } from "./mercado";
import type { FlowRow } from "./flow";

// Fila de flujo mínima para los tests de analyzeMarket.
function row(over: Partial<FlowRow> = {}): FlowRow {
  return {
    id: 1, symbol: "SPY", underlying: "SPY", type: "call", strike: 775,
    expiration: null, dte: 0, price: 1, size: 1, side: "ask", aggression: "ask",
    assetPrice: 775, bid: 0.9, ask: 1.1, premium: 1_000_000, ...over,
  } as FlowRow;
}

function base(overrides: Partial<MarketRead> = {}): MarketRead {
  return {
    ticker: "SPY", label: "S&P 500 · MES", price: 100, todayPct: 0,
    callPct: 70, putPct: 30, direction: "alcista", strength: "fuerte",
    behavior: "Compran calls", resistance: null, support: null,
    topFlows: [], summary: "", gex: null, ...overrides,
  };
}
function gex(overrides: Partial<GexRead> = {}): GexRead {
  return {
    net: 1, regime: "γ+", magnet: 7725, realtimePrice: 7758,
    callWall: 7785, putWall: 7650,
    topLevels: [{ strike: 7650, type: "P", oi: 5959 }], ...overrides,
  };
}

describe("marketLearningNote", () => {
  it("sin GEX devuelve null", () => {
    expect(marketLearningNote(base({ gex: null }))).toBeNull();
  });

  it("alcista + imán ARRIBA = alineada al alza", () => {
    const n = marketLearningNote(base({ direction: "alcista", gex: gex({ realtimePrice: 7700, magnet: 7760 }) }));
    expect(n?.verdict).toBe("alza");
  });

  it("bajista + imán ABAJO = alineada a la baja", () => {
    const n = marketLearningNote(base({ direction: "bajista", gex: gex({ net: -1, realtimePrice: 7760, magnet: 7700 }) }));
    expect(n?.verdict).toBe("baja");
  });

  it("alcista pero imán ABAJO = mixta (el caso real de MES)", () => {
    const n = marketLearningNote(base({ direction: "alcista", gex: gex({ realtimePrice: 7758, magnet: 7725 }) }));
    expect(n?.verdict).toBe("mixta");
  });

  it("OI flaco = no fiable (el caso real de MNQ)", () => {
    const n = marketLearningNote(base({
      direction: "alcista",
      gex: gex({ realtimePrice: 29894, magnet: 29650, topLevels: [{ strike: 29650, type: "C", oi: 293 }] }),
    }));
    expect(n?.verdict).toBe("no-fiable");
  });

  it("precio pegado al imán con γ+ = rango", () => {
    const n = marketLearningNote(base({ direction: "lateral", gex: gex({ net: 1, realtimePrice: 7725, magnet: 7725 }) }));
    expect(n?.verdict).toBe("rango");
  });

  it("sin precio o sin imán = sin-datos", () => {
    const n = marketLearningNote(base({ gex: gex({ realtimePrice: null }) }));
    expect(n?.verdict).toBe("sin-datos");
  });
});

describe("analyzeMarket — dirección por lado comprado/vendido", () => {
  it("calls dominantes y COMPRADAS = alcista", () => {
    const m = analyzeMarket("SPY", "S&P 500 · MES", [
      row({ type: "call", aggression: "ask", premium: 8_000_000 }),
      row({ type: "put", aggression: "ask", premium: 2_000_000 }),
    ], 775, 770);
    expect(m.direction).toBe("alcista");
    expect(m.strength).toBe("fuerte");
  });

  it("calls dominantes pero VENDIDAS = NO alcista (techo, no alza)", () => {
    const m = analyzeMarket("SPY", "S&P 500 · MES", [
      row({ type: "call", aggression: "bid", premium: 8_000_000 }),
      row({ type: "put", aggression: "ask", premium: 2_000_000 }),
    ], 775, 770);
    expect(m.direction).not.toBe("alcista");
    expect(m.direction).toBe("lateral");
    expect(m.summary).toMatch(/VENDIDAS/);
    expect(m.summary).toMatch(/techo/i);
  });

  it("puts dominantes y COMPRADAS = bajista", () => {
    const m = analyzeMarket("SPY", "S&P 500 · MES", [
      row({ type: "put", aggression: "ask", premium: 8_000_000 }),
      row({ type: "call", aggression: "ask", premium: 2_000_000 }),
    ], 775, 780);
    expect(m.direction).toBe("bajista");
  });

  it("puts dominantes pero VENDIDAS = NO bajista (soporte, no baja)", () => {
    const m = analyzeMarket("SPY", "S&P 500 · MES", [
      row({ type: "put", aggression: "bid", premium: 8_000_000 }),
      row({ type: "call", aggression: "ask", premium: 2_000_000 }),
    ], 775, 780);
    expect(m.direction).not.toBe("bajista");
    expect(m.summary).toMatch(/soporte/i);
  });

  it("sin dato de lado (todo mid) = cae al reparto por premium (comportamiento viejo)", () => {
    const m = analyzeMarket("SPY", "S&P 500 · MES", [
      row({ type: "call", aggression: "mid", premium: 8_000_000 }),
      row({ type: "put", aggression: "mid", premium: 2_000_000 }),
    ], 775, 770);
    expect(m.direction).toBe("alcista");
  });
});
