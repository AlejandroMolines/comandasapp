import { gestionarVersiones } from "./_lib/versiones.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  return gestionarVersiones(req, res);
}
