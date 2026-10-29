// GET /api/mercado — lectura rápida del mercado (SPY + QQQ) con Alpaca.
// Dirección, dónde se mueven los millones, techo y piso. Para el botón "Mercado".

import { fetchAlpacaDailyBars, fetchAlpacaFlow, fetchAlpacaStockQuote, hasAlpacaKeys, AlpacaError } from "@/lib/alpaca";
import { classifyFlow } from "@/lib/flow";
import { analyzeMarket, gexFromOptions, scaleGex, type MarketRead } from "@/lib/mercado";
import { hasTastytrade, opcionesGammaOI, precio } from "@/lib/tastytrade";
import { notifyAlignment, notifyDailySummary, isSummaryTime } from "@/lib/notify";
import {
  buildRecords, etDate, readRecords, recordSummary, reviewRecords, writeRecords,
  type DailyBar,
} from "@/lib/mercadoRecord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPY ≙ S&P 500 (índice SPX, futuro MES); QQQ ≙ Nasdaq (índice NDX, futuro MNQ).
//
// `gexFrom` = de dónde sale el GEX/imán:
//   - SPX: opciones del índice (muy líquidas, strikes ~ a escala del MES).
//   - QQQ: el ÍNDICE NDX tiene poco OI (máx ~142 verificado vs 16.550 de SPX), así
//     que el imán del Nasdaq se saca de las opciones de QQQ (ETF líquido) y se
//     ESCALA a escala MNQ con factor = precioFuturo/spotQQQ. Ampliar el DTE de NDX
//     no ayudaba (diluía); la fuente era el problema, no el vencimiento.
const INDICES: {
  ticker: string; label: string; gexFrom: "SPX" | "NDX" | "QQQ" | "SPY";
  future: string; dteMax: number; scaleToFuture: boolean;
}[] = [
  { ticker: "SPY", label: "S&P 500 · MES", gexFrom: "SPX", future: process.env.TITO_MES_FUTURE || "/MESZ6", dteMax: 1, scaleToFuture: false },
  { ticker: "QQQ", label: "Nasdaq · MNQ", gexFrom: "QQQ", future: process.env.TITO_MNQ_FUTURE || "/MNQZ6", dteMax: 1, scaleToFuture: true },
];

async function readOne(
  spec: (typeof INDICES)[number],
  now: Date,
): Promise<MarketRead> {
  const [flow, quote] = await Promise.all([
    // maxPages bajo: la VM e2-micro comparte CPU con los demás agentes; 3 páginas
    // cubren los vencimientos cercanos sin saturarla.
    fetchAlpacaFlow(spec.ticker, { minPremium: 100_000, maxPages: 3 }),
    fetchAlpacaStockQuote(spec.ticker),
  ]);
  const { rows } = classifyFlow(flow.trades, now);
  const spot = quote.price ?? rows.find((r) => r.assetPrice)?.assetPrice ?? null;
  const read = analyzeMarket(spec.ticker, spec.label, rows, spot, quote.prevClose);

  // Enriquecer con GEX real + precio de futuro (tastytrade), si hay credenciales.
  if (hasTastytrade()) {
    try {
      const [go, fut] = await Promise.all([
        opcionesGammaOI(spec.gexFrom, { dteMax: spec.dteMax, timeoutMs: 18000 }),
        // 14s (no 6s): en la VM pequeña el handshake de DXLink tarda y el precio
        // del futuro llegaba null, dejando el veredicto en "sin datos".
        precio(spec.future, 14000).catch(() => null),
      ]);
      if (go.options.length > 0) {
        let gex = gexFromOptions(go.options, go.spot || 0);
        // Nasdaq: el GEX se calcula en escala QQQ y se lleva a escala MNQ.
        if (spec.scaleToFuture && fut != null && go.spot > 0) {
          gex = scaleGex(gex, fut / go.spot);
        }
        gex.realtimePrice = fut;
        read.gex = gex;
      } else if (fut != null) {
        read.gex = { net: 0, regime: "—", magnet: null, realtimePrice: fut, callWall: null, putWall: null, topLevels: [] };
      }
    } catch {
      // GEX best-effort: si falla, la lectura de Alpaca ya es útil.
    }
  }
  return read;
}

