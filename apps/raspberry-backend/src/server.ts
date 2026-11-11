import "./db/connection.js"; // aplica el esquema al arrancar
import cors, { type CorsOptions } from "cors";
import express from "express";
import fs from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import path from "node:path";
import { Server as SocketServer, type DefaultEventsMap } from "socket.io";
import { autenticarToken, type TokenPayload } from "./middleware/auth.js";
import { secretosIguales, secretoFirma } from "./lib/secretos.js";
import { iniciarPulso } from "./nube/pulso.js";
import { cocinaHandler, demoRouter } from "./demo/routes.js";
import { asegurarSemillaDemo, esModoDemo } from "./demo/semilla.js";
import { ajustesRouter } from "./modules/ajustes/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { cartaRouter } from "./modules/carta/routes.js";
import { empresasRouter } from "./modules/empresas/routes.js";
import { extrasRouter } from "./modules/extras/routes.js";
import { historialRouter } from "./modules/historial/routes.js";
import { comandasRouter } from "./modules/comandas/routes.js";
import { destinosRouter } from "./modules/destinos/routes.js";
import { espaciosRouter } from "./modules/espacios/routes.js";
import { pagosRouter } from "./modules/pagos/routes.js";
import { turnosRouter } from "./modules/turnos/routes.js";
import { usuariosRouter } from "./modules/usuarios/routes.js";

const PORT = Number(process.env.PORT ?? 3000);
const RESTAURANTE_ID = process.env.RESTAURANTE_ID ?? "restaurante-demo";
const CERT_FILE = process.env.TLS_CERT_FILE;
const KEY_FILE = process.env.TLS_KEY_FILE;
const PROTOCOLO = CERT_FILE && KEY_FILE ? "https" : "http";
const CORS_ORIGINS = new Set(
  (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean)
);

const corsOrigin: CorsOptions["origin"] = (origin, callback) => {
  callback(null, !origin || CORS_ORIGINS.has(origin));
};

interface SocketDatos {
  esWorker?: boolean;
  auth?: TokenPayload;
}

export function crearServidor() {
if (Boolean(CERT_FILE) !== Boolean(KEY_FILE)) {
  throw new Error("Configura TLS_CERT_FILE y TLS_KEY_FILE juntos.");
}
if (process.env.NODE_ENV === "production" && (!CERT_FILE || !KEY_FILE)) {
  throw new Error("En producción se requieren TLS_CERT_FILE y TLS_KEY_FILE para servir la app por HTTPS.");
}
const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const httpServer = CERT_FILE && KEY_FILE
  ? createSecureServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, app)
  : createServer(app);
const io = new SocketServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketDatos>(
  httpServer,
  { cors: { origin: corsOrigin } }
);
app.set("io", io);

// El worker se identifica con el mismo secreto que firma los tokens.
// Un móvil de la sala no puede fingir "impreso" ni inyectar tickets de cocina.
io.use((socket, next) => {
  const recibido = String(socket.handshake.auth?.workerSecret ?? "");
  if (secretosIguales(recibido, secretoFirma())) {
    socket.data.esWorker = true;
    return next();
  }
  const token = String(socket.handshake.auth?.token ?? "");
  const usuario = autenticarToken(token);
  if (!usuario) return next(new Error("unauthorized"));
  socket.data.esWorker = false;
  socket.data.auth = usuario;
  const venceEn = Math.max(0, usuario.exp * 1000 - Date.now());
  const temporizador = setTimeout(() => socket.disconnect(true), venceEn);
  socket.once("disconnect", () => clearTimeout(temporizador));
  next();
});

