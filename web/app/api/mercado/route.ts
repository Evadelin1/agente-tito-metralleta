// GET /api/mercado — lectura rápida del mercado (SPY + QQQ) con Alpaca.
// Dirección, dónde se mueven los millones, techo y piso. Para el botón "Mercado".

import { fetchAlpacaFlow, fetchAlpacaStockQuote, hasAlpacaKeys, AlpacaError } from "@/lib/alpaca";
import { classifyFlow } from "@/lib/flow";
import { analyzeMarket, gexFromOptions, type MarketRead } from "@/lib/mercado";
import { hasTastytrade, opcionesGammaOI, precio } from "@/lib/tastytrade";

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
    fetchAlpacaFlow(spec.ticker, { minPremium: 100_000, maxPages: 6 }),
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

export async function GET() {
  if (!hasAlpacaKeys()) {
    return Response.json(
      { error: "Faltan las claves de Alpaca en el servidor." },
      { status: 503 },
    );
  }
  const now = new Date();
  try {
    const markets = await Promise.all(INDICES.map((i) => readOne(i, now)));
    return Response.json({ markets, generatedAt: now.toISOString() });
  } catch (err) {
    const message = err instanceof AlpacaError ? err.message : "No se pudo leer el mercado.";
    return Response.json({ error: message }, { status: 502 });
  }
}
