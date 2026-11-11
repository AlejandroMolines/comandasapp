import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { clasificarPulso, tokenValido } from "../api/_lib/estado.mjs";
import { separarLocales } from "../api/_lib/http.mjs";
import { listarRestaurantes, recibirPulso } from "../api/_lib/http.mjs";
import { vaciarMemoria } from "../api/_lib/store.mjs";

const TOKEN = "token-de-prueba";

function respuesta() {
  return {
    codigo: 0,
    cuerpo: null,
    status(codigo) {
      this.codigo = codigo;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
    },
  };
}

describe("central de locales", () => {
  afterEach(() => {
    vaciarMemoria();
    delete process.env.NUBE_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  test("clasifica el pulso por lo reciente que es", () => {
    const ahora = Date.parse("2026-11-10T12:00:00.000Z");
    assert.equal(clasificarPulso("2026-11-10T11:59:30.000Z", ahora), "en_linea");
    assert.equal(clasificarPulso("2026-11-10T11:55:00.000Z", ahora), "atencion");
    assert.equal(clasificarPulso("2026-11-10T11:40:00.000Z", ahora), "sin_conexion");
    assert.equal(clasificarPulso(null, ahora), "sin_conexion");
  });

  test("un token distinto no pasa, aunque tenga la misma longitud", () => {
    assert.equal(tokenValido("abc", "abc"), true);
    assert.equal(tokenValido("abd", "abc"), false);
    assert.equal(tokenValido("", "abc"), false);
  });

  test("el demo no entra en la lista de restaurantes reales", () => {
    const { restaurantes, demo } = separarLocales([
      { restauranteId: "bar-real", esDemo: false },
      { restauranteId: "restaurante-demo", esDemo: true },
    ]);
    assert.deepEqual(restaurantes.map((r) => r.restauranteId), ["bar-real"]);
    assert.equal(demo.restauranteId, "restaurante-demo");
  });

  test("sin NUBE_TOKEN la central no acepta locales", async () => {
    const res = respuesta();
    await recibirPulso({ method: "POST", headers: {}, body: {} }, res);
    assert.equal(res.codigo, 503);
  });

  test("un pulso válido aparece en el listado y un token malo no", async () => {
    process.env.NUBE_TOKEN = TOKEN;
    const malo = respuesta();
    await recibirPulso({
      method: "POST",
      headers: { authorization: "Bearer otro" },
      body: { restauranteId: "bar-1", nombre: "Bar Uno" },
    }, malo);
    assert.equal(malo.codigo, 401);

    const ok = respuesta();
    await recibirPulso({
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: {
        restauranteId: "bar-1",
        nombre: "Bar Uno",
        mesasOcupadas: 3,
        comandasAbiertas: 2,
        impresoras: [{ nombre: "Cocina", estado: "ok" }],
      },
    }, ok);
    assert.equal(ok.codigo, 200);

    const lista = respuesta();
    await listarRestaurantes({ method: "GET" }, lista);
    assert.equal(lista.cuerpo.restaurantes.length, 1);
    assert.equal(lista.cuerpo.restaurantes[0].nombre, "Bar Uno");
    assert.equal(lista.cuerpo.restaurantes[0].estado, "en_linea");
    assert.equal(lista.cuerpo.restaurantes[0].mesasOcupadas, 3);
    assert.equal(lista.cuerpo.persistencia, "memoria");
  });
});
