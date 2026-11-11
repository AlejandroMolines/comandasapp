#!/usr/bin/env node
/** La central, en local, sin Vercel. Sirve solo /api; la página la sirve Vite. */
import http from "node:http";
import listar from "../api/restaurantes.js";
import pulso from "../api/pulso.js";
import actualizacion from "../api/actualizacion.js";
import superadminSesion from "../api/superadmin/sesion.js";
import superadminLogin from "../api/superadmin/login.js";
import superadminLogout from "../api/superadmin/logout.js";
import superadminActualizacion from "../api/superadmin/actualizacion.js";
import superadminDemo from "../api/superadmin/demo.js";

const puerto = Number(process.env.NUBE_PORT ?? 8787);
const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (url.startsWith("/api/pulso")) return pulso(req, res);
  if (url.startsWith("/api/actualizacion")) return actualizacion(req, res);
  if (url.startsWith("/api/restaurantes")) return listar(req, res);
  if (url.startsWith("/api/superadmin/sesion")) return superadminSesion(req, res);
  if (url.startsWith("/api/superadmin/login")) return superadminLogin(req, res);
  if (url.startsWith("/api/superadmin/logout")) return superadminLogout(req, res);
  if (url.startsWith("/api/superadmin/actualizacion")) return superadminActualizacion(req, res);
  if (url.startsWith("/api/superadmin/demo")) return superadminDemo(req, res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "No existe" }));
});
server.listen(puerto, "127.0.0.1", () => {
  console.log(`[nube-api] http://127.0.0.1:${puerto}`);
});
