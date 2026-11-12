import { describe, expect, it } from "vitest";
import {
  UNDO_CHANGED_MESSAGE,
  UNDO_EXPIRED_MESSAGE,
  UNDO_GRACE_MS,
  UNDO_NOTHING_MESSAGE,
  UNDO_NOT_YOURS_MESSAGE,
  UNDO_WINDOW_MS,
  irreversibleNotice,
  undoBlockReason,
  undoneMessage,
  type UndoActivity,
} from "./undo";

const T0 = new Date("2026-11-10T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const move = (over: Partial<UndoActivity> = {}): UndoActivity => ({
  id: 7,
  type: "stage_changed",
  actor_id: "ana",
  from_value: "s1",
  to_value: "s2",
  created_at: T0.toISOString(),
  ...over,
});

const base = { actorId: "ana", currentStageId: "s2", after: [] as { actor_id: string | null; type: string }[] };

describe("irreversibleNotice", () => {
  it("no dice nada si el movimiento no disparó nada", () => {
    expect(irreversibleNotice({ flows: 0, contactTypeChanged: false, scheduledCases: 0 })).toBeNull();
  });

  it("avisa de los flujos que pudieron escribirle al cliente", () => {
    const one = irreversibleNotice({ flows: 1, contactTypeChanged: false, scheduledCases: 0 });
    expect(one).toContain("1 flujo automático");
    expect(one).toContain("mensajes al cliente");
    expect(one).toContain("no se revierte");
    expect(irreversibleNotice({ flows: 3, contactTypeChanged: false, scheduledCases: 0 })).toContain("3 flujos automáticos");
  });

  it("junta lo que hicieron las reglas", () => {
    const text = irreversibleNotice({ flows: 0, contactTypeChanged: true, scheduledCases: 2 })!;
    expect(text).toContain("cambió el tipo del contacto");
    expect(text).toContain("programaron 2 gestiones");
  });
});

describe("undoBlockReason", () => {
  it("permite deshacer lo propio, dentro de la ventana", () => {
    expect(undoBlockReason({ ...base, last: move(), now: at(2_000) })).toBeNull();
    expect(undoBlockReason({ ...base, last: move(), now: at(UNDO_WINDOW_MS + UNDO_GRACE_MS) })).toBeNull();
  });

  it("rechaza fuera de la ventana", () => {
    expect(undoBlockReason({ ...base, last: move(), now: at(UNDO_WINDOW_MS + UNDO_GRACE_MS + 1) })).toBe(UNDO_EXPIRED_MESSAGE);
  });

  it("solo quien movió", () => {
    expect(undoBlockReason({ ...base, last: move({ actor_id: "luis" }), now: at(1_000) })).toBe(UNDO_NOT_YOURS_MESSAGE);
    expect(undoBlockReason({ ...base, last: move({ actor_id: null }), now: at(1_000) })).toBe(UNDO_NOT_YOURS_MESSAGE);
  });

  it("no hay nada que deshacer sin un cambio de etapa previo", () => {
    expect(undoBlockReason({ ...base, last: null, now: at(1_000) })).toBe(UNDO_NOTHING_MESSAGE);
    expect(undoBlockReason({ ...base, last: move({ from_value: null }), now: at(1_000) })).toBe(UNDO_NOTHING_MESSAGE);
  });

  it("rechaza si la gestión ya no está en esa etapa", () => {
    expect(undoBlockReason({ ...base, currentStageId: "s3", last: move(), now: at(1_000) })).toBe(UNDO_CHANGED_MESSAGE);
  });

  it("rechaza si una persona hizo algo después, pero no lo del sistema ni responder en el chat", () => {
    const now = at(1_000);
    expect(undoBlockReason({ ...base, last: move(), now, after: [{ actor_id: "luis", type: "note_added" }] })).toBe(UNDO_CHANGED_MESSAGE);
    expect(undoBlockReason({ ...base, last: move(), now, after: [{ actor_id: "ana", type: "case_classified" }] })).toBe(UNDO_CHANGED_MESSAGE);
    expect(
      undoBlockReason({
        ...base,
        last: move(),
        now,
        after: [
          { actor_id: null, type: "contact_type_changed" },
          { actor_id: "ana", type: "human_reply" },
        ],
      }),
    ).toBeNull();
  });
});

describe("undoneMessage", () => {
  it("repite lo que no se pudo deshacer", () => {
    expect(undoneMessage("Asesorando", null)).toBe("Volviste a Asesorando.");
    expect(undoneMessage("Asesorando", "Eso no se revierte.")).toBe("Volviste a Asesorando. Eso no se revierte.");
  });
});
