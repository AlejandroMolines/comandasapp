/**
 * Estado de los locales que han llamado.
 * Persiste en Postgres, en Upstash, o en Vercel Blob (BLOB_READ_WRITE_TOKEN).
 * Sin ninguno de esos, se queda en la memoria de esta instancia.
 */

const memoria = new Map();
let tablaLista = false;

export function modoPersistencia() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return "postgres";
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "kv";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "memoria";
}

export function vaciarMemoria() {
  memoria.clear();
  tablaLista = false;
}

export async function guardarPulso(pulso) {
  const todos = await leerMapa();
  todos[pulso.restauranteId] = pulso;
  await escribirMapa(todos);
}

export async function leerMapa() {
  const modo = modoPersistencia();
  if (modo === "postgres") return leerPostgres();
  if (modo === "kv") return leerKv();
  if (modo === "blob") return leerBlob();
  return Object.fromEntries(memoria);
}

async function escribirMapa(todos) {
  const modo = modoPersistencia();
  if (modo === "postgres") return escribirPostgres(todos);
  if (modo === "kv") return escribirKv(todos);
  if (modo === "blob") return escribirBlob(todos);
  memoria.clear();
  for (const [id, pulso] of Object.entries(todos)) memoria.set(id, pulso);
}

async function blob() {
  return import("@vercel/blob");
}

async function leerBlob() {
  const { get, list } = await blob();
  const mapa = {};
  const { blobs } = await list({ prefix: "pulsos/", limit: 200 });
  for (const item of blobs) {
    const got = await get(item.pathname, { access: "private", useCache: false });
    if (!got || got.statusCode !== 200 || !got.stream) continue;
    const texto = await new Response(got.stream).text();
    try {
      const pulso = JSON.parse(texto);
      if (pulso?.restauranteId) mapa[pulso.restauranteId] = pulso;
    } catch {
      /* se ignora */
    }
  }
  return mapa;
}

async function escribirBlob(todos) {
  const { put } = await blob();
  await Promise.all(
    Object.values(todos).map((pulso) =>
      put(`pulsos/${pulso.restauranteId}.json`, JSON.stringify(pulso), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 0,
      })
    )
  );
}

async function sql() {
  const { neon } = await import("@neondatabase/serverless");
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return neon(url);
}

async function asegurarTabla() {
  if (tablaLista) return;
  const q = await sql();
  await q`CREATE TABLE IF NOT EXISTS nube_pulsos (
    restaurante_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  )`;
  tablaLista = true;
}

async function leerPostgres() {
  await asegurarTabla();
  const q = await sql();
  const filas = await q`SELECT restaurante_id, payload FROM nube_pulsos`;
  const mapa = {};
  for (const fila of filas) {
    try {
      mapa[fila.restaurante_id] = JSON.parse(fila.payload);
    } catch {
      /* fila corrupta: se ignora */
    }
  }
  return mapa;
}

async function escribirPostgres(todos) {
  await asegurarTabla();
  const q = await sql();
  for (const [id, pulso] of Object.entries(todos)) {
    const payload = JSON.stringify(pulso);
    await q`INSERT INTO nube_pulsos (restaurante_id, payload) VALUES (${id}, ${payload})
            ON CONFLICT (restaurante_id) DO UPDATE SET payload = EXCLUDED.payload`;
  }
}

async function kv(comando) {
  const base = process.env.KV_REST_API_URL.replace(/\/$/, "");
  const res = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(comando),
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  return res.json();
}

async function leerKv() {
  const data = await kv(["GET", "comandas:pulsos"]);
  if (!data?.result) return {};
  try {
    const parsed = JSON.parse(data.result);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function escribirKv(todos) {
  await kv(["SET", "comandas:pulsos", JSON.stringify(todos)]);
}
