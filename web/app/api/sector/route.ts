// GET /api/sector?ticker=XXX — Tarea 3: ¿el flujo es SECTORIAL o INDIVIDUAL?
// Identifica las 5 líderes del sector del ticker y compara la dirección de su
// flujo de opciones (nocional calls vs puts) para etiquetar el hallazgo.

import { fetchCompany, fetchFlowBias } from "@/lib/massive";
import {
  classifySectorFlow,
  makeBias,
  peerTickers,
  resolveSector,
  type FlowBias,
  type SectorComparison,
} from "@/lib/sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) return Response.json({ error: "Falta el ticker." }, { status: 400 });

  try {
    // El atajo por ticker resuelve la mayoría sin pedir nada; solo si no lo
    // reconoce vamos a por el sic_description de la empresa.
    let def = resolveSector(ticker, null);
    if (!def) {
      const company = await fetchCompany(ticker).catch(() => null);
      def = resolveSector(ticker, company?.sector ?? null);
    }

    if (!def) {
      const subject: FlowBias = { ticker, callPct: null, direction: "neutral", strength: 0, ok: false };
      const body: SectorComparison = {
        ticker,
        sectorKey: null,
        sectorLabel: "Sector no reconocido",
        subject,
        peers: [],
        verdict: "indeterminado",
        label: "Sin sector",
        headline: `No hay un sector curado para ${ticker}, así que no se puede comparar su flujo con líderes de industria.`,
        agree: 0,
        disagree: 0,
        measuredPeers: 0,
        alignedPct: null,
      };
      return Response.json(body);
    }

    const peers = peerTickers(ticker, def);
    const tickers = [ticker, ...peers];

    // Muestra acotada por ticker (2 páginas): 6 tickers en paralelo.
    const raws = await Promise.all(tickers.map((t) => fetchFlowBias(t)));

    const subject = markLeader(makeBias(ticker, raws[0].callNotional, raws[0].putNotional, raws[0].ok), def.leaders);
    const peerBias = raws.slice(1).map((r) => markLeader(makeBias(r.ticker, r.callNotional, r.putNotional, r.ok), def!.leaders));

    const verdict = classifySectorFlow(subject, peerBias);

    const body: SectorComparison = {
      ticker,
      sectorKey: def.key,
      sectorLabel: def.label,
      subject,
      peers: peerBias,
      ...verdict,
    };
    return Response.json(body);
  } catch {
    return Response.json({ error: "No se pudo comparar el sector." }, { status: 502 });
  }
}

function markLeader(b: FlowBias, leaders: string[]): FlowBias {
  return { ...b, isLeader: leaders.includes(b.ticker) };
}
