// ============================================================================
// Récord de aciertos de Tito (vista Mercado).
// Cada día de mercado se guarda la lectura (dirección + imán). Días después se
// compara contra las barras reales para medir si: (1) el precio se movió en la
// dirección marcada y (2) llegó al imán. Así Tito acumula un historial honesto.
//
// Lógica de evaluación y resumen = PURAS (tests en mercadoRecord.test.ts).
// El I/O (leer/escribir el archivo, traer barras) vive en la ruta.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { marketLearningNote, type MarketRead } from "./mercado";

const RECORD_FILE = process.env.TITO_RECORD_FILE || "data/mercado-record.json";

export interface DailyBar {
  date: string; // yyyy-mm-dd
  high: number;
  low: number;
  close: number;
}

export interface MercadoRecord {
  date: string; // fecha ET de la lectura (yyyy-mm-dd)
  ticker: string; // SPY / QQQ
  label: string;
  direction: "alcista" | "bajista" | "lateral";
  verdict: string; // alza/baja/rango/mixta/no-fiable/sin-datos
  etfPrice: number; // precio del ETF (Alpaca) al momento de la lectura
  priceFut: number | null; // precio del futuro (tastytrade)
  magnetFut: number | null; // imán en escala del índice/futuro
  etfTarget: number | null; // imán convertido a escala del ETF (para revisar con barras)
  evaluated: boolean;
  outcome?: {
    barDate: string;
    close: number;
    directionHit: boolean | null; // ¿cerró en la dirección marcada?
    reachedMagnet: boolean | null; // ¿tocó el imán?
  };
}

/** Fecha en horario del Este como yyyy-mm-dd. */
export function etDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Construye los registros del día a partir de la lectura de mercado (PURO). */
export function buildRecords(markets: MarketRead[], date: string): MercadoRecord[] {
  return markets.map((m) => {
    const g = m.gex;
    const etfPrice = m.price ?? 0;
    const priceFut = g?.realtimePrice ?? null;
    const magnetFut = g?.magnet ?? null;
    const etfTarget =
      priceFut && magnetFut && priceFut > 0 ? magnetFut * (etfPrice / priceFut) : null;
    return {
      date,
      ticker: m.ticker,
      label: m.label,
      direction: m.direction,
      verdict: marketLearningNote(m)?.verdict ?? "sin-datos",
      etfPrice,
      priceFut,
      magnetFut,
      etfTarget,
      evaluated: false,
    };
  });
}

/**
 * Evalúa los registros vencidos contra las barras diarias reales (PURO).
 * Un registro de la fecha D se evalúa con la barra de ESE día D (ya cerrada).
 */
export function reviewRecords(
  records: MercadoRecord[],
  barsByTicker: Record<string, DailyBar[]>,
  today: string,
): { records: MercadoRecord[]; changed: boolean } {
  let changed = false;
  for (const r of records) {
    if (r.evaluated || r.date >= today) continue;
    const bar = (barsByTicker[r.ticker] ?? []).find((b) => b.date === r.date);
    if (!bar) continue; // barra aún no disponible

    const directionHit =
      r.direction === "lateral"
        ? null
        : r.direction === "alcista"
          ? bar.close > r.etfPrice
          : bar.close < r.etfPrice;

    let reachedMagnet: boolean | null = null;
    if (r.etfTarget != null) {
      reachedMagnet =
        r.etfTarget >= r.etfPrice ? bar.high >= r.etfTarget : bar.low <= r.etfTarget;
    }

    r.evaluated = true;
    r.outcome = { barDate: bar.date, close: bar.close, directionHit, reachedMagnet };
    changed = true;
  }
  return { records, changed };
}

/** Resumen en una línea del récord acumulado (PURO). */
export function recordSummary(records: MercadoRecord[]): string {
  const ev = records.filter((r) => r.evaluated && r.outcome);
  if (!ev.length) return "📊 Récord: aún sin lecturas vencidas para evaluar.";
  const dir = ev.filter((r) => r.outcome!.directionHit !== null);
  const dirHits = dir.filter((r) => r.outcome!.directionHit).length;
  const mag = ev.filter((r) => r.outcome!.reachedMagnet !== null);
  const magHits = mag.filter((r) => r.outcome!.reachedMagnet).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const parts = [`📊 Récord (${ev.length} lecturas):`];
  if (dir.length) parts.push(`dirección ${pct(dirHits, dir.length)}% (${dirHits}/${dir.length})`);
  if (mag.length) parts.push(`· llegó al imán ${pct(magHits, mag.length)}% (${magHits}/${mag.length})`);
  return parts.join(" ");
}

export function readRecords(): MercadoRecord[] {
  try {
    return JSON.parse(fs.readFileSync(RECORD_FILE, "utf8")) as MercadoRecord[];
  } catch {
    return [];
  }
}

export function writeRecords(records: MercadoRecord[]): void {
  try {
    fs.mkdirSync(path.dirname(RECORD_FILE), { recursive: true });
    fs.writeFileSync(RECORD_FILE, JSON.stringify(records));
  } catch {
    // si no se puede persistir, no es crítico para servir la página
  }
}
