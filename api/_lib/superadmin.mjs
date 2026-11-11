import crypto from "node:crypto";
import { enviar, leerCuerpo } from "./http.mjs";

const NOMBRE_COOKIE = "comandas_superadmin";
const DURACION_SESION_S = 12 * 60 * 60;
const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 10;
const MAX_IPS = 5000;
const intentos = new Map();

function configuracion() {
  const usuario = process.env.SUPERADMIN_USER ?? "";
  const password = process.env.SUPERADMIN_PASSWORD ?? "";
  const secreto = process.env.SUPERADMIN_SESSION_SECRET ?? "";
  return {
    usuario,
    password,
    secreto,
    configurada: usuario.length > 0 && usuario.length <= 256 && password.length >= 16 && password.length <= 1024 && secreto.length >= 32,
  };
}

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

function firma(cuerpo, secreto) {
  return crypto.createHmac("sha256", secreto).update(cuerpo).digest("base64url");
}

function cookie(req) {
  const cabecera = String(req.headers?.cookie ?? "");
  const valor = cabecera.split(";").map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${NOMBRE_COOKIE}=`))?.slice(NOMBRE_COOKIE.length + 1);
  return valor ?? "";
}

function sesionValida(req) {
  const { secreto, configurada } = configuracion();
  if (!configurada) return false;
  const token = cookie(req);
  const punto = token.lastIndexOf(".");
  if (punto <= 0 || token.length > 2048) return false;
  const cuerpo = token.slice(0, punto);
  if (!igual(token.slice(punto + 1), firma(cuerpo, secreto))) return false;
  try {
    const payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    return payload?.u === configuracion().usuario && Number.isSafeInteger(payload?.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function emitirCookie(res, token, maxAge) {
  const valores = [
    `${NOMBRE_COOKIE}=${token}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") valores.push("Secure");
  res.setHeader("Set-Cookie", valores.join("; "));
}

function ip(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return (forwarded.at(-1) ?? req.socket?.remoteAddress ?? "desconocida").slice(0, 80);
}

function bloqueado(direccion) {
  const ahora = Date.now();
  const actual = intentos.get(direccion);
  if (!actual || actual.hasta <= ahora) {
    intentos.delete(direccion);
    return 0;
  }
  return actual.cuenta >= MAX_INTENTOS ? Math.ceil((actual.hasta - ahora) / 1000) : 0;
}

function fallo(direccion) {
  const ahora = Date.now();
  for (const [clave, valor] of intentos) if (valor.hasta <= ahora) intentos.delete(clave);
  if (intentos.size >= MAX_IPS && !intentos.has(direccion)) intentos.delete(intentos.keys().next().value);
  const actual = intentos.get(direccion);
  intentos.set(direccion, actual && actual.hasta > ahora
    ? { cuenta: actual.cuenta + 1, hasta: actual.hasta }
    : { cuenta: 1, hasta: ahora + VENTANA_MS });
}

export function requiereSuperadmin(req, res) {
  if (!configuracion().configurada) {
    enviar(res, 503, { error: "Acceso superadmin sin configurar en el despliegue." });
    return false;
  }
  if (!sesionValida(req)) {
    enviar(res, 401, { error: "Inicia sesión como superadmin." });
    return false;
  }
  return true;
}

export async function sesionSuperadmin(req, res) {
  if (req.method !== "GET") return enviar(res, 405, { error: "Usa GET" });
  const config = configuracion();
  const autenticada = config.configurada && sesionValida(req);
  return enviar(res, 200, {
    configurada: config.configurada,
    autenticada,
    demoUrl: autenticada ? urlDemo() : null,
  });
}

export async function loginSuperadmin(req, res) {
  if (req.method !== "POST") return enviar(res, 405, { error: "Usa POST" });
  const config = configuracion();
  if (!config.configurada) return enviar(res, 503, { error: "Configura SUPERADMIN_USER, SUPERADMIN_PASSWORD (16 caracteres o más) y SUPERADMIN_SESSION_SECRET (32 o más) en Vercel." });

  const direccion = ip(req);
  const espera = bloqueado(direccion);
  if (espera) {
    res.setHeader("Retry-After", String(espera));
    return enviar(res, 429, { error: "Demasiados intentos. Vuelve a probar más tarde." });
  }

  let body;
  try {
    body = await leerCuerpo(req);
  } catch {
    return enviar(res, 400, { error: "Solicitud inválida." });
  }
  const usuario = typeof body?.usuario === "string" ? body.usuario.slice(0, 256) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 1024) : "";
  const usuarioCorrecto = igual(usuario, config.usuario);
  const passwordCorrecta = igual(password, config.password);
  if (!usuarioCorrecto || !passwordCorrecta) {
    fallo(direccion);
    return enviar(res, 401, { error: "Usuario o contraseña incorrectos." });
  }

  intentos.delete(direccion);
  const payload = Buffer.from(JSON.stringify({ u: config.usuario, exp: Math.floor(Date.now() / 1000) + DURACION_SESION_S })).toString("base64url");
  const token = `${payload}.${firma(payload, config.secreto)}`;
  emitirCookie(res, token, DURACION_SESION_S);
  return enviar(res, 200, { autenticada: true });
}

export async function logoutSuperadmin(req, res) {
  if (req.method !== "POST") return enviar(res, 405, { error: "Usa POST" });
  emitirCookie(res, "", 0);
  return enviar(res, 200, { ok: true });
}

function urlDemo() {
  const candidata = (process.env.DEMO_RESTAURANT_URL ?? "").trim();
  if (!candidata) return null;
  try {
    const url = new URL(candidata);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:")) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
