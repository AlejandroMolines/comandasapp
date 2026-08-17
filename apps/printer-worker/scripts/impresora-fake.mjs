// Simula una impresora térmica de red: escucha en 9100 y vuelca los bytes
// recibidos a /tmp/impresora-recibido.bin para poder inspeccionarlos.
import net from "node:net";
import fs from "node:fs";

const PUERTO = Number(process.env.PUERTO ?? 9100);
const SALIDA = "/tmp/impresora-recibido.bin";

const server = net.createServer((socket) => {
  const chunks = [];
  socket.on("data", (d) => chunks.push(d));
  socket.on("end", () => {
    const buf = Buffer.concat(chunks);
    fs.appendFileSync(SALIDA, buf);
    console.log(`[impresora-fake] recibidos ${buf.length} bytes`);
  });
});

server.listen(PUERTO, () => console.log(`[impresora-fake] escuchando en :${PUERTO}`));
