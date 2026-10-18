"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import {
  addContactTag,
  removeContactTag,
  setContactOwner,
  setContactTeam,
  updateContactKeyDate,
  updateContactPhone,
  updateContactType,
  type ContactActionResult,
} from "@/lib/actions/contacts";
import { normalizePhone } from "@/components/contacts/contact-labels";

interface TagItem {
  id: string;
  name: string;
  color: string | null;
}

export interface ContactProfileProps {
  contactId: string;
  /** Solo Dueño o Administrador cambian responsable y equipo. */
  isAdmin: boolean;
  contactTypeId: string | null;
  ownerId: string | null;
  teamId: string | null;
  keyDate: string | null;
  phone: string | null;
  keyDateLabel: string;
  sourceText: string;
  contactTypes: { id: string; name: string; archived: boolean }[];
  teams: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  tags: TagItem[];
  allTags: TagItem[];
}

type FieldKey = "type" | "owner" | "team" | "keyDate" | "phone" | "tags";
type FieldState = { status: "saving" | "saved" | "error"; message?: string };

const FIELD_CLASS =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

function Row({
  label,
  state,
  children,
}: {
  label: string;
  state?: FieldState;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <span className="pt-1.5 text-sm text-muted-foreground">{label}</span>
      <div>
        {children}
        {state?.status === "saving" && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Guardando...
          </span>
        )}
        {state?.status === "saved" && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" /> Guardado
          </span>
        )}
        {state?.status === "error" && <p className="mt-1 text-xs text-red-600">{state.message}</p>}
      </div>
    </div>
  );
}