// ----------------------------------------------------------------------------
// Caché + refresco en segundo plano.
// El cálculo (Alpaca + tastytrade para SPY y QQQ) es pesado para la VM e2-micro
// y, si se dispara en cada carga, se apila y nunca termina. En vez de eso:
//   - un único cálculo corre a la vez (bandera `refreshing`),
//   - la página siempre recibe al instante el ÚLTIMO resultado guardado,
//   - el refresco ocurre en segundo plano cada TTL.
// Así el celular carga inmediato y el trabajo pesado no molesta a los agentes.
// ----------------------------------------------------------------------------
const TTL_MS = 120_000; // 2 min: cada cuánto se refresca en segundo plano
const FIRST_WAIT_MS = 25_000; // cuánto espera la PRIMERA carga (caché aún vacía)

let cache: { markets: MarketRead[]; generatedAt: string } | null = null;
let refreshing = false;
let lastRefresh = 0;
let lastError: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  const now = new Date();
  try {
    const markets = await Promise.all(INDICES.map((i) => readOne(i, now)));
    cache = { markets, generatedAt: now.toISOString() };
    lastRefresh = Date.now();
    lastError = null;
    // Avisa al celular los índices que acaban de ponerse alineados (best-effort).
    void notifyAlignment(markets);
    // En la ventana de apertura: revisa el récord de ayer, manda el resumen
    // diario y guarda la lectura de hoy. Fuera de esa ventana no hace nada
    // (así no gasta llamadas de barras en cada refresco).
    void dailyRecordAndSummary(markets);
  } catch (err) {
    lastError = err instanceof AlpacaError ? err.message : "No se pudo leer el mercado.";
    // Se conserva la caché anterior (si la hay): mejor datos viejos que nada.
  } finally {
    refreshing = false;
  }
}

// Calienta la caché al arrancar el servidor y la mantiene fresca, sin depender
// de que alguien cargue la página.
if (hasAlpacaKeys()) {
  void refresh();
  setInterval(() => void refresh(), TTL_MS);
}

// En la ventana de apertura (9:35–9:55 ET): evalúa el récord contra las barras
// reales, envía el resumen diario al celular y guarda la lectura de hoy una vez.
async function dailyRecordAndSummary(markets: MarketRead[]): Promise<void> {
  if (!isSummaryTime()) return;
  try {
    const today = etDate();
    let recs = readRecords();

    // 1) Evaluar lecturas vencidas con barras diarias reales (Alpaca).
    if (recs.some((r) => !r.evaluated && r.date < today)) {
      const barsByTicker: Record<string, DailyBar[]> = {};
      for (const i of INDICES) barsByTicker[i.ticker] = await fetchAlpacaDailyBars(i.ticker, 15);
      const { records, changed } = reviewRecords(recs, barsByTicker, today);
      if (changed) { writeRecords(records); recs = records; }
    }

    // 2) Resumen diario al celular (una vez por día).
    const sent = await notifyDailySummary(markets, recordSummary(recs), today);

    // 3) Guardar la lectura de hoy una sola vez.
    if (sent && !recs.some((r) => r.date === today)) {
      writeRecords([...recs, ...buildRecords(markets, today)]);
    }
  } catch {
    // best-effort: nunca romper el refresco del mercado
  }
}

export async function GET() {
  if (!hasAlpacaKeys()) {
    return Response.json(
      { error: "Faltan las claves de Alpaca en el servidor." },
      { status: 503 },
    );
  }

  // Si hay caché, se sirve al instante; si está vieja, se refresca por detrás.
  if (cache) {
    if (Date.now() - lastRefresh > TTL_MS) void refresh();
    return Response.json({ ...cache, stale: Date.now() - lastRefresh > TTL_MS, record: recordSummary(readRecords()) });
  }

  // Primera carga sin caché: aseguramos un cálculo y esperamos un poco.
  void refresh();
  const deadline = Date.now() + FIRST_WAIT_MS;
  while (!cache && Date.now() < deadline) await sleep(500);

  // Cast: TS cree que `cache` sigue null tras el return anterior, pero `refresh()`
  // lo reasigna durante el await del bucle de arriba.
  const ready = cache as { markets: MarketRead[]; generatedAt: string } | null;
  if (ready) {
    return Response.json({
      markets: ready.markets,
      generatedAt: ready.generatedAt,
      record: recordSummary(readRecords()),
    });
  }
  return Response.json(
    { error: lastError ?? "Calculando el mercado por primera vez… reintenta en unos segundos." },
    { status: 503 },
  );
}
