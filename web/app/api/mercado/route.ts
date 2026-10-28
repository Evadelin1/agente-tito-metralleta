// GET /api/mercado — lectura rápida del mercado (SPY + QQQ) con Alpaca.
// Dirección, dónde se mueven los millones, techo y piso. Para el botón "Mercado".

import { fetchAlpacaFlow, fetchAlpacaStockQuote, hasAlpacaKeys, AlpacaError } from "@/lib/alpaca";
import { classifyFlow } from "@/lib/flow";
import { analyzeMarket, type MarketRead } from "@/lib/mercado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INDICES: { ticker: string; label: string }[] = [
  { ticker: "SPY", label: "S&P 500 · MES" },
  { ticker: "QQQ", label: "Nasdaq · MNQ" },
];

async function readOne(ticker: string, label: string, now: Date): Promise<MarketRead> {
  const [flow, quote] = await Promise.all([
    fetchAlpacaFlow(ticker, { minPremium: 100_000, maxPages: 6 }),
    fetchAlpacaStockQuote(ticker),
  ]);
  const { rows } = classifyFlow(flow.trades, now);
  const spot = quote.price ?? rows.find((r) => r.assetPrice)?.assetPrice ?? null;
  return analyzeMarket(ticker, label, rows, spot, quote.prevClose);
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
    const markets = await Promise.all(INDICES.map((i) => readOne(i.ticker, i.label, now)));
    return Response.json({ markets, generatedAt: now.toISOString() });
  } catch (err) {
    const message = err instanceof AlpacaError ? err.message : "No se pudo leer el mercado.";
    return Response.json({ error: message }, { status: 502 });
  }
}
