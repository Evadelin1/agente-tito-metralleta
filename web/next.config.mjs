/** @type {import('next').NextConfig} */
const nextConfig = {
  // `ws` (DXLink de tastytrade) debe correr sin que Next lo empaquete; si lo
  // bundlea, el WebSocket conecta pero no envía/recibe (servidor mudo).
  serverExternalPackages: ["ws"],
};

export default nextConfig;
