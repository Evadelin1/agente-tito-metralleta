// ============================================================================
// Tarea 3 — COMPARACIÓN SECTORIAL vs. INDIVIDUAL
// Al analizar una empresa, se identifican las 5 líderes de su sector y se
// compara la dirección de su flujo de opciones para decidir si la actividad es
// SECTORIAL (toda la industria empuja igual) o INDIVIDUAL (algo propio del
// nombre). Ver Agente Principal/Proceso Principal.md, Tarea 3.
//
// PURO y testeable. El I/O (traer la cadena de cada líder) vive en la ruta.
// ============================================================================

export type FlowDirection = "alcista" | "bajista" | "neutral";

/** Sesgo direccional del flujo de un ticker, leído del nocional calls vs puts. */
export interface FlowBias {
  ticker: string;
  /** % del nocional en calls (null si no se pudo medir). */
  callPct: number | null;
  direction: FlowDirection;
  /** Qué tan marcada es la dirección, 0-10. */
  strength: number;
  /** ¿Se pudo medir? (false si la cadena vino vacía o falló). */
  ok: boolean;
  /** Marca si este ticker es una de las líderes del sector. */
  isLeader?: boolean;
}

export type SectorVerdict = "sectorial" | "individual" | "mixto" | "indeterminado";

export interface SectorComparison {
  ticker: string;
  sectorKey: string | null;
  sectorLabel: string;
  subject: FlowBias;
  peers: FlowBias[];
  verdict: SectorVerdict;
  /** Etiqueta corta para resaltar el hallazgo (Tarea 3 pide "etiqueta adicional"). */
  label: string;
  /** Frase en lenguaje llano. */
  headline: string;
  /** Pares que coinciden con la dirección del sujeto. */
  agree: number;
  /** Pares con dirección medible que NO coinciden. */
  disagree: number;
  /** Pares con dirección clara y medible (base del %). */
  measuredPeers: number;
  /** agree / measuredPeers, 0-100 (null si no hay pares medibles). */
  alignedPct: number | null;
}

// ── Umbrales de dirección (sobre el % de nocional en calls) ──────────────────
export const BULLISH_CALL_PCT = 55; // ≥ esto → alcista
export const BEARISH_CALL_PCT = 45; // ≤ esto → bajista (dominan puts)

// De los pares medibles, qué fracción debe acompañar para llamarlo sectorial.
export const SECTORIAL_ALIGN = 0.6; // ≥ 60% acompaña → sectorial
export const INDIVIDUAL_ALIGN = 0.4; // ≤ 40% acompaña → individual

/** Traduce el % de calls a dirección + fuerza. */
export function biasFromCallPct(callPct: number | null): {
  direction: FlowDirection;
  strength: number;
} {
  if (callPct == null) return { direction: "neutral", strength: 0 };
  const direction: FlowDirection =
    callPct >= BULLISH_CALL_PCT ? "alcista" : callPct <= BEARISH_CALL_PCT ? "bajista" : "neutral";
  // |callPct - 50| va de 0 a 50 → fuerza 0 a 10.
  const strength = Math.max(0, Math.min(10, Math.round(Math.abs(callPct - 50) / 5)));
  return { direction, strength };
}

/** Construye el sesgo de un ticker a partir del nocional en calls y puts. */
export function makeBias(
  ticker: string,
  callNotional: number,
  putNotional: number,
  ok = true,
): FlowBias {
  const total = callNotional + putNotional;
  if (!ok || total <= 0) {
    return { ticker, callPct: null, direction: "neutral", strength: 0, ok: false };
  }
  const callPct = (callNotional / total) * 100;
  const b = biasFromCallPct(callPct);
  return { ticker, callPct, direction: b.direction, strength: b.strength, ok: true };
}

function dirWord(d: FlowDirection): string {
  return d === "alcista" ? "al alza" : d === "bajista" ? "a la baja" : "sin rumbo";
}

