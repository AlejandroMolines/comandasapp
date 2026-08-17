/**
 * Builder mínimo de ESC/POS. Genera los bytes crudos que entienden las
 * impresoras térmicas. Cubrimos solo el subconjunto que necesita un ticket
 * de cocina/pago: init, alineación, tamaño de fuente, negrita, corte.
 *
 * Referencia rápida de los comandos usados:
 *   ESC @        -> inicializar impresora
 *   ESC a n      -> alineación (0 izq, 1 centro, 2 dcha)
 *   GS ! n       -> tamaño (bits altos: alto x2, bits bajos: ancho x2)
 *   ESC E n      -> negrita on/off
 *   GS V 66 0    -> corte parcial de papel
 */

const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
  private chunks: Buffer[] = [];

  init(): this {
    this.chunks.push(Buffer.from([ESC, 0x40]));
    return this;
  }

  align(mode: "left" | "center" | "right"): this {
    const n = mode === "left" ? 0 : mode === "center" ? 1 : 2;
    this.chunks.push(Buffer.from([ESC, 0x61, n]));
    return this;
  }

  /** doble alto+ancho para que cocina lo lea desde lejos */
  sizeBig(): this {
    this.chunks.push(Buffer.from([GS, 0x21, 0x11]));
    return this;
  }

  sizeNormal(): this {
    this.chunks.push(Buffer.from([GS, 0x21, 0x00]));
    return this;
  }

  bold(on: boolean): this {
    this.chunks.push(Buffer.from([ESC, 0x45, on ? 1 : 0]));
    return this;
  }

  text(t: string): this {
    // CP437/latin básico: las térmicas baratas no entienden UTF-8.
    // Transliteración simple de acentos españoles para no imprimir basura.
    const plano = t
      .replace(/[áà]/g, "a").replace(/[ÁÀ]/g, "A")
      .replace(/[éè]/g, "e").replace(/[ÉÈ]/g, "E")
      .replace(/[íì]/g, "i").replace(/[ÍÌ]/g, "I")
      .replace(/[óò]/g, "o").replace(/[ÓÒ]/g, "O")
      .replace(/[úù]/g, "u").replace(/[ÚÙ]/g, "U")
      .replace(/ñ/g, "n").replace(/Ñ/g, "N")
      .replace(/€/g, "EUR");
    this.chunks.push(Buffer.from(plano, "ascii"));
    return this;
  }

  line(t = ""): this {
    return this.text(t + "\n");
  }

  separator(width = 32): this {
    return this.line("-".repeat(width));
  }

  feed(lines = 3): this {
    this.chunks.push(Buffer.from("\n".repeat(lines), "ascii"));
    return this;
  }

  cut(): this {
    this.chunks.push(Buffer.from([GS, 0x56, 66, 0]));
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
