import { describe, expect, it } from "vitest";
import {
  attentionFromSettings,
  mergeAttentionSettings,
  parseAttentionInput,
} from "./attention-rules";

describe("attentionFromSettings", () => {
  it("usa los valores por defecto cuando no hay nada o es inválido", () => {
    const defaults = { agentVisibility: "own", assignmentMode: "round_robin", agentCanReturnToQueue: false, staleStageDays: 7 };
    expect(attentionFromSettings(undefined)).toEqual(defaults);
    expect(attentionFromSettings(null)).toEqual(defaults);
    expect(attentionFromSettings([])).toEqual(defaults);
    expect(attentionFromSettings({ agent_visibility: "todo", assignment_mode: 3, agent_can_return_to_queue: "sí" })).toEqual(
      defaults,
    );
  });

  it("lee los valores guardados", () => {
    expect(
      attentionFromSettings({ agent_visibility: "team", assignment_mode: "least_load", agent_can_return_to_queue: true }),
    ).toEqual({ agentVisibility: "team", assignmentMode: "least_load", agentCanReturnToQueue: true, staleStageDays: 7 });
    expect(attentionFromSettings({ stale_stage_days: 3 }).staleStageDays).toBe(3);
  });
});

describe("parseAttentionInput", () => {
  const ok = { agentVisibility: "own_and_unassigned", assignmentMode: "manual", agentCanReturnToQueue: true, staleStageDays: 7 };

  it("acepta valores válidos", () => {
    expect(parseAttentionInput(ok)).toEqual({ value: ok });
  });

  it("rechaza visibilidad, modo o devolución inválidos", () => {
    expect(parseAttentionInput({ ...ok, agentVisibility: "nada" })).toHaveProperty("error");
    expect(parseAttentionInput({ ...ok, assignmentMode: "azar" })).toHaveProperty("error");
    expect(parseAttentionInput({ ...ok, agentCanReturnToQueue: "true" })).toHaveProperty("error");
    expect(parseAttentionInput(null)).toHaveProperty("error");
    for (const bad of [0, -1, 2.5, 366, "7", null]) {
      expect(parseAttentionInput({ ...ok, staleStageDays: bad })).toHaveProperty("error");
    }
    expect(parseAttentionInput({ ...ok, staleStageDays: undefined })).toEqual({ value: ok });
  });
});

describe("mergeAttentionSettings", () => {
  it("no pisa otras claves de settings", () => {
    const current = {
      business_template: "gym",
      key_date_label: "Vencimiento de membresía",
      agent_visibility: "own",
      futura: { a: 1 },
    };
    const merged = mergeAttentionSettings(current, {
      agentVisibility: "team",
      assignmentMode: "least_load",
      agentCanReturnToQueue: true,
      staleStageDays: 14,
    });
    expect(merged).toEqual({
      business_template: "gym",
      key_date_label: "Vencimiento de membresía",
      futura: { a: 1 },
      agent_visibility: "team",
      assignment_mode: "least_load",
      agent_can_return_to_queue: true,
      stale_stage_days: 14,
    });
    // No muta el original.
    expect(current.agent_visibility).toBe("own");
  });

  it("parte de {} si los settings actuales no son un objeto", () => {
    expect(
      mergeAttentionSettings(null, { agentVisibility: "own", assignmentMode: "round_robin", agentCanReturnToQueue: false, staleStageDays: 7 }),
    ).toEqual({ agent_visibility: "own", assignment_mode: "round_robin", agent_can_return_to_queue: false, stale_stage_days: 7 });
  });
});
