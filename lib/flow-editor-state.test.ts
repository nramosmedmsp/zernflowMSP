import { describe, expect, it } from "vitest";
import { flowSignature } from "./flow-editor-state";

const node = (extra = {}) => ({ id: "a", type: "sendMessage", position: { x: 10, y: 20 }, data: { messages: [{ text: "Hola" }] }, ...extra });

describe("flowSignature (M-27)", () => {
  it("es igual si solo cambia lo del lienzo (selección, medidas)", () => {
    const base = flowSignature("Flujo", [node()], []);
    expect(flowSignature("Flujo", [node({ selected: true, measured: { width: 1, height: 2 }, dragging: false })], [])).toBe(base);
  });

  it("cambia con el nombre, el texto, la posición o las conexiones", () => {
    const base = flowSignature("Flujo", [node()], []);
    expect(flowSignature("Otro", [node()], [])).not.toBe(base);
    expect(flowSignature("Flujo", [node({ data: { messages: [{ text: "Adiós" }] } })], [])).not.toBe(base);
    expect(flowSignature("Flujo", [node({ position: { x: 300, y: 20 } })], [])).not.toBe(base);
    expect(flowSignature("Flujo", [node()], [{ source: "a", target: "b" }])).not.toBe(base);
  });

  it("agregar o quitar un nodo cambia la firma", () => {
    expect(flowSignature("F", [node()], [])).not.toBe(flowSignature("F", [node(), node({ id: "b" })], []));
  });
});
