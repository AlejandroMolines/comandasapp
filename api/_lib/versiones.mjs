import { enviar, leerCuerpo } from "./http.mjs";
import { tokenPresentado, tokenValido } from "./estado.mjs";
import { guardarControl, leerControl, modoPersistencia } from "./store.mjs";

const REPO = process.env.COMANDAS_GITHUB_REPO || "AlejandroMolines/comandasapp";
const SHA_RE = /^[a-f0-9]{40}$/i;

async function commitsDisponibles() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "Comandas-supercentral" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=main&per_page=30`, {
    headers,
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}`);
  const items = await response.json();
  return items.map((item) => ({
    sha: item.sha,
    fecha: item.commit?.committer?.date ?? item.commit?.author?.date ?? "",
    mensaje: String(item.commit?.message ?? "").split("\n", 1)[0].slice(0, 140),
  })).filter((item) => SHA_RE.test(item.sha));
}

export async function gestionarVersiones(req, res) {
  if (!process.env.NUBE_TOKEN) return enviar(res, 503, { error: "Configura NUBE_TOKEN en la central y en los Raspberry." });
  if (!tokenValido(tokenPresentado(req), process.env.NUBE_TOKEN)) return enviar(res, 401, { error: "Token de central incorrecto." });
  if (req.method !== "GET") return enviar(res, 405, { error: "Usa GET" });
  try {
    const release = await leerControl();
    return enviar(res, 200, { release: release?.pausada ? null : release, persistencia: modoPersistencia() });
  } catch (error) {
    console.error("[nube] no se pudo leer la versión publicada:", error);
    return enviar(res, 500, { error: "No se pudo leer la versión publicada." });
  }
}

export async function panelVersiones(req, res) {
  if (req.method === "GET") {
    try {
      const [commits, release] = await Promise.all([commitsDisponibles(), leerControl()]);
      const centralSha = (process.env.VERCEL_GIT_COMMIT_SHA || commits[0]?.sha || "").toLowerCase();
      return enviar(res, 200, {
        commits,
        centralSha,
        release,
        persistencia: modoPersistencia(),
      });
    } catch (error) {
      console.error("[superadmin] no se pudieron cargar las versiones:", error);
      return enviar(res, 502, { error: "No se pudieron consultar las versiones de GitHub. Revisa la conexión y el límite de consultas." });
    }
  }
  if (req.method !== "POST") return enviar(res, 405, { error: "Usa GET o POST" });
  if (!process.env.NUBE_TOKEN) return enviar(res, 503, { error: "Configura NUBE_TOKEN antes de publicar versiones." });
  if (modoPersistencia() === "memoria") return enviar(res, 503, { error: "Configura Postgres, KV o Vercel Blob para conservar la versión publicada." });

  let body;
  try { body = await leerCuerpo(req); } catch { return enviar(res, 400, { error: "Solicitud inválida." }); }
  if (body?.accion === "pausar" || body?.accion === "reanudar") {
    try {
      const anterior = await leerControl();
      if (!anterior?.sha) return enviar(res, 400, { error: "Todavía no hay una versión publicada que reanudar o pausar." });
      const release = { ...anterior, pausada: body.accion === "pausar", publicadaEn: new Date().toISOString() };
      await guardarControl(release);
      return enviar(res, 200, { release });
    } catch (error) {
      console.error("[superadmin] no se pudo pausar la publicación:", error);
      return enviar(res, 500, { error: "No se pudo guardar el cambio." });
    }
  }
  const sha = typeof body?.sha === "string" ? body.sha.toLowerCase() : "";
  if (!SHA_RE.test(sha)) return enviar(res, 400, { error: "Selecciona una versión válida." });
  try {
    const commits = await commitsDisponibles();
    const commit = commits.find((item) => item.sha === sha);
    if (!commit) return enviar(res, 400, { error: "Esa versión ya no está disponible entre las últimas versiones de main." });
    const publicada = await leerControl();
    if (publicada?.sha) {
      const indiceActual = commits.findIndex((item) => item.sha === publicada.sha);
      const indiceNueva = commits.findIndex((item) => item.sha === sha);
      if (indiceActual >= 0 && indiceNueva >= indiceActual) {
        return enviar(res, 409, { error: "Solo se pueden publicar versiones posteriores a la que ya está publicada." });
      }
    }
    const release = {
      sha,
      version: sha.slice(0, 12),
      mensaje: commit.mensaje,
      publicadaEn: new Date().toISOString(),
    };
    await guardarControl(release);
    return enviar(res, 200, { release });
  } catch (error) {
    console.error("[superadmin] no se pudo publicar la versión:", error);
    return enviar(res, 500, { error: "No se pudo publicar la versión." });
  }
}