/**
 * Decide si el flujo del sujeto es sectorial o individual comparándolo con sus
 * pares. La dirección del sujeto es el patrón de referencia; los pares "acompañan"
 * si van en la misma dirección.
 */
export function classifySectorFlow(
  subject: FlowBias,
  peers: FlowBias[],
): Pick<
  SectorComparison,
  "verdict" | "label" | "headline" | "agree" | "disagree" | "measuredPeers" | "alignedPct"
> {
  const t = subject.ticker;

  // Sin dirección clara en el sujeto → no hay nada que comparar.
  if (!subject.ok || subject.direction === "neutral") {
    return {
      verdict: "indeterminado",
      label: "Sin lectura",
      headline: `El flujo de ${t} no tiene una dirección clara, así que no se puede etiquetar como sectorial o individual.`,
      agree: 0,
      disagree: 0,
      measuredPeers: 0,
      alignedPct: null,
    };
  }

  const measurable = peers.filter((p) => p.ok && p.direction !== "neutral");
  const agree = measurable.filter((p) => p.direction === subject.direction).length;
  const disagree = measurable.length - agree;
  const measuredPeers = measurable.length;

  if (measuredPeers === 0) {
    return {
      verdict: "indeterminado",
      label: "Sin comparables",
      headline: `Los líderes del sector no muestran una dirección clara ahora mismo, así que no se puede situar a ${t} frente a ellos.`,
      agree: 0,
      disagree: 0,
      measuredPeers: 0,
      alignedPct: null,
    };
  }

  const alignedPct = (agree / measuredPeers) * 100;
  const dir = dirWord(subject.direction);

  if (agree / measuredPeers >= SECTORIAL_ALIGN) {
    return {
      verdict: "sectorial",
      label: "Flujo SECTORIAL",
      headline: `El movimiento en ${t} acompaña a su sector: ${agree} de ${measuredPeers} líderes apuntan ${dir} igual. Es una corriente de industria, no una apuesta aislada.`,
      agree,
      disagree,
      measuredPeers,
      alignedPct,
    };
  }

  if (agree / measuredPeers <= INDIVIDUAL_ALIGN) {
    return {
      verdict: "individual",
      label: "Flujo INDIVIDUAL",
      headline: `El movimiento en ${t} es propio: sus pares no lo acompañan (solo ${agree} de ${measuredPeers} van ${dir}). Apunta a algo específico de este nombre.`,
      agree,
      disagree,
      measuredPeers,
      alignedPct,
    };
  }

  return {
    verdict: "mixto",
    label: "Señal MIXTA",
    headline: `El sector está dividido: ${agree} de ${measuredPeers} líderes acompañan a ${t} ${dir}. Ni claramente sectorial ni del todo aislado.`,
    agree,
    disagree,
    measuredPeers,
    alignedPct,
  };
}

// ── Universo curado de sectores y sus líderes ───────────────────────────────
// Se cura a mano (como wheelUniverse.ts y las "7 Magníficas") porque Massive no
// da "top 5 por capitalización de un sector" en una llamada. Cada sector lista
// sus líderes por liquidez de opciones. `match` son palabras del sic_description
// de Massive; `TICKER_SECTOR` es un atajo directo para los nombres conocidos.

export interface SectorDef {
  key: string;
  label: string;
  match: string[]; // fragmentos (en minúscula) del sic_description
  leaders: string[]; // 5 líderes del sector por liquidez de opciones
}

