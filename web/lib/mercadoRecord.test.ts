import { describe, it, expect } from "vitest";
import {
  buildRecords, recordSummary, reviewRecords,
  type MercadoRecord, type DailyBar,
} from "./mercadoRecord";
import type { MarketRead, GexRead } from "./mercado";

function market(over: Partial<MarketRead> = {}): MarketRead {
  return {
    ticker: "SPY", label: "S&P 500 · MES", price: 775, todayPct: 0,
    callPct: 70, putPct: 30, direction: "alcista", strength: "fuerte",
    behavior: "", resistance: null, support: null, topFlows: [], summary: "",
    gex: null, ...over,
  };
}
function gex(over: Partial<GexRead> = {}): GexRead {
  return {
    net: 1, regime: "γ+", magnet: 7785, realtimePrice: 7750,
    callWall: 7800, putWall: 7700,
    topLevels: [{ strike: 7785, type: "C", oi: 6000 }], ...over,
  };
}

function rec(over: Partial<MercadoRecord> = {}): MercadoRecord {
  return {
    date: "2026-10-28", ticker: "SPY", label: "S&P 500 · MES",
    direction: "alcista", verdict: "alza", etfPrice: 775, priceFut: 7750,
    magnetFut: 7785, etfTarget: 778.5, evaluated: false, ...over,
  };
}

describe("buildRecords", () => {
  it("convierte el imán del futuro a escala del ETF", () => {
    const [r] = buildRecords([market({ price: 775, gex: gex({ realtimePrice: 7750, magnet: 7785 }) })], "2026-10-28");
    // 7785 * (775/7750) = 778.5
    expect(r.etfTarget).toBeCloseTo(778.5, 1);
    expect(r.direction).toBe("alcista");
    expect(r.evaluated).toBe(false);
  });
  it("sin GEX deja etfTarget en null", () => {
    const [r] = buildRecords([market({ gex: null })], "2026-10-28");
    expect(r.etfTarget).toBeNull();
  });
});

describe("reviewRecords", () => {
  const bars = (b: Partial<DailyBar>): Record<string, DailyBar[]> => ({
    SPY: [{ date: "2026-10-28", high: 779, low: 773, close: 777, ...b }],
  });

  it("acierto de dirección y llegó al imán (alcista que sube y toca 778.5)", () => {
    const { records, changed } = reviewRecords([rec()], bars({ high: 779, close: 777 }), "2026-10-29");
    expect(changed).toBe(true);
    expect(records[0].outcome?.directionHit).toBe(true); // 777 > 775
    expect(records[0].outcome?.reachedMagnet).toBe(true); // high 779 >= 778.5
  });

  it("no llegó al imán si el high se queda corto", () => {
    const { records } = reviewRecords([rec()], bars({ high: 777, close: 776 }), "2026-10-29");
    expect(records[0].outcome?.reachedMagnet).toBe(false); // 777 < 778.5
    expect(records[0].outcome?.directionHit).toBe(true);
  });

  it("no evalúa registros del mismo día (sesión no cerrada)", () => {
    const { changed } = reviewRecords([rec({ date: "2026-10-29" })], bars({}), "2026-10-29");
    expect(changed).toBe(false);
  });

  it("no evalúa si falta la barra", () => {
    const { changed } = reviewRecords([rec()], { SPY: [] }, "2026-10-29");
    expect(changed).toBe(false);
  });

  it("bajista: acierta si cierra por debajo", () => {
    const { records } = reviewRecords(
      [rec({ direction: "bajista", etfTarget: 772, etfPrice: 775 })],
      bars({ low: 771, close: 773 }), "2026-10-29",
    );
    expect(records[0].outcome?.directionHit).toBe(true); // 773 < 775
    expect(records[0].outcome?.reachedMagnet).toBe(true); // low 771 <= 772
  });
});

describe("recordSummary", () => {
  it("sin vencidas avisa que no hay datos", () => {
    expect(recordSummary([rec()])).toMatch(/aún sin lecturas/i);
  });
  it("cuenta aciertos de dirección e imán", () => {
    const evaluated: MercadoRecord[] = [
      rec({ evaluated: true, outcome: { barDate: "x", close: 777, directionHit: true, reachedMagnet: true } }),
      rec({ evaluated: true, outcome: { barDate: "x", close: 773, directionHit: false, reachedMagnet: false } }),
    ];
    const s = recordSummary(evaluated);
    expect(s).toMatch(/dirección 50% \(1\/2\)/);
    expect(s).toMatch(/imán 50% \(1\/2\)/);
  });
});