io.on("connection", (socket) => {
  // En un Raspberry real, cada restaurante es el único inquilino,
  // pero mantenemos "rooms" por restaurante_id para que el mismo
  // patrón funcione igual cuando esto hable con el Cloud multi-tenant.
  if (socket.data.auth?.restauranteId === RESTAURANTE_ID) {
    socket.join(socket.data.auth.restauranteId);
  }

  // Las pantallas KDS se registran en su canal propio para recibir tickets.
  socket.on("kds:registrar", (canal: string) => {
    if (!socket.data.auth || typeof canal !== "string" || canal.length === 0 || canal.length > 80) return;
    socket.join(`kds:${canal}`);
  });

  // --- Eventos que llegan DEL printer-worker y se reenvían a los dispositivos ---

  // Ticket para una pantalla KDS: el worker lo manda con ack; confirmamos
  // solo si hay al menos una pantalla conectada en ese canal.
  socket.on(
    "worker:kds_ticket",
    async (data: { canal: string; ticket: unknown }, ack: (r: { ok: boolean }) => void) => {
      const responder = typeof ack === "function" ? ack : () => {};
      if (!socket.data.esWorker || !data || typeof data.canal !== "string" || data.canal.length > 80) {
        return responder({ ok: false });
      }
      const room = io.sockets.adapter.rooms.get(`kds:${data.canal}`);
      if (!room || room.size === 0) return responder({ ok: false });
      io.to(`kds:${data.canal}`).emit("kds:nuevo_ticket", data.ticket);
      responder({ ok: true });
    }
  );

  // Confirmación de impresión: el móvil origen puede pasar la comanda
  // a "confirmado_impresora" (el doble check del camarero).
  socket.on("worker:impresion_ok", (data: { restauranteId: string }) => {
    if (!socket.data.esWorker) return;
    io.to(data.restauranteId).emit("impresion:ok", data);
  });

  // Fallo definitivo: alerta a TODOS los dispositivos del restaurante.
  socket.on("worker:impresion_fallida", (data: { restauranteId: string }) => {
    if (!socket.data.esWorker) return;
    io.to(data.restauranteId).emit("impresion:fallida", data);
  });

  // Transición de salud de un destino (semáforo verde/rojo del dashboard).
  socket.on("worker:salud_destino", (data: { restauranteId: string }) => {
    if (!socket.data.esWorker) return;
    io.to(data.restauranteId).emit("destino:salud", data);
  });

  socket.on("disconnect", () => {});
});

app.get("/salud", (_req, res) => {
  res.json({ ok: true, restauranteId: RESTAURANTE_ID, demo: esModoDemo(), hora: new Date().toISOString() });
});
app.get("/cocina", cocinaHandler);
app.use("/demo", demoRouter);

app.use("/auth", authRouter);
app.use("/ajustes", ajustesRouter);
app.use("/empresas", empresasRouter);
app.use("/extras", extrasRouter);
app.use("/historial", historialRouter);
app.use("/usuarios", usuariosRouter);
app.use("/espacios", espaciosRouter);
app.use("/carta", cartaRouter);
app.use("/destinos", destinosRouter);
app.use("/comandas", comandasRouter);
app.use("/turnos", turnosRouter);
app.use("/", pagosRouter); // expone /comandas/:id/cuenta y /comandas/:id/pagos

// En producción, el propio Raspberry sirve la PWA compilada en el mismo origen.
const pwaDist = path.resolve(process.cwd(), "../pwa-camarero/dist");
if (fs.existsSync(pwaDist)) {
  app.use(express.static(pwaDist));
  app.get("*", (_req, res) => res.sendFile(path.join(pwaDist, "index.html")));
  console.log(`[raspberry-backend] sirviendo PWA desde ${pwaDist}`);
}

// Red de seguridad: cualquier excepción no controlada en una ruta (p.ej. un
// FOREIGN KEY constraint que se nos haya escapado de validar) se convierte
// en un 500 con JSON limpio, en vez de tumbar el log con un stack trace y
// dejar la petición colgada. Debe ir DESPUÉS de montar todas las rutas.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[raspberry-backend] error no controlado:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Error interno del servidor" });
});

return { app, httpServer, io };
}

if (process.env.NODE_ENV !== "test") {
  const { httpServer } = crearServidor();
  httpServer.listen(PORT, () => {
    console.log(`[raspberry-backend] escuchando en ${PROTOCOLO}://localhost:${PORT}`);
    iniciarPulso();
    setTimeout(() => {
      try {
        const semilla = asegurarSemillaDemo();
        if (semilla.modo === "creada") console.log("[demo] semilla del restaurante de pruebas lista");
      } catch (err) {
        console.error("[demo] no se pudo sembrar:", (err as Error).message);
      }
    }, 1500);
  });
}
