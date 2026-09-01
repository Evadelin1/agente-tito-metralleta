import { describe, expect, it } from "vitest";
import { classifyAlpacaSide, buildRawTrade, symbolId, type AlpacaSnapshot } from "./alpaca";
import { aggressionOf } from "./flow";

describe("classifyAlpacaSide", () => {
  it("por encima del ask → compra agresiva", () => {
    expect(classifyAlpacaSide(2.10, 1.90, 2.00)).toBe("ABOVE_ASK");
    expect(aggressionOf(classifyAlpacaSide(2.10, 1.90, 2.00))).toBe("ask");
  });
  it("justo en el ask → AT_ASK (lado ask)", () => {
    expect(classifyAlpacaSide(2.00, 1.90, 2.00)).toBe("AT_ASK");
    expect(aggressionOf(classifyAlpacaSide(2.00, 1.90, 2.00))).toBe("ask");
  });
  it("por debajo del bid → venta agresiva", () => {
    expect(classifyAlpacaSide(1.80, 1.90, 2.00)).toBe("BELOW_BID");
    expect(aggressionOf(classifyAlpacaSide(1.80, 1.90, 2.00))).toBe("bid");
  });
  it("justo en el bid → AT_BID (lado bid)", () => {
    expect(classifyAlpacaSide(1.90, 1.90, 2.00)).toBe("AT_BID");
    expect(aggressionOf(classifyAlpacaSide(1.90, 1.90, 2.00))).toBe("bid");
  });
  it("entre bid y ask → mid", () => {
    expect(classifyAlpacaSide(1.95, 1.90, 2.00)).toBe("MIDMKT");
    expect(aggressionOf(classifyAlpacaSide(1.95, 1.90, 2.00))).toBe("mid");
  });
  it("sin cotización válida → desconocido", () => {
    expect(classifyAlpacaSide(2.0, 0, 0)).toBe("UNKNOWN");
    expect(classifyAlpacaSide(2.0, 2.0, 1.0)).toBe("UNKNOWN"); // ask < bid, cruzado
    expect(aggressionOf(classifyAlpacaSide(2.0, 0, 0))).toBe("unknown");
  });
});

describe("symbolId", () => {
  it("es estable y no negativo", () => {
    const a = symbolId("NVDA260918C00230000");
    expect(a).toBe(symbolId("NVDA260918C00230000"));
    expect(a).toBeGreaterThanOrEqual(0);
  });
  it("distingue contratos distintos", () => {
    expect(symbolId("NVDA260918C00230000")).not.toBe(symbolId("NVDA260918P00230000"));
  });
});

describe("buildRawTrade", () => {
  const base: AlpacaSnapshot = {
    greeks: { delta: 0.55, gamma: 0.03, theta: -0.08, vega: 0.12 },
    impliedVolatility: 0.45,
    latestQuote: { bp: 1.90, ap: 2.00 },
    latestTrade: { p: 2.00, s: 3, t: "2026-09-01T14:00:00Z" },
    dailyBar: { v: 5000, c: 2.0 },
  };

  it("mapea griegos, lado y premium como dinero del día", () => {
    const r = buildRawTrade("NVDA260918C00230000", base, 220)!;
    expect(r).not.toBeNull();
    expect(r.symbol).toBe("NVDA260918C00230000");
    expect(r.side).toBe("AT_ASK");
    expect(r.delta).toBe(0.55);
    expect(r.implied_volatility).toBe(0.45);
    expect(r.size).toBe(5000); // usa el volumen del día
    expect(r.premium).toBe(5000 * 2.0 * 100); // dinero del día
    expect(r.asset_price).toBe(220);
  });

  it("cae al tamaño del último trade si no hay volumen del día", () => {
    const snap: AlpacaSnapshot = { ...base, dailyBar: { v: 0 } };
    const r = buildRawTrade("X", snap, null)!;
    expect(r.size).toBe(3);
    expect(r.premium).toBe(3 * 2.0 * 100);
  });

  it("devuelve null sin precio o sin tamaño", () => {
    expect(buildRawTrade("X", { latestTrade: { p: 0 }, dailyBar: { v: 100 } }, null)).toBeNull();
    expect(buildRawTrade("X", { latestTrade: { p: 2 }, dailyBar: { v: 0 } }, null)).toBeNull();
  });

  it("open_interest queda en 0 (Alpaca no lo da en el snapshot)", () => {
    expect(buildRawTrade("X", base, null)!.open_interest).toBe(0);
  });
});
