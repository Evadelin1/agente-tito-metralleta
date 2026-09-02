import { describe, expect, it } from "vitest";
import {
  classifyTickerSignal,
  ideaRidesCleanSignal,
  signalByTicker,
  type SignalTrade,
} from "./signalQuality";

function t(type: "call" | "put", aggression: string, premium: number): SignalTrade {
  return { type, aggression, premium };
}

describe("classifyTickerSignal", () => {
  it("bull: calls dominantes Y compradas al ask", () => {
    expect(classifyTickerSignal([
      t("call", "ask", 800), t("call", "ask", 100), t("put", "bid", 100),
    ])).toBe("bull");
  });

  it("bear: puts dominantes Y compradas al ask", () => {
    expect(classifyTickerSignal([
      t("put", "ask", 800), t("put", "ask", 100), t("call", "bid", 100),
    ])).toBe("bear");
  });

  it("mixed: calls dominantes pero VENDIDAS al bid (la trampa de AAPL)", () => {
    expect(classifyTickerSignal([
      t("call", "bid", 800), t("call", "bid", 100), t("put", "bid", 100),
    ])).toBe("mixed");
  });

  it("mixed: dinero repartido a la mitad", () => {
    expect(classifyTickerSignal([
      t("call", "ask", 500), t("put", "ask", 500),
    ])).toBe("mixed");
  });

  it("mixed: sin dinero", () => {
    expect(classifyTickerSignal([])).toBe("mixed");
    expect(classifyTickerSignal([t("call", "ask", 0)])).toBe("mixed");
  });
});

describe("ideaRidesCleanSignal", () => {
  it("call sobre señal bull = limpia", () => {
    expect(ideaRidesCleanSignal("call", "bull")).toBe(true);
  });
  it("put sobre señal bear = limpia", () => {
    expect(ideaRidesCleanSignal("put", "bear")).toBe(true);
  });
  it("call sobre señal bear = NO limpia", () => {
    expect(ideaRidesCleanSignal("call", "bear")).toBe(false);
  });
  it("cualquier cosa sobre mixed = NO limpia", () => {
    expect(ideaRidesCleanSignal("call", "mixed")).toBe(false);
    expect(ideaRidesCleanSignal("put", "mixed")).toBe(false);
  });
});

describe("signalByTicker", () => {
  it("clasifica cada ticker por separado", () => {
    const m = signalByTicker([
      { underlying: "AAA", type: "call", aggression: "ask", premium: 900 },
      { underlying: "AAA", type: "put", aggression: "bid", premium: 100 },
      { underlying: "BBB", type: "put", aggression: "ask", premium: 900 },
      { underlying: "BBB", type: "call", aggression: "bid", premium: 100 },
    ]);
    expect(m.get("AAA")).toBe("bull");
    expect(m.get("BBB")).toBe("bear");
  });
});
