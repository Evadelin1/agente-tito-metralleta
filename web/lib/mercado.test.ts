import { describe, it, expect } from "vitest";
import { marketLearningNote, type MarketRead, type GexRead } from "./mercado";

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
