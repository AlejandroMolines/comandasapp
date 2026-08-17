import "./db/connection.js"; // aplica el esquema al arrancar
import cors from "cors";
import express from "express";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Server as SocketServer } from "socket.io";
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

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });
app.set("io", io);

io.on("connection", (socket) => {
  // En un Raspberry real, cada restaurante es el único inquilino,
  // pero mantenemos "rooms" por restaurante_id para que el mismo
  // patrón funcione igual cuando esto hable con el Cloud multi-tenant.
  socket.join(RESTAURANTE_ID);

  // Las pantallas KDS se registran en su canal propio para recibir tickets.
  socket.on("kds:registrar", (canal: string) => {
    socket.join(`kds:${canal}`);
  });

  // --- Eventos que llegan DEL printer-worker y se reenvían a los dispositivos ---

  // Ticket para una pantalla KDS: el worker lo manda con ack; confirmamos
  // solo si hay al menos una pantalla conectada en ese canal.
  socket.on(
    "worker:kds_ticket",
    async (data: { canal: string; ticket: unknown }, ack: (r: { ok: boolean }) => void) => {
      const room = io.sockets.adapter.rooms.get(`kds:${data.canal}`);
      if (!room || room.size === 0) return ack({ ok: false });
      io.to(`kds:${data.canal}`).emit("kds:nuevo_ticket", data.ticket);
      ack({ ok: true });
    }
  );

  // Confirmación de impresión: el móvil origen puede pasar la comanda
  // a "confirmado_impresora" (el doble check del camarero).
  socket.on("worker:impresion_ok", (data: { restauranteId: string }) => {
    io.to(data.restauranteId).emit("impresion:ok", data);
  });

  // Fallo definitivo: alerta a TODOS los dispositivos del restaurante.
  socket.on("worker:impresion_fallida", (data: { restauranteId: string }) => {
    io.to(data.restauranteId).emit("impresion:fallida", data);
  });

  // Transición de salud de un destino (semáforo verde/rojo del dashboard).
  socket.on("worker:salud_destino", (data: { restauranteId: string }) => {
    io.to(data.restauranteId).emit("destino:salud", data);
  });

  socket.on("disconnect", () => {});
});

app.get("/salud", (_req, res) => {
  res.json({ ok: true, restauranteId: RESTAURANTE_ID, hora: new Date().toISOString() });
});

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

// En producción, el propio Raspberry sirve la PWA compilada: los móviles solo
// necesitan abrir http://<ip-del-raspberry>:3000 y todo es same-origin.
const pwaDist = path.resolve(process.cwd(), "../pwa-camarero/dist");
if (fs.existsSync(pwaDist)) {
  app.use(express.static(pwaDist));
  app.get("*", (_req, res) => res.sendFile(path.join(pwaDist, "index.html")));
  console.log(`[raspberry-backend] sirviendo PWA desde ${pwaDist}`);
}

httpServer.listen(PORT, () => {
  console.log(`[raspberry-backend] escuchando en http://localhost:${PORT}`);
});

// Red de seguridad: cualquier excepción no controlada en una ruta (p.ej. un
// FOREIGN KEY constraint que se nos haya escapado de validar) se convierte
// en un 500 con JSON limpio, en vez de tumbar el log con un stack trace y
// dejar la petición colgada. Debe ir DESPUÉS de montar todas las rutas.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[raspberry-backend] error no controlado:", err.message);
  res.status(500).json({ error: "Error interno del servidor", detalle: err.message });
});
