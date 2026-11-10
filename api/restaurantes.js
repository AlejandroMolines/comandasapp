import { listarRestaurantes } from "./_lib/http.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }
  return listarRestaurantes(req, res);
}
