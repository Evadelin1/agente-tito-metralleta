import { NextResponse, type NextRequest } from "next/server";

// Puerta de contraseña para el despliegue público.
// Solo se activa si SITE_PASSWORD está definido en el entorno del servidor,
// así el desarrollo local (sin esa variable) queda abierto.
// Protege la cuota de la API de Massive y la cookie de MarketSnack: sin login,
// cualquiera con el link gastaría TUS créditos.
export function middleware(req: NextRequest) {
  const pass = process.env.SITE_PASSWORD;
  if (!pass) return NextResponse.next(); // sin contraseña configurada → abierto (local)

  const user = process.env.SITE_USER || "tito";
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === user && p === pass) return NextResponse.next();
    } catch {
      // credencial malformada → cae al 401 de abajo
    }
  }

  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Tito Metralleta"' },
  });
}

// Protege todo menos los assets estáticos.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
