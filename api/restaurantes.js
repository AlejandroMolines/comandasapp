import { listarRestaurantes } from "./_lib/http.mjs";
import { requiereSuperadmin } from "./_lib/superadmin.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Vary", "Cookie");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }
  if (!requiereSuperadmin(req, res)) return;
  return listarRestaurantes(req, res);
}
