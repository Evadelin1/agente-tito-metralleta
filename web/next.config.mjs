/** @type {import('next').NextConfig} */
const nextConfig = {
  // `ws` (DXLink de tastytrade) debe correr sin que Next lo empaquete; si lo
  // bundlea, el WebSocket conecta pero no envía/recibe (servidor mudo).
  serverExternalPackages: ["ws"],
  // Salida "standalone": empaqueta un server.js mínimo + solo las dependencias
  // que realmente usa. Imprescindible para correr en la VM e2-micro (poca RAM
  // y disco): se compila en la Mac y se sube solo este resultado.
  output: "standalone",
};

export default nextConfig;