export const SECTOR_DEFS: SectorDef[] = [
  {
    key: "semiconductores",
    label: "Semiconductores",
    match: ["semiconductor"],
    leaders: ["NVDA", "AMD", "AVGO", "MU", "INTC"],
  },
  {
    key: "software",
    label: "Software",
    match: ["prepackaged software", "computer programming", "software"],
    leaders: ["MSFT", "ORCL", "CRM", "ADBE", "NOW"],
  },
  {
    key: "tecnologia",
    label: "Tecnología / Megacaps",
    match: ["electronic computers", "computer", "telephone & telegraph apparatus", "consumer electronics"],
    leaders: ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
  },
  {
    key: "autos-ev",
    label: "Autos / Vehículos eléctricos",
    match: ["motor vehicles", "motor vehicle"],
    leaders: ["TSLA", "F", "GM", "RIVN", "LCID"],
  },
  {
    key: "retail",
    label: "Retail / Consumo",
    match: ["retail", "catalog", "variety stores"],
    leaders: ["AMZN", "WMT", "COST", "HD", "TGT"],
  },
  {
    key: "bancos",
    label: "Bancos / Financieras",
    match: ["national commercial banks", "state commercial banks", "bank", "security brokers"],
    leaders: ["JPM", "BAC", "WFC", "C", "GS"],
  },
  {
    key: "salud",
    label: "Salud / Farmacéuticas",
    match: ["pharmaceutical", "biological products", "in vitro", "medicinal"],
    leaders: ["LLY", "JNJ", "MRK", "PFE", "ABBV"],
  },
  {
    key: "energia",
    label: "Energía",
    match: ["crude petroleum", "petroleum refining", "natural gas", "oil"],
    leaders: ["XOM", "CVX", "COP", "SLB", "OXY"],
  },
  {
    key: "comunicacion",
    label: "Comunicación / Medios",
    match: ["television broadcasting", "cable", "motion picture", "services-computer programming, data"],
    leaders: ["GOOGL", "META", "NFLX", "DIS", "T"],
  },
  {
    key: "indices",
    label: "Índices / ETFs",
    match: [],
    leaders: ["SPY", "QQQ", "IWM", "DIA", "VOO"],
  },
];

/** Atajo ticker → sector para los nombres más buscados (gana sobre el SIC). */
export const TICKER_SECTOR: Record<string, string> = {
  NVDA: "semiconductores", AMD: "semiconductores", AVGO: "semiconductores",
  MU: "semiconductores", INTC: "semiconductores", TSM: "semiconductores", QCOM: "semiconductores", ARM: "semiconductores",
  AAPL: "tecnologia", MSFT: "tecnologia", GOOGL: "tecnologia", GOOG: "tecnologia", AMZN: "tecnologia", META: "tecnologia",
  ORCL: "software", CRM: "software", ADBE: "software", NOW: "software", PLTR: "software", SNOW: "software",
  TSLA: "autos-ev", F: "autos-ev", GM: "autos-ev", RIVN: "autos-ev", LCID: "autos-ev", NIO: "autos-ev",
  WMT: "retail", COST: "retail", HD: "retail", TGT: "retail", LOW: "retail",
  JPM: "bancos", BAC: "bancos", WFC: "bancos", C: "bancos", GS: "bancos", MS: "bancos",
  LLY: "salud", JNJ: "salud", MRK: "salud", PFE: "salud", ABBV: "salud", MRNA: "salud",
  XOM: "energia", CVX: "energia", COP: "energia", SLB: "energia", OXY: "energia",
  NFLX: "comunicacion", DIS: "comunicacion", T: "comunicacion", VZ: "comunicacion",
  SPY: "indices", QQQ: "indices", IWM: "indices", DIA: "indices", VOO: "indices",
};

/** Resuelve el sector de un ticker por atajo o por palabras del sic_description. */
export function resolveSector(
  ticker: string,
  sicDescription: string | null,
): SectorDef | null {
  const t = ticker.trim().toUpperCase();
  const key = TICKER_SECTOR[t];
  if (key) {
    const def = SECTOR_DEFS.find((d) => d.key === key);
    if (def) return def;
  }
  const sic = (sicDescription ?? "").toLowerCase();
  if (sic) {
    for (const def of SECTOR_DEFS) {
      if (def.match.some((m) => sic.includes(m))) return def;
    }
  }
  return null;
}

/** Los 5 líderes del sector, sin repetir al propio ticker. */
export function peerTickers(ticker: string, def: SectorDef): string[] {
  const t = ticker.trim().toUpperCase();
  return def.leaders.filter((l) => l !== t);
}
