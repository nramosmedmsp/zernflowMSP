"use client";

// "Nueva gestión" desde el chat: abre otra en paralelo (openManualCase) o la
// programa para una fecha futura.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { openManualCase, type ContactCasesView } from "@/lib/actions/cases";
import { limaDateOf } from "@/lib/cases/dates";
import type { InboxMember } from "./inbox-model";
import { ErrorText, Field, Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

export function NewCaseDialog({
  data,
  members,
  onCancel,
  onCreated,
}: {
  data: ContactCasesView;
  members: InboxMember[];
  onCancel: () => void;
  onCreated: (caseId: string, message: string) => void;
}) {
  const types = data.caseTypes.filter((t) => !t.archived);
  const [caseTypeId, setCaseTypeId] = useState("");
  const [assignee, setAssignee] = useState<string>("me");
  const [scheduledFor, setScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Administrador: cualquiera. Supervisor: personas de los equipos que supervisa.
  const supervised = new Set(data.me.supervisedTeamIds);
  const assignable = members.filter(
    (m) =>
      m.userId !== data.me.userId &&
      (data.me.isAdmin || m.teams.some((t) => supervised.has(t.teamId))),
  );
  const today = limaDateOf(new Date());

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const result = await openManualCase({
        contactId: data.contact.id,
        caseTypeId: caseTypeId || null,
        assignee: scheduledFor ? "auto" : assignee,
        scheduledFor: scheduledFor || null,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onCreated(
        result.caseId,
        result.status === "scheduled" ? "Gestión programada." : "Gestión abierta.",
      );
    } catch {
      setError("No se pudo abrir la gestión. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Nueva gestión"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel} className={secondaryButtonClass}>
            Cancelar
          </button>
          <button onClick={handleCreate} disabled={saving} className={primaryButtonClass}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {scheduledFor ? "Programar" : "Abrir gestión"}
          </button>
        </>
      }
    >
      <Field label="Tipo de gestión">
        <select value={caseTypeId} onChange={(e) => setCaseTypeId(e.target.value)} className={inputClass}>
          <option value="">Sin clasificar</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Programar para"
        hint="Déjalo vacío para abrirla ahora. Si eliges una fecha, se activará ese día y se repartirá automáticamente."
      >
        <input
          type="date"
          value={scheduledFor}
          min={today}
          onChange={(e) => setScheduledFor(e.target.value)}
          className={inputClass}
        />
      </Field>

      {!scheduledFor && (
        <Field label="Responsable">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass}>
            <option value="me">Yo</option>
            <option value="auto">Reparto automático</option>
            {assignable.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
                {m.availability === "away" ? " (ausente)" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
