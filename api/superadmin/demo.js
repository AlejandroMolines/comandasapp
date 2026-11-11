import { enviar, leerCuerpo } from "../_lib/http.mjs";
import { requiereSuperadmin, urlDemo } from "../_lib/superadmin.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  if (req.method !== "POST") return enviar(res, 405, { error: "Usa POST" });
  if (!requiereSuperadmin(req, res)) return;

  const base = urlDemo();
  if (!base) return enviar(res, 409, { error: "Configura DEMO_RESTAURANT_URL con el servidor demo (node iniciar.mjs --demo)." });
  const puente = process.env.DEMO_BRIDGE_TOKEN ?? "";
  if (!puente) return enviar(res, 503, { error: "Falta DEMO_BRIDGE_TOKEN, la misma clave en la central y en el servidor demo." });

  let body;
  try {
    body = await leerCuerpo(req);
  } catch {
    return enviar(res, 400, { error: "Solicitud inválida." });
  }
  const accion = body?.accion === "reiniciar" ? "reiniciar" : "entrada";
  const destino = body?.destino;
  const ruta = accion === "reiniciar" ? "/demo/reiniciar" : "/demo/entrada";
  try {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${puente}`,
      },
      body: JSON.stringify(accion === "reiniciar" ? {} : { destino }),
      signal: AbortSignal.timeout(8000),
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) return enviar(res, respuesta.status, { error: datos.error ?? "El restaurante demo no respondió." });
    return enviar(res, 200, datos);
  } catch {
    return enviar(res, 502, { error: "No se alcanza el restaurante demo. Comprueba que está arrancado y que la URL es correcta." });
  }
}
