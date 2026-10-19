"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, Check, Loader2, Pencil, Plus, Star, Trash2, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addTeamMember,
  createTeam,
  removeTeamMember,
  renameTeam,
  setDefaultTeam,
  setTeamArchived,
  setTeamAssignmentMode,
  updateTeamMember,
  type TeamActionResult,
} from "@/lib/actions/teams";
import {
  ASSIGNMENT_MODE_OPTIONS,
  MAX_TEAM_NAME_LENGTH,
  TEAMS_HELP_TEXT,
  TEAM_ROLE_LABELS,
  TEAM_ROLES,
  assignmentModeLabel,
  caseTypesSummary,
  isAssignmentMode,
  isTeamRole,
  membersAvailableToAdd,
  sortTeams,
} from "./team-rules";
import type { AssignmentMode, TeamRole } from "@/lib/types/database";
import { useToast } from "@/components/ui/toast";

type RunFn = (key: string, action: () => Promise<TeamActionResult>, successMessage?: string) => Promise<boolean>;

export interface TeamsViewData {
  workspaceId: string;
  teams: {
    id: string;
    name: string;
    isDefault: boolean;
    archived: boolean;
    assignmentMode: AssignmentMode;
    members: { userId: string; role: TeamRole; caseTypeIds: string[] | null }[];
  }[];
  workspaceMembers: { userId: string; name: string; email: string; role: string }[];
  caseTypes: { id: string; name: string }[];
}

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  member: "Miembro",
};

