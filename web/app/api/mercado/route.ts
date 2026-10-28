// GET /api/mercado — lectura rápida del mercado (SPY + QQQ) con Alpaca.
// Dirección, dónde se mueven los millones, techo y piso. Para el botón "Mercado".

import { fetchAlpacaFlow, fetchAlpacaStockQuote, hasAlpacaKeys, AlpacaError } from "@/lib/alpaca";
import { classifyFlow } from "@/lib/flow";
import { analyzeMarket, gexFromOptions, type MarketRead } from "@/lib/mercado";
import { hasTastytrade, opcionesGammaOI, precio } from "@/lib/tastytrade";
import { notifyAlignment } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPY ≙ S&P 500 (índice SPX, futuro MES); QQQ ≙ Nasdaq (índice NDX, futuro MNQ).
const INDICES: {
  ticker: string; label: string; index: "SPX" | "NDX"; future: string;
}[] = [
  { ticker: "SPY", label: "S&P 500 · MES", index: "SPX", future: process.env.TITO_MES_FUTURE || "/MESZ6" },
  { ticker: "QQQ", label: "Nasdaq · MNQ", index: "NDX", future: process.env.TITO_MNQ_FUTURE || "/MNQZ6" },
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
        opcionesGammaOI(spec.index, { dteMax: 1, timeoutMs: 18000 }),
        precio(spec.future).catch(() => null),
      ]);
      if (go.options.length > 0) {
        const gex = gexFromOptions(go.options, go.spot || 0);
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
    return Response.json({ ...cache, stale: Date.now() - lastRefresh > TTL_MS });
  }

  // Primera carga sin caché: aseguramos un cálculo y esperamos un poco.
  void refresh();
  const deadline = Date.now() + FIRST_WAIT_MS;
  while (!cache && Date.now() < deadline) await sleep(500);

  if (cache) return Response.json(cache);
  return Response.json(
    { error: lastError ?? "Calculando el mercado por primera vez… reintenta en unos segundos." },
    { status: 503 },
  );
}
