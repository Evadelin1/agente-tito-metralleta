// ============================================================================
// Aviso al celular cuando un índice se pone ALINEADO (señal limpia).
// Reusa el veredicto de marketLearningNote. Envía por Telegram (mismo canal que
// Evolet, si configuras TITO_TG_TOKEN + TITO_TG_CHAT). Es best-effort: si no hay
// credenciales o falla la red, no rompe el refresco del mercado.
//
// Anti-spam: solo avisa en el CRUCE a alineada (no en cada refresco) y solo
// durante el horario de mercado de EE.UU. El último veredicto avisado se guarda
// en disco para no repetir ni perderse entre reinicios.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { marketLearningNote, type MarketRead } from "./mercado";

const STATE_FILE = process.env.TITO_ALERT_STATE || "data/mercado-alert-state.json";

function configured(): boolean {
  return !!process.env.TITO_TG_TOKEN && !!process.env.TITO_TG_CHAT;
}

/** ¿Estamos en horario de mercado de EE.UU. (lun-vie, 9:30–16:00 ET)? */
function inMarketHours(d = new Date()): boolean {
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TITO_TG_TOKEN;
  const chat = process.env.TITO_TG_CHAT;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // best-effort: un fallo de envío no debe afectar al mercado
  }
}

/** ¿Es la ventana de apertura para el resumen diario? (lun-vie 9:35–9:55 ET) */
export function isSummaryTime(d = new Date()): boolean {
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 35 && mins <= 9 * 60 + 55;
}

const DAILY_STATE_FILE = process.env.TITO_DAILY_STATE || "data/mercado-daily-state.json";

function readDailyState(): { lastSummary?: string } {
  try {
    return JSON.parse(fs.readFileSync(DAILY_STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeDailyState(s: { lastSummary?: string }): void {
  try {
    fs.mkdirSync(path.dirname(DAILY_STATE_FILE), { recursive: true });
    fs.writeFileSync(DAILY_STATE_FILE, JSON.stringify(s));
  } catch {
    /* no crítico */
  }
}

/**
 * Resumen de apertura al celular: la lectura de MES y MNQ + el récord acumulado.
 * Se envía una sola vez por día, en la ventana de apertura. Devuelve true si envió.
 */
export async function notifyDailySummary(
  markets: MarketRead[],
  recordLine: string,
  today: string,
): Promise<boolean> {
  if (!configured() || !isSummaryTime()) return false;
  const state = readDailyState();
  if (state.lastSummary === today) return false;

  const bloques = markets.map((m) => {
    const note = marketLearningNote(m);
    const g = m.gex;
    const price = g?.realtimePrice ?? m.price;
    const dir =
      m.direction === "alcista" ? "ALCISTA 🟢" : m.direction === "bajista" ? "BAJISTA 🔴" : "LATERAL ⚪";
    const fut = m.label.split("·").pop()?.trim() || m.ticker;
    return (
      `<b>${fut}</b>: ${dir}\n` +
      `  precio ${price ?? "—"} · imán ${g?.magnet ?? "—"}\n` +
      `  ${note?.title ?? ""}`
    );
  });

  await sendTelegram(
    `☀️ <b>Tito — resumen de apertura</b>\n\n${bloques.join("\n\n")}\n\n${recordLine}\n\n` +
      `Contexto, no consejo. Tú decides y pones tu stop.`,
  );
  writeDailyState({ lastSummary: today });
  return true;
}

type AlertState = Record<string, string>; // ticker -> último veredicto avisado

function readState(): AlertState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AlertState;
  } catch {
    return {};
  }
}

function writeState(s: AlertState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch {
    // si no se puede persistir, el peor caso es un aviso repetido; no es grave
  }
}

/**
 * Revisa los mercados y avisa al celular los que ACABAN de ponerse alineados.
 * Llamar tras cada refresco. No lanza: captura todo internamente.
 */
export async function notifyAlignment(markets: MarketRead[]): Promise<void> {
  if (!configured() || !inMarketHours()) return;
  const state = readState();
  let changed = false;

  for (const m of markets) {
    const verdict = marketLearningNote(m)?.verdict ?? "none";
    const aligned = verdict === "alza" || verdict === "baja";
    const prev = state[m.ticker];

    if (aligned && prev !== verdict) {
      const dir = verdict === "alza" ? "ALZA 🟢" : "BAJA 🔴";
      const price = m.gex?.realtimePrice ?? m.price;
      const magnet = m.gex?.magnet;
      const fut = m.label.split("·").pop()?.trim() || m.ticker;
      await sendTelegram(
        `🧭 <b>Tito — señal ALINEADA</b>\n` +
          `${m.ticker} · ${fut}\n` +
          `➡️ <b>${dir}</b>\n` +
          `Precio ${price ?? "—"} · imán ${magnet ?? "—"}\n\n` +
          `Contexto, no consejo. Confírmalo en tu gráfica y pon tu stop.`,
      );
      state[m.ticker] = verdict;
      changed = true;
    } else if (!aligned && prev) {
      // dejó de estar alineada → permitir avisar de nuevo en el próximo cruce
      delete state[m.ticker];
      changed = true;
    }
  }

  if (changed) writeState(state);
}
