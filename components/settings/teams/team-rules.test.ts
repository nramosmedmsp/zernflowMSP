import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_MODE_OPTIONS,
  assignmentModeLabel,
  caseTypesSummary,
  isAssignmentMode,
  isDuplicateTeamName,
  isTeamRole,
  membersAvailableToAdd,
  normalizeCaseTypeSelection,
  normalizeTeamName,
  sortTeams,
} from "./team-rules";

describe("normalizeTeamName", () => {
  it("recorta y junta espacios", () => {
    expect(normalizeTeamName("  Sede   Lima  ")).toEqual({ name: "Sede Lima" });
  });
  it("rechaza vacío, no texto y demasiado largo", () => {
    expect(normalizeTeamName("   ")).toHaveProperty("error");
    expect(normalizeTeamName(null)).toHaveProperty("error");
    expect(normalizeTeamName("a".repeat(101))).toHaveProperty("error");
    expect(normalizeTeamName("a".repeat(100))).toEqual({ name: "a".repeat(100) });
  });
});

describe("isDuplicateTeamName", () => {
  const teams = [
    { id: "1", name: "Sede A" },
    { id: "2", name: "Recepción" },
  ];
  it("compara sin distinguir mayúsculas y puede excluir el propio equipo", () => {
    expect(isDuplicateTeamName("sede a", teams)).toBe(true);
    expect(isDuplicateTeamName("sede a", teams, "1")).toBe(false);
    expect(isDuplicateTeamName("Sede B", teams)).toBe(false);
  });
});

describe("modos y roles", () => {
  it("reconoce los valores válidos", () => {
    expect(isAssignmentMode("round_robin")).toBe(true);
    expect(isAssignmentMode("least_load")).toBe(true);
    expect(isAssignmentMode("manual")).toBe(true);
    expect(isAssignmentMode("aleatorio")).toBe(false);
    expect(isTeamRole("supervisor")).toBe(true);
    expect(isTeamRole("agent")).toBe(true);
    expect(isTeamRole("owner")).toBe(false);
  });
  it("tiene etiqueta y explicación en español para cada modo", () => {
    expect(ASSIGNMENT_MODE_OPTIONS.map((o) => o.label)).toEqual(["Por turnos", "Al de menor carga", "Manual"]);
    expect(ASSIGNMENT_MODE_OPTIONS.every((o) => o.description.length > 20)).toBe(true);
    expect(assignmentModeLabel("least_load")).toBe("Al de menor carga");
  });
});

describe("normalizeCaseTypeSelection", () => {
  const active = new Set(["a", "b", "c"]);
  it("null o ausente = todos los tipos", () => {
    expect(normalizeCaseTypeSelection(null, active)).toEqual({ value: null });
    expect(normalizeCaseTypeSelection(undefined, active)).toEqual({ value: null });
  });
  it("acepta una selección de tipos activos, sin repetidos", () => {
    expect(normalizeCaseTypeSelection(["a", "b", "a"], active)).toEqual({ value: ["a", "b"] });
  });
  it("marcar todos los activos equivale a todos", () => {
    expect(normalizeCaseTypeSelection(["c", "b", "a"], active)).toEqual({ value: null });
  });
  it("rechaza vacío, desconocidos y formatos inválidos", () => {
    expect(normalizeCaseTypeSelection([], active)).toHaveProperty("error");
    expect(normalizeCaseTypeSelection(["z"], active)).toHaveProperty("error");
    expect(normalizeCaseTypeSelection("a", active)).toHaveProperty("error");
    expect(normalizeCaseTypeSelection([1], active)).toHaveProperty("error");
  });
});

describe("caseTypesSummary", () => {
  const types = [
    { id: "a", name: "Ventas" },
    { id: "b", name: "Soporte" },
  ];
  it("resume todos o la selección", () => {
    expect(caseTypesSummary(null, types)).toBe("Todos los tipos");
    expect(caseTypesSummary(["b", "a"], types)).toBe("Ventas, Soporte");
    expect(caseTypesSummary(["x"], types)).toBe("Ningún tipo activo");
  });
});

describe("membersAvailableToAdd / sortTeams", () => {
  it("ofrece solo a quienes no están en el equipo, por nombre", () => {
    const members = [
      { userId: "1", name: "Zoe" },
      { userId: "2", name: "Ana" },
      { userId: "3", name: "Beto" },
    ];
    expect(membersAvailableToAdd(members, ["3"]).map((m) => m.name)).toEqual(["Ana", "Zoe"]);
  });

  it("ordena activos primero, el equipo por defecto arriba y archivados al final", () => {
    const sorted = sortTeams([
      { name: "Z", isDefault: false, archived: true },
      { name: "B", isDefault: false, archived: false },
      { name: "A", isDefault: false, archived: false },
      { name: "M", isDefault: true, archived: false },
    ]);
    expect(sorted.map((t) => t.name)).toEqual(["M", "A", "B", "Z"]);
  });
});