/** "Todos los tipos" o una selección de tipos de gestión activos. */
function CaseTypePicker({
  caseTypes,
  value,
  onChange,
}: {
  caseTypes: { id: string; name: string }[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
}) {
  const all = value === null;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => onChange(e.target.checked ? null : caseTypes.map((t) => t.id).slice(0, 1))}
          className="h-4 w-4"
        />
        Todos los tipos de gestión
      </label>
      {!all && (
        <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
          {caseTypes.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.includes(t.id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, t.id] : value.filter((id) => id !== t.id))
                }
                className="h-4 w-4"
              />
              {t.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function AddMemberRow({
  team,
  data,
  busy,
  run,
}: {
  team: TeamsViewData["teams"][number];
  data: TeamsViewData;
  busy: boolean;
  run: RunFn;
}) {
  const candidates = membersAvailableToAdd(
    data.workspaceMembers,
    team.members.map((m) => m.userId),
  );
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<TeamRole>("agent");
  const [caseTypeIds, setCaseTypeIds] = useState<string[] | null>(null);

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Todos los miembros del espacio ya están en este equipo. Crea usuarios nuevos en{" "}
        <Link href="/dashboard/settings/team" className="underline underline-offset-2">
          Configuración → Equipo
        </Link>
        .
      </p>
    );
  }

  async function add() {
    if (!userId) return;
    const ok = await run(`add:${team.id}`, () => addTeamMember(team.id, userId, { role, caseTypeIds }), "Persona agregada al equipo");
    if (ok) {
      setUserId("");
      setRole("agent");
      setCaseTypeIds(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          aria-label="Persona que se agrega al equipo"
          className={cn(inputClass, "min-w-48 flex-1 py-1.5")}
        >
          <option value="">Elige a una persona…</option>
          {candidates.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
              {m.email ? ` (${m.email})` : ""}
            </option>
          ))}
        </select>
        <select
          value={role}
          onChange={(e) => isTeamRole(e.target.value) && setRole(e.target.value)}
          aria-label="Rol en el equipo"
          className={cn(inputClass, "py-1.5")}
        >
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {TEAM_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="button" onClick={add} disabled={!userId || busy} className={primaryButtonClass}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Agregar
        </button>
      </div>
      {data.caseTypes.length > 0 && (
        <CaseTypePicker caseTypes={data.caseTypes} value={caseTypeIds} onChange={setCaseTypeIds} />
      )}
    </div>
  );
}

function MemberRow({
  team,
  member,
  data,
  busyKey,
  run,
}: {
  team: TeamsViewData["teams"][number];
  member: TeamsViewData["teams"][number]["members"][number];
  data: TeamsViewData;
  busyKey: string | null;
  run: RunFn;
}) {
  const info = data.workspaceMembers.find((m) => m.userId === member.userId);
  const [editingTypes, setEditingTypes] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(member.caseTypeIds);
  const key = `member:${team.id}:${member.userId}`;
  const busy = busyKey === key;

  async function saveTypes() {
    const ok = await run(
      key,
      () => updateTeamMember(team.id, member.userId, { role: member.role, caseTypeIds: draft }),
      "Tipos de gestión guardados",
    );
    if (ok) setEditingTypes(false);
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{info?.name ?? "Persona sin nombre"}</p>
          <p className="text-xs text-muted-foreground">
            {info?.email}
            {info ? ` · ${WORKSPACE_ROLE_LABELS[info.role] ?? info.role}` : ""}
          </p>
        </div>
        <select
          value={member.role}
          disabled={busyKey !== null}
          onChange={(e) =>
            isTeamRole(e.target.value) &&
            run(
              key,
              () =>
                updateTeamMember(team.id, member.userId, {
                  role: e.target.value as TeamRole,
                  caseTypeIds: member.caseTypeIds,
                }),
              "Rol actualizado",
            )
          }
          aria-label={`Rol de ${info?.name ?? "la persona"} en el equipo`}
          className={cn(inputClass, "py-1.5")}
        >
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {TEAM_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => run(key, () => removeTeamMember(team.id, member.userId), "Persona quitada del equipo")}
          disabled={busyKey !== null}
          className={cn(buttonClass, "text-red-600 hover:text-red-700")}
          title="Quitar del equipo"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Quitar
        </button>
      </div>

      {data.caseTypes.length > 0 && (
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          {editingTypes ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Tipos de gestión que atiende</p>
              <CaseTypePicker caseTypes={data.caseTypes} value={draft} onChange={setDraft} />
              <div className="flex gap-2">
                <button type="button" onClick={saveTypes} disabled={busyKey !== null} className={primaryButtonClass}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar tipos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(member.caseTypeIds);
                    setEditingTypes(false);
                  }}
                  className={buttonClass}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Atiende:</span>{" "}
                {caseTypesSummary(member.caseTypeIds, data.caseTypes)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setDraft(member.caseTypeIds);
                  setEditingTypes(true);
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Cambiar
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function TeamCard({
  team,
  data,
  busyKey,
  run,
}: {
  team: TeamsViewData["teams"][number];
  data: TeamsViewData;
  busyKey: string | null;
  run: RunFn;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const mode = ASSIGNMENT_MODE_OPTIONS.find((o) => o.value === team.assignmentMode);
  const teamBusy = busyKey !== null && busyKey.startsWith(`team:${team.id}`);

  async function saveName() {
    const ok = await run(`team:${team.id}:rename`, () => renameTeam(team.id, name), "Nombre del equipo guardado");
    if (ok) setRenaming(false);
  }

  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", team.archived && "opacity-75")}>
      <div className="flex flex-wrap items-center gap-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={MAX_TEAM_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              aria-label="Nombre del equipo"
              className={cn(inputClass, "flex-1 py-1.5")}
            />
            <button type="submit" disabled={busyKey !== null || !name.trim()} className={primaryButtonClass}>
              {teamBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Guardar
            </button>
            <button
              type="button"
              onClick={() => {
                setName(team.name);
                setRenaming(false);
              }}
              className={buttonClass}
            >
              <X className="h-3.5 w-3.5" />
              Cancelar
            </button>
          </form>
        ) : (
          <>
            <h2 className="text-base font-semibold">{team.name}</h2>
            {team.isDefault && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Por defecto
              </span>
            )}
            {team.archived && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Archivado
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRenaming(true)}
                disabled={busyKey !== null}
                className={buttonClass}
              >
                <Pencil className="h-3.5 w-3.5" />
                Renombrar
              </button>
              {!team.archived && !team.isDefault && (
                <button
                  type="button"
                  onClick={() => run(`team:${team.id}:default`, () => setDefaultTeam(team.id), "Equipo marcado por defecto")}
                  disabled={busyKey !== null}
                  className={buttonClass}
                  title="Los contactos sin sede caen en el equipo por defecto"
                >
                  <Star className="h-3.5 w-3.5" />
                  Marcar por defecto
                </button>
              )}
              {team.isDefault && (
                <button
                  type="button"
                  onClick={() => run(`team:${team.id}:default`, () => setDefaultTeam(null), "Equipo por defecto quitado")}
                  disabled={busyKey !== null}
                  className={buttonClass}
                >
                  <Star className="h-3.5 w-3.5" />
                  Quitar como por defecto
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  run(
                    `team:${team.id}:archive`,
                    () => setTeamArchived(team.id, !team.archived),
                    team.archived ? "Equipo reactivado" : "Equipo archivado",
                  )
                }
                disabled={busyKey !== null}
                className={buttonClass}
              >
                <Archive className="h-3.5 w-3.5" />
                {team.archived ? "Reactivar" : "Archivar"}
              </button>
            </div>
          </>
        )}
      </div>

      {!team.archived && (
        <>
          <div className="mt-5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`mode-${team.id}`}>
              Modo de reparto
            </label>
            <select
              id={`mode-${team.id}`}
              value={team.assignmentMode}
              disabled={busyKey !== null}
              onChange={(e) =>
                isAssignmentMode(e.target.value) &&
                run(
                  `team:${team.id}:mode`,
                  () => setTeamAssignmentMode(team.id, e.target.value as AssignmentMode),
                  "Modo de reparto guardado",
                )
              }
              className={cn(inputClass, "mt-1.5 block w-full max-w-xs py-1.5")}
            >
              {ASSIGNMENT_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {mode?.description ?? assignmentModeLabel(team.assignmentMode)} Solo se reparte entre quienes están
              Disponibles y atienden ese tipo de gestión.
            </p>
          </div>

          <div className="mt-5">
            <h3 className="text-xs font-medium text-muted-foreground">
              Miembros ({team.members.length})
            </h3>
            {team.members.length > 0 ? (
              <ul className="mt-1 divide-y divide-border">
                {team.members.map((m) => (
                  <MemberRow
                    key={m.userId}
                    team={team}
                    member={m}
                    data={data}
                    busyKey={busyKey}
                    run={run}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Este equipo aún no tiene miembros. Agrega a quienes van a atender sus gestiones.
              </p>
            )}
            <div className="mt-3">
              <AddMemberRow team={team} data={data} busy={busyKey === `add:${team.id}`} run={run} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function TeamsView({ data }: { data: TeamsViewData }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const toast = useToast();
  const [newName, setNewName] = useState("");

  /** Ejecuta una acción, muestra el error si lo hay y devuelve si salió bien. */
  async function run(key: string, action: () => Promise<TeamActionResult>, successMessage?: string): Promise<boolean> {
    if (busyKey !== null) return false;
    setBusyKey(key);
    try {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
        return false;
      }
      toast.success(successMessage ?? "Cambio guardado");
      return true;
    } catch {
      toast.error("No se pudo guardar el cambio. Inténtalo de nuevo.");
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run("create", () => createTeam(data.workspaceId, newName), "Equipo creado");
    if (ok) setNewName("");
  }

  const teams = sortTeams(data.teams);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">Equipos</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Una sede, un área o un turno. Cada equipo reparte sus gestiones entre sus miembros. {TEAMS_HELP_TEXT}
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
          <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              maxLength={MAX_TEAM_NAME_LENGTH}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del equipo nuevo (por ejemplo, Sede Miraflores)"
              aria-label="Nombre del equipo nuevo"
              className={cn(inputClass, "min-w-64 flex-1")}
            />
            <button
              type="submit"
              disabled={busyKey !== null || !newName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busyKey === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Crear equipo
            </button>
          </form>

          {teams.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
              <Users className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Todavía no hay equipos</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {TEAMS_HELP_TEXT} El reparto sin equipos se configura en{" "}
                <Link href="/dashboard/settings/attention" className="underline underline-offset-2">
                  Configuración → Atención
                </Link>
                .
              </p>
            </div>
          ) : (
            teams.map((team) => <TeamCard key={team.id} team={team} data={data} busyKey={busyKey} run={run} />)
          )}
        </div>
      </div>
    </div>
  );
}