export function ContactProfile(props: ContactProfileProps) {
  const router = useRouter();
  const [typeId, setTypeId] = useState(props.contactTypeId ?? "");
  const [ownerId, setOwnerId] = useState(props.ownerId ?? "");
  const [teamId, setTeamId] = useState(props.teamId ?? "");
  const [keyDate, setKeyDate] = useState(props.keyDate ?? "");
  const [phone, setPhone] = useState(props.phone ?? "");
  const [savedPhone, setSavedPhone] = useState(props.phone ?? "");
  const [tags, setTags] = useState<TagItem[]>(props.tags);
  const [states, setStates] = useState<Partial<Record<FieldKey, FieldState>>>({});

  function mark(field: FieldKey, state: FieldState | undefined) {
    setStates((s) => ({ ...s, [field]: state }));
  }

  /** Ejecuta una acción mostrando guardando/guardado/error; devuelve true si salió bien. */
  async function save(field: FieldKey, action: () => Promise<ContactActionResult>): Promise<boolean> {
    mark(field, { status: "saving" });
    const res = await action();
    if ("error" in res) {
      mark(field, { status: "error", message: res.error });
      return false;
    }
    mark(field, { status: "saved" });
    router.refresh(); // actualiza la línea de tiempo
    return true;
  }

  const selectableTypes = props.contactTypes.filter((t) => !t.archived || t.id === typeId);
  const memberName = (id: string) => props.members.find((m) => m.userId === id)?.name ?? "Alguien";
  const availableTags = props.allTags.filter((t) => !tags.some((x) => x.id === t.id));

  async function onType(value: string) {
    const previous = typeId;
    setTypeId(value);
    if (!(await save("type", () => updateContactType(props.contactId, value || null)))) setTypeId(previous);
  }

  async function onOwner(value: string) {
    const previous = ownerId;
    setOwnerId(value);
    if (!(await save("owner", () => setContactOwner(props.contactId, value || null)))) setOwnerId(previous);
  }

  async function onTeam(value: string) {
    const previous = teamId;
    setTeamId(value);
    if (!(await save("team", () => setContactTeam(props.contactId, value || null)))) setTeamId(previous);
  }

  async function onKeyDate(value: string) {
    const previous = keyDate;
    setKeyDate(value);
    if (!(await save("keyDate", () => updateContactKeyDate(props.contactId, value || null)))) setKeyDate(previous);
  }

  async function onPhoneBlur() {
    if (phone.trim() === savedPhone.trim()) return;
    const check = normalizePhone(phone);
    if (!check.ok) return mark("phone", { status: "error", message: check.error });
    await save("phone", async () => {
      const res = await updateContactPhone(props.contactId, check.value);
      if (!("error" in res)) {
        setPhone(res.phone ?? "");
        setSavedPhone(res.phone ?? "");
      }
      return res;
    });
  }

  async function onAddTag(tagId: string) {
    const tag = props.allTags.find((t) => t.id === tagId);
    if (!tag) return;
    setTags((t) => [...t, tag]);
    if (!(await save("tags", () => addContactTag(props.contactId, tagId)))) {
      setTags((t) => t.filter((x) => x.id !== tagId));
    }
  }

  async function onRemoveTag(tag: TagItem) {
    setTags((t) => t.filter((x) => x.id !== tag.id));
    if (!(await save("tags", () => removeContactTag(props.contactId, tag.id)))) {
      setTags((t) => (t.some((x) => x.id === tag.id) ? t : [...t, tag]));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <Row label="Tipo de contacto" state={states.type}>
        <select
          aria-label="Tipo de contacto"
          value={typeId}
          onChange={(e) => onType(e.target.value)}
          disabled={states.type?.status === "saving"}
          className={FIELD_CLASS}
        >
          <option value="">Sin tipo</option>
          {selectableTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.archived ? " (archivado)" : ""}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Responsable" state={states.owner}>
        {props.isAdmin ? (
          <select
            aria-label="Responsable"
            value={ownerId}
            onChange={(e) => onOwner(e.target.value)}
            disabled={states.owner?.status === "saving"}
            className={FIELD_CLASS}
          >
            <option value="">Sin responsable</option>
            {props.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="pt-1.5 text-sm">{ownerId ? memberName(ownerId) : <span className="text-muted-foreground">Sin responsable</span>}</p>
        )}
      </Row>

      <Row label="Equipo" state={states.team}>
        {props.isAdmin ? (
          <select
            aria-label="Equipo"
            value={teamId}
            onChange={(e) => onTeam(e.target.value)}
            disabled={states.team?.status === "saving"}
            className={FIELD_CLASS}
          >
            <option value="">Sin equipo</option>
            {props.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="pt-1.5 text-sm">
            {teamId ? (props.teams.find((t) => t.id === teamId)?.name ?? "—") : <span className="text-muted-foreground">Sin equipo</span>}
          </p>
        )}
        {!props.isAdmin && (
          <p className="mt-1 text-xs text-muted-foreground">Solo un administrador puede cambiar el responsable y el equipo.</p>
        )}
      </Row>

      <Row label={props.keyDateLabel} state={states.keyDate}>
        <input
          type="date"
          aria-label={props.keyDateLabel}
          value={keyDate}
          onChange={(e) => onKeyDate(e.target.value)}
          disabled={states.keyDate?.status === "saving"}
          className={FIELD_CLASS}
        />
      </Row>

      <Row label="Teléfono" state={states.phone}>
        <input
          type="tel"
          aria-label="Teléfono"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (states.phone) mark("phone", undefined);
          }}
          onBlur={onPhoneBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="+51 999 999 999"
          className={FIELD_CLASS}
        />
      </Row>

      <Row label="Origen">
        <p className="pt-1.5 text-sm">
          {props.sourceText || <span className="text-muted-foreground">Sin información</span>}
        </p>
      </Row>

      <Row label="Etiquetas" state={states.tags}>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.length === 0 && <span className="text-sm text-muted-foreground">Sin etiquetas</span>}
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium"
              style={
                tag.color
                  ? { backgroundColor: `${tag.color}20`, borderColor: `${tag.color}40`, color: tag.color }
                  : undefined
              }
            >
              {tag.name}
              <button
                onClick={() => onRemoveTag(tag)}
                aria-label={`Quitar la etiqueta ${tag.name}`}
                className="rounded-full opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        {availableTags.length > 0 && (
          <div className="relative mt-2 inline-flex items-center">
            <Plus className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <select
              aria-label="Agregar etiqueta"
              value=""
              onChange={(e) => e.target.value && onAddTag(e.target.value)}
              className="rounded-lg border border-input bg-background py-1 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Agregar etiqueta...</option>
              {availableTags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </Row>
    </div>
  );
}
