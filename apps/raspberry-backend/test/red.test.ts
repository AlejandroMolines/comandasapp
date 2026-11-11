import assert from "node:assert/strict";
import { test } from "node:test";
import { elegirIpLan, type InterfazRed } from "../src/lib/red.ts";

const v4 = (nombre: string, direccion: string, interna = false): InterfazRed => ({
  nombre, direccion, interna, familia: "IPv4",
});

test("ignora loopback, docker y direcciones link-local", () => {
  assert.equal(elegirIpLan([
    v4("lo", "127.0.0.1", true),
    v4("docker0", "172.17.0.1"),
    v4("eth0", "169.254.3.4"),
    v4("eth0", "192.168.1.40"),
  ]), "192.168.1.40");
});

test("si el Raspberry es el punto de acceso, usa la WiFi que termina en .1", () => {
  assert.equal(elegirIpLan([
    v4("eth0", "192.168.1.40"),
    v4("wlan0", "192.168.4.1"),
  ]), "192.168.4.1");
});

test("con WiFi de cliente y cable, prefiere la WiFi", () => {
  assert.equal(elegirIpLan([
    v4("eth0", "10.0.0.8"),
    v4("wlp2s0", "10.0.0.21"),
  ]), "10.0.0.21");
});

test("sin ninguna IPv4 útil no devuelve dirección", () => {
  assert.equal(elegirIpLan([v4("lo", "127.0.0.1", true)]), null);
});
