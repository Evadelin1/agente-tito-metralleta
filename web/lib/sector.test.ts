import { describe, expect, it } from "vitest";
import {
  biasFromCallPct,
  makeBias,
  classifySectorFlow,
  resolveSector,
  peerTickers,
  SECTOR_DEFS,
  type FlowBias,
} from "./sector";

function bias(ticker: string, direction: FlowBias["direction"], ok = true): FlowBias {
  const callPct = direction === "alcista" ? 80 : direction === "bajista" ? 20 : 50;
  return { ticker, callPct: ok ? callPct : null, direction: ok ? direction : "neutral", strength: ok ? 6 : 0, ok };
}

describe("biasFromCallPct", () => {
  it("marca alcista cuando dominan las calls", () => {
    expect(biasFromCallPct(80).direction).toBe("alcista");
  });
  it("marca bajista cuando dominan las puts", () => {
    expect(biasFromCallPct(20).direction).toBe("bajista");
  });
  it("marca neutral en la zona media", () => {
    expect(biasFromCallPct(50).direction).toBe("neutral");
  });
  it("null → neutral sin fuerza", () => {
    expect(biasFromCallPct(null)).toEqual({ direction: "neutral", strength: 0 });
  });
  it("la fuerza crece con la distancia a 50", () => {
    expect(biasFromCallPct(100).strength).toBe(10);
    expect(biasFromCallPct(75).strength).toBe(5);
  });
});

describe("makeBias", () => {
  it("calcula callPct del nocional", () => {
    const b = makeBias("NVDA", 800, 200);
    expect(b.callPct).toBe(80);
    expect(b.direction).toBe("alcista");
    expect(b.ok).toBe(true);
  });
  it("sin nocional → no medible", () => {
    const b = makeBias("XYZ", 0, 0);
    expect(b.ok).toBe(false);
    expect(b.callPct).toBeNull();
    expect(b.direction).toBe("neutral");
  });
  it("respeta ok=false aunque haya números", () => {
    expect(makeBias("XYZ", 800, 200, false).ok).toBe(false);
  });
});

describe("classifySectorFlow", () => {
  const subject = bias("NVDA", "alcista");

  it("SECTORIAL cuando la mayoría de pares acompaña", () => {
    const peers = [bias("AMD", "alcista"), bias("AVGO", "alcista"), bias("MU", "alcista"), bias("INTC", "bajista")];
    const r = classifySectorFlow(subject, peers);
    expect(r.verdict).toBe("sectorial");
    expect(r.agree).toBe(3);
    expect(r.disagree).toBe(1);
  });

  it("INDIVIDUAL cuando los pares no acompañan", () => {
    const peers = [bias("AMD", "bajista"), bias("AVGO", "bajista"), bias("MU", "bajista"), bias("INTC", "alcista")];
    const r = classifySectorFlow(subject, peers);
    expect(r.verdict).toBe("individual");
    expect(r.agree).toBe(1);
  });

  it("MIXTA cuando el sector está dividido a la mitad", () => {
    const peers = [bias("AMD", "alcista"), bias("AVGO", "bajista")];
    const r = classifySectorFlow(subject, peers);
    expect(r.verdict).toBe("mixto");
    expect(r.alignedPct).toBe(50);
  });

  it("INDETERMINADO si el sujeto no tiene dirección", () => {
    const r = classifySectorFlow(bias("NVDA", "neutral"), [bias("AMD", "alcista")]);
    expect(r.verdict).toBe("indeterminado");
  });

  it("INDETERMINADO si ningún par es medible", () => {
    const peers = [bias("AMD", "neutral"), bias("AVGO", "neutral", false)];
    const r = classifySectorFlow(subject, peers);
    expect(r.verdict).toBe("indeterminado");
    expect(r.measuredPeers).toBe(0);
  });

  it("ignora pares neutrales y no medibles en el conteo", () => {
    const peers = [bias("AMD", "alcista"), bias("AVGO", "neutral"), bias("MU", "alcista", false)];
    const r = classifySectorFlow(subject, peers);
    expect(r.measuredPeers).toBe(1);
    expect(r.agree).toBe(1);
    expect(r.verdict).toBe("sectorial");
  });
});

describe("resolveSector", () => {
  it("resuelve por atajo de ticker", () => {
    expect(resolveSector("NVDA", null)?.key).toBe("semiconductores");
    expect(resolveSector("tsla", null)?.key).toBe("autos-ev");
  });
  it("resuelve por palabras del sic_description", () => {
    expect(resolveSector("ZZZZ", "SEMICONDUCTORS & RELATED DEVICES")?.key).toBe("semiconductores");
    expect(resolveSector("ZZZZ", "National Commercial Banks")?.key).toBe("bancos");
  });
  it("devuelve null si no reconoce el sector", () => {
    expect(resolveSector("ZZZZ", "SOMETHING UNKNOWN")).toBeNull();
    expect(resolveSector("ZZZZ", null)).toBeNull();
  });
});

describe("peerTickers", () => {
  it("excluye al propio ticker de los líderes", () => {
    const def = SECTOR_DEFS.find((d) => d.key === "semiconductores")!;
    const peers = peerTickers("NVDA", def);
    expect(peers).not.toContain("NVDA");
    expect(peers).toContain("AMD");
    expect(peers.length).toBe(4);
  });
  it("un ticker que no es líder mantiene los 5", () => {
    const def = SECTOR_DEFS.find((d) => d.key === "semiconductores")!;
    expect(peerTickers("ASML", def).length).toBe(5);
  });
});
