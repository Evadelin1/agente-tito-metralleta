"use client";

import { useCallback, useEffect, useState } from "react";
import NavTabs from "../components/NavTabs";
import { marketLearningNote, type MarketRead } from "@/lib/mercado";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
});
const px = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const DIR = {
  alcista: { dot: "🟢", word: "ALCISTA", cls: "up" },
  bajista: { dot: "🔴", word: "BAJISTA", cls: "down" },
  lateral: { dot: "⚪", word: "LATERAL", cls: "neutral" },
} as const;

function pct(n: number | null, signed = false): string {
  if (n == null) return "—";
  const s = `${Math.abs(n).toFixed(signed ? 1 : 0)}%`;
  if (!signed) return s;
  return `${n >= 0 ? "+" : "−"}${s}`;
}

const NOTE_BG: Record<string, string> = {
  alza: "#e7f6ec", baja: "#fdeaea", rango: "#eef1f5",
  mixta: "#fff6e5", "no-fiable": "#fff6e5", "sin-datos": "#eef1f5",
};

function MarketCard({ m }: { m: MarketRead }) {
  const d = DIR[m.direction];
  const note = marketLearningNote(m);
  return (
    <section className="card" style={{ gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{m.ticker}</div>
          <div className="card-sub">{m.label}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{m.price != null ? `$${px.format(m.price)}` : "—"}</div>
          {m.todayPct != null && (
            <div className={m.todayPct >= 0 ? "up" : "down"} style={{ fontWeight: 700 }}>
              {pct(m.todayPct, true)} hoy
            </div>
          )}
        </div>
      </div>

      {/* Dirección */}
      <div className={`score-verdict ${d.cls}`} style={{ fontSize: 22, display: "flex", alignItems: "center", gap: 8 }}>
        {d.dot} {d.word} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>· {m.strength}</span>
      </div>

      {/* Barra calls vs puts — dónde está el dinero */}
      {m.callPct != null && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            <span className="up">{Math.round(m.callPct)}% calls (alza)</span>
            <span className="down">{Math.round(m.putPct ?? 0)}% puts (baja)</span>
          </div>
          <div style={{ height: 10, borderRadius: 6, overflow: "hidden", display: "flex", background: "var(--red-bg)" }}>
            <div style={{ width: `${m.callPct}%`, background: "var(--green-dark)" }} />
          </div>
        </div>
      )}

      {/* Techo y piso — techo GRIS, piso NEGRO */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, background: "#f1f3f5", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>⬜ TECHO</div>
          <div style={{ fontWeight: 800, color: "#6b7280" }}>{m.resistance != null ? `$${px.format(m.resistance)}` : "—"}</div>
        </div>
        <div style={{ flex: 1, background: "#e9ecef", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "#111", fontWeight: 700 }}>⬛ PISO</div>
          <div style={{ fontWeight: 800, color: "#111" }}>{m.support != null ? `$${px.format(m.support)}` : "—"}</div>
        </div>
      </div>

      {/* Dónde van los millones */}
      {m.topFlows.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", marginBottom: 4 }}>
            DÓNDE VAN LOS MILLONES HOY
          </div>
          {m.topFlows.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "2px 0" }}>
              <span>
                ${px.format(f.strike)}<span className={`pill ${f.type === "call" ? "call" : "put"}`} style={{ marginLeft: 6 }}>
                  {f.type === "call" ? "CALL" : "PUT"}
                </span>
              </span>
              <b>{money.format(f.premium)}</b>
            </div>
          ))}
        </div>
      )}

      {m.gex && (
        <div style={{ background: "var(--surface-2, #eef1f5)", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", marginBottom: 4 }}>
            GEX REAL · tastytrade (tiempo real)
          </div>
          {m.gex.realtimePrice != null && (
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
              Tu futuro ({m.label.split("·").pop()?.trim()}): {px.format(m.gex.realtimePrice)}
            </div>
          )}
          {(m.gex.callWall != null || m.gex.putWall != null) && (
            <div style={{ display: "flex", gap: 14, fontSize: 14, marginBottom: 2 }}>
              <span style={{ color: "#6b7280" }}>⬜ Techo <b>{m.gex.callWall != null ? px.format(m.gex.callWall) : "—"}</b></span>
              <span style={{ color: "#111" }}>⬛ Piso <b>{m.gex.putWall != null ? px.format(m.gex.putWall) : "—"}</b></span>
            </div>
          )}
          <div style={{ fontSize: 14 }}>
            {m.gex.magnet != null && <>Imán <b>{px.format(m.gex.magnet)}</b> · </>}
            <span className={m.gex.net >= 0 ? "up" : "down"}>{m.gex.regime}</span>
          </div>
          {m.gex.topLevels.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", marginBottom: 2 }}>
                LAS 3 OPCIONES (más dinero puesto)
              </div>
              {m.gex.topLevels.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "1px 0" }}>
                  <span>
                    {px.format(l.strike)}<span className={`pill ${l.type === "C" ? "call" : "put"}`} style={{ marginLeft: 6 }}>
                      {l.type === "C" ? "CALL" : "PUT"}
                    </span>
                  </span>
                  <span className="muted">{Math.round(l.oi).toLocaleString()} OI</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 📚 Análisis para aprender — se quita luego */}
      {note && (
        <div style={{ background: NOTE_BG[note.verdict] ?? "#eef1f5", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", marginBottom: 4 }}>
            📚 ¿ESTÁN ALINEADAS? (modo aprendizaje)
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{note.title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
            {note.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <div className="iv-note" style={{ marginTop: 2 }}>{m.summary}</div>
    </section>
  );
}

export default function MercadoPage() {
  const [markets, setMarkets] = useState<MarketRead[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [record, setRecord] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    // La primera vez, el servidor puede estar calentando la caché: reintentamos
    // solos unas cuantas veces antes de rendirnos.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await fetch("/api/mercado", { cache: "no-store" });
        const d: { markets?: MarketRead[]; generatedAt?: string; error?: string; record?: string } = await r.json();
        if (!d.error) {
          setMarkets(d.markets ?? []);
          setAt(d.generatedAt ?? null);
          setRecord(d.record ?? null);
          setErr(null);
          setLoading(false);
          return;
        }
        setErr(d.error);
      } catch {
        setErr("No se pudo leer el mercado. Reintentando…");
      }
      await new Promise((res) => setTimeout(res, 5000));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="wrap page-stack">
      <div className="hb">
        <div className="hb-brand">
          <div className="hb-logo">T</div>
          <div className="hb-name">Tito Metralleta</div>
          <div className="hb-chip">Mercado</div>
        </div>
        <NavTabs />
      </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🧭 Mercado</h1>
            <div className="card-sub">SPY (= MES) y QQQ (= MNQ)</div>
          </div>
          <button className="nav-tab on" onClick={load} disabled={loading} style={{ fontWeight: 700 }}>
            {loading ? "Leyendo…" : "↻ Actualizar"}
          </button>
        </div>

        {err && <div className="error">⚠ {err}</div>}

        {!markets && !err && (
          <div className="card" style={{ textAlign: "center", padding: 32 }}>
            {loading ? "Leyendo el flujo del mercado…" : "Toca Actualizar para leer el mercado."}
          </div>
        )}

        {record && markets && (
          <div className="card" style={{ padding: "10px 14px", fontSize: 14, fontWeight: 600 }}>
            {record}
          </div>
        )}

        {markets && (
          <div className="grid-2">
            {markets.map((m) => <MarketCard key={m.ticker} m={m} />)}
          </div>
        )}

        {at && (
          <div className="disclaimer">
            Flujo de opciones de hoy (Alpaca), no es consejo financiero · leído {new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.
            Es la DIRECCIÓN del índice; los precios exactos de tus MES/MNQ los lees en tu gráfica.
          </div>
        )}
    </main>
  );
}
