"use client";

import type { FlowBias, SectorComparison, FlowDirection } from "@/lib/sector";

// Tarea 3 — Comparación sectorial vs. individual.
// ¿El flujo de este ticker acompaña a los líderes de su sector, o es algo propio?

function dirPill(d: FlowDirection): string {
  return d === "alcista" ? "call" : d === "bajista" ? "put" : "agg-mid";
}
function dirLabel(d: FlowDirection): string {
  return d === "alcista" ? "ALCISTA" : d === "bajista" ? "BAJISTA" : "SIN RUMBO";
}

const VERDICT_CLASS: Record<SectorComparison["verdict"], string> = {
  sectorial: "up",
  individual: "neutral",
  mixto: "neutral",
  indeterminado: "muted",
};

function Line({ b, self }: { b: FlowBias; self?: boolean }) {
  return (
    <tr style={self ? { fontWeight: 700 } : undefined}>
      <td>
        {b.ticker}
        {self && <span className="muted" style={{ fontWeight: 400 }}> · tú</span>}
        {b.isLeader && !self && <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}> · líder</span>}
      </td>
      <td>
        {b.ok ? (
          <span className={`pill ${dirPill(b.direction)}`}>{dirLabel(b.direction)}</span>
        ) : (
          <span className="val-tag pending">sin datos</span>
        )}
      </td>
      <td className="num">{b.callPct != null ? `${b.callPct.toFixed(0)}%` : "—"}</td>
    </tr>
  );
}

export default function SectorCard({ s }: { s: SectorComparison }) {
  const cls = VERDICT_CLASS[s.verdict];

  return (
    <section className="card">
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Comparación sectorial</div>
        <div className="card-sub">
          ¿El flujo de {s.ticker} es de toda la industria o solo de este nombre? · {s.sectorLabel}
        </div>
      </div>

      <div className={`score-verdict ${cls}`} style={{ marginTop: 12 }}>{s.label}</div>
      <p style={{ margin: "6px 0 0", maxWidth: "62ch", lineHeight: 1.5 }}>{s.headline}</p>

      {s.measuredPeers > 0 && (
        <div className="card-sub" style={{ marginTop: 8 }}>
          {s.agree} de {s.measuredPeers} líderes de {s.sectorLabel} apuntan en la misma dirección
          {s.alignedPct != null && ` (${s.alignedPct.toFixed(0)}%)`}.
        </div>
      )}

      {(s.subject.ok || s.peers.length > 0) && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Dirección del flujo</th>
                <th className="num">Calls</th>
              </tr>
            </thead>
            <tbody>
              <Line b={s.subject} self />
              {s.peers.map((p) => <Line key={p.ticker} b={p} />)}
            </tbody>
          </table>
        </div>
      )}

      <div className="iv-note">
        La dirección se lee del <b>nocional en calls vs. puts</b> (una muestra de los vencimientos más
        cercanos), no del lado de ejecución. Es un indicio de posicionamiento del sector, no de agresividad.
        Los líderes son un universo curado por liquidez de opciones.
      </div>
    </section>
  );
}
