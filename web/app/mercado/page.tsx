"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import NavTabs from "../components/NavTabs";
import type { MarketRead } from "@/lib/mercado";

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

function MarketCard({ m }: { m: MarketRead }) {
  const d = DIR[m.direction];
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

      <div className="card-sub" style={{ fontSize: 14 }}>{m.behavior}</div>

      {/* Techo y piso */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, background: "var(--red-bg)", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "#d92d20", fontWeight: 700 }}>🔴 TECHO</div>
          <div style={{ fontWeight: 800 }}>{m.resistance != null ? `$${px.format(m.resistance)}` : "—"}</div>
        </div>
        <div style={{ flex: 1, background: "var(--green-bg)", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "var(--green-dark)", fontWeight: 700 }}>🟢 PISO</div>
          <div style={{ fontWeight: 800 }}>{m.support != null ? `$${px.format(m.support)}` : "—"}</div>
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
              <span>🔴 Techo <b>{m.gex.callWall != null ? px.format(m.gex.callWall) : "—"}</b></span>
              <span>🟢 Piso <b>{m.gex.putWall != null ? px.format(m.gex.putWall) : "—"}</b></span>
            </div>
          )}
          <div style={{ fontSize: 14 }}>
            {m.gex.magnet != null && <>Imán <b>{px.format(m.gex.magnet)}</b> · </>}
            <span className={m.gex.net >= 0 ? "up" : "down"}>{m.gex.regime}</span>
          </div>
        </div>
      )}

      <div className="iv-note" style={{ marginTop: 2 }}>{m.summary}</div>

      <Link href={`/?ticker=${m.ticker}`} className="nav-tab" style={{ justifyContent: "center", fontWeight: 700 }}>
        Ver detalle completo (GEX, muros, escenarios) →
      </Link>
    </section>
  );
}

export default function MercadoPage() {
  const [markets, setMarkets] = useState<MarketRead[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetch("/api/mercado")
      .then((r) => r.json())
      .then((d: { markets?: MarketRead[]; generatedAt?: string; error?: string }) => {
        if (d.error) setErr(d.error);
        else {
          setMarkets(d.markets ?? []);
          setAt(d.generatedAt ?? null);
        }
      })
      .catch(() => setErr("No se pudo leer el mercado. Reintenta."))
      .finally(() => setLoading(false));
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
            <div className="card-sub">SPY (= MES) y QQQ (= MNQ) · lee el tape de opciones de hoy</div>
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
