// GET /api/health — endpoint público y ligero para el "despertador".
// No toca datos ni claves; solo responde 200 para que el ping mantenga viva la
// instancia de Render (y quede fuera de la puerta de contraseña, ver middleware).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
