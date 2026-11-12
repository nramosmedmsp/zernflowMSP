import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_ROW_FILTER,
  auditActorLabel,
  auditCategoryFilter,
  auditLookupIds,
  describeAudit,
  type AuditLabelContext,
  type AuditRowInput,
} from "./audit-labels";

const U1 = "11111111-1111-4111-8111-111111111111";
const B1 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const F1 = "44444444-4444-4444-8444-444444444444";

const ctx: AuditLabelContext = {
  people: { [U1]: "Andrés Asesor" },
  broadcasts: { [B1]: "Promo de noviembre" },
  channels: { [C1]: "WhatsApp Ventas" },
  flows: { [F1]: "Bienvenida" },
};

function config(action: string, extra: Record<string, unknown> = {}, from: string | null = null, to: string | null = null): AuditRowInput {
  return { type: "config_changed", from_value: from, to_value: to, meta: { action, entity: AUDIT_ACTIONS[action]?.entity ?? "x", ...extra } };
}

describe("describeAudit: una frase por cada acción que hoy se registra", () => {
  const cases: [string, AuditRowInput, string, string[]][] = [
    // Equipo
    ["member_created", config("member_created", { user_id: U1, email: "a@x.pe", role: "member" }, null, "member"), "Creó el usuario Andrés Asesor con el rol Miembro", ["Correo: a@x.pe"]],
    ["member_created sin nombre", config("member_created", { user_id: "no-existe", email: "nuevo@x.pe" }, null, "admin"), "Creó el usuario nuevo@x.pe con el rol Administrador", []],
    ["member_readded", config("member_readded", { user_id: U1, email: "a@x.pe", reset_link_sent: true }, null, "member"), "Volvió a agregar a Andrés Asesor al equipo como Miembro", ["Correo: a@x.pe", "Se le envió un enlace de acceso por correo"]],
    ["member_removed", config("member_removed", { user_id: U1, role: "member", sessions_revoked: true }, "member"), "Quitó a Andrés Asesor del equipo", ["Rol que tenía: Miembro", "Se cerraron sus sesiones abiertas"]],
    ["member_renamed", config("member_renamed", { user_id: U1 }, "Andrés A.", "Andrés Asesor"), "Cambió el nombre de Andrés A. a Andrés Asesor", []],
    ["member_email_changed", config("member_email_changed", { user_id: U1, sessions_revoked: true }, "a@x.pe", "b@x.pe"), "Cambió el correo de Andrés Asesor", ["Correo: a@x.pe → b@x.pe", "Se cerraron sus sesiones abiertas"]],
    ["member_role_changed", config("member_role_changed", { user_id: U1 }, "member", "admin"), "Cambió el rol de Andrés Asesor de Miembro a Administrador", []],
    ["access_link_copied", config("access_link_copied", { user_id: U1, target_role: "member" }), "Copió el enlace de acceso de Andrés Asesor", ["Rol de la persona: Miembro"]],
    ["access_email_sent", config("access_email_sent", { user_id: U1, target_role: "member", email_sent: false }), "Envió el acceso por correo a Andrés Asesor", ["Rol de la persona: Miembro", "El correo no se pudo enviar"]],
    // Claves, espacio, correo
    ["api_key_changed zernio", config("api_key_changed", { zernio: true, ai: false }), "Cambió la clave de Zernio", ["Por seguridad, el valor de la clave no se guarda en el registro"]],
    ["api_key_changed ia", config("api_key_changed", { zernio: false, ai: true }), "Cambió la clave de la IA", ["Por seguridad, el valor de la clave no se guarda en el registro"]],
    ["api_key_changed ambas", config("api_key_changed", { zernio: true, ai: true }), "Cambió las claves de Zernio y de la IA", ["Por seguridad, el valor de la clave no se guarda en el registro"]],
    ["workspace_settings_changed", config("workspace_settings_changed", { field: "name" }, "Muscle", "Muscle Shop"), "Cambió el nombre del espacio de «Muscle» a «Muscle Shop»", []],
    ["mail_settings_changed", config("mail_settings_changed", { new_host: "smtp.x.pe", previous_host: null, new_port: 587, previous_port: null, new_from_email: "a@x.pe", previous_from_email: null, new_username: "usuario", password_changed: true }), "Cambió el servidor de correo (SMTP) de la app", ["Servidor: sin configurar → smtp.x.pe", "Puerto: sin configurar → 587", "Correo de envío: sin configurar → a@x.pe", "Se cambió la contraseña del correo (no se guarda en el registro)"]],
    ["apply_business_template", config("apply_business_template", { added: { rules: 3, stages: 5, caseTypes: 0 } }, null, "ecommerce"), "Aplicó la plantilla de negocio «E-commerce»", ["Se agregaron: 5 etapas, 3 reglas"]],
    ["key_date_label_changed", config("key_date_label_changed", {}, "Última compra", "Vence"), "Cambió el nombre de la fecha clave de «Última compra» a «Vence»", []],
    ["contact_type_inactivity_changed", config("contact_type_inactivity_changed", {}, "apagado", "30 días"), "Cambió el aviso de clientes inactivos", ["Aviso de inactividad: apagado → 30 días"]],
    // Gestiones
    ["case_type_created", config("case_type_created", { name: "Venta" }, null, "Venta"), "Creó el tipo de gestión «Venta»", []],
    ["case_type_updated", config("case_type_updated", { name: "Venta", changes: { strict_order: { from: false, to: true }, routing: { from: "contact_owner", to: "fixed_team" }, fixed_team_id: { from: null, to: "uuid" }, secreto: { from: "a", to: "b" } } }), "Cambió el tipo de gestión «Venta»", ["Obligar a seguir el orden de las etapas: No → Sí", "Reparto: Responsable del contacto → Equipo fijo", "Equipo de destino: se cambió"]],
    ["case_types_reordered", config("case_types_reordered", { order: "x" }), "Cambió el orden de los tipos de gestión", []],
    ["case_type_archived", config("case_type_archived", { name: "Venta", history_cases: 4 }), "Archivó el tipo de gestión «Venta»", ["Tenía historial: se archivó en vez de borrarse"]],
    ["case_type_restored", config("case_type_restored", { name: "Venta" }), "Restauró el tipo de gestión «Venta»", []],
    ["case_type_deleted", config("case_type_deleted", { name: "Venta" }), "Eliminó el tipo de gestión «Venta»", []],
    ["auto_template_changed", config("auto_template_changed", { name: "Recompra" }, null, "recordatorio"), "Cambió la plantilla automática del tipo de gestión «Recompra»", ["Plantilla: recordatorio"]],
    ["auto_template_changed quitada", config("auto_template_changed", { name: "Recompra" }), "Quitó la plantilla automática del tipo de gestión «Recompra»", []],
    ["stage_created", config("stage_created", { name: "Nuevo", case_type: "Venta" }), "Creó la etapa «Nuevo» del tipo de gestión «Venta»", []],
    ["stage_updated", config("stage_updated", { name: "Nuevo", case_type: "Venta", changes: { kind: { from: "open", to: "won" } } }), "Cambió la etapa «Nuevo» del tipo de gestión «Venta»", ["Clase: Abierta → Ganada"]],
    ["stage_reordered", config("stage_reordered", { case_type: "Venta" }), "Cambió el orden de las etapas del tipo de gestión «Venta»", []],
    ["stage_archived", config("stage_archived", { name: "Nuevo", case_type: "Venta", moved_cases: 2 }), "Archivó la etapa «Nuevo» del tipo de gestión «Venta»", ["2 gestiones pasaron a otra etapa"]],
    ["stage_restored", config("stage_restored", { name: "Nuevo", case_type: "Venta" }), "Restauró la etapa «Nuevo» del tipo de gestión «Venta»", []],
    ["stage_deleted", config("stage_deleted", { name: "Nuevo", case_type: "Venta", deleted_rules: 1 }), "Eliminó la etapa «Nuevo» del tipo de gestión «Venta»", ["1 regla eliminada"]],
    ["category_created", config("category_created", { name: "Reclamo", case_type: "Postventa" }), "Creó la categoría «Reclamo» del tipo de gestión «Postventa»", []],
    ["category_updated", config("category_updated", { name: "Reclamo", case_type: "Postventa", changes: { is_high_priority: { from: false, to: true } } }), "Cambió la categoría «Reclamo» del tipo de gestión «Postventa»", ["Prioridad alta: No → Sí"]],
    ["category_reordered", config("category_reordered", { case_type: "Postventa" }), "Cambió el orden de las categorías del tipo de gestión «Postventa»", []],
    ["category_archived", config("category_archived", { name: "Reclamo", case_type: "Postventa" }), "Archivó la categoría «Reclamo» del tipo de gestión «Postventa»", []],
    ["category_restored", config("category_restored", { name: "Reclamo", case_type: "Postventa" }), "Restauró la categoría «Reclamo» del tipo de gestión «Postventa»", []],
    ["category_deleted", config("category_deleted", { name: "Reclamo", case_type: "Postventa" }), "Eliminó la categoría «Reclamo» del tipo de gestión «Postventa»", []],
    ["reason_created", config("reason_created", { name: "Precio", case_type: "Venta" }), "Creó el motivo «Precio» del tipo de gestión «Venta»", []],
    ["reason_updated", config("reason_updated", { name: "Precio", case_type: "Venta", changes: { name: { from: "Caro", to: "Precio" } } }), "Cambió el motivo «Precio» del tipo de gestión «Venta»", ["Nombre: Caro → Precio"]],
    ["reason_reordered", config("reason_reordered", { case_type: "Venta" }), "Cambió el orden de los motivos del tipo de gestión «Venta»", []],
    ["reason_archived", config("reason_archived", { name: "Precio", case_type: "Venta" }), "Archivó el motivo «Precio» del tipo de gestión «Venta»", []],
    ["reason_restored", config("reason_restored", { name: "Precio", case_type: "Venta" }), "Restauró el motivo «Precio» del tipo de gestión «Venta»", []],
    ["reason_deleted", config("reason_deleted", { name: "Precio", case_type: "Venta" }), "Eliminó el motivo «Precio» del tipo de gestión «Venta»", []],
    ["rule_created", config("rule_created", { case_type: "Venta", rule: { trigger: "on_won" } }), "Creó una regla del tipo de gestión «Venta»", []],
    ["rule_updated", config("rule_updated", { case_type: "Venta" }), "Cambió una regla del tipo de gestión «Venta»", []],
    ["rule_enabled", config("rule_enabled", { case_type: "Venta" }), "Activó una regla del tipo de gestión «Venta»", []],
    ["rule_disabled", config("rule_disabled", { case_type: "Venta" }), "Desactivó una regla del tipo de gestión «Venta»", []],
    ["rules_reordered", config("rules_reordered", { case_type: "Venta" }), "Cambió el orden de las reglas del tipo de gestión «Venta»", []],
    ["rule_deleted", config("rule_deleted", { case_type: "Venta" }), "Eliminó una regla del tipo de gestión «Venta»", []],
    ["contact_type_created", config("contact_type_created", { name: "Cliente" }), "Creó el tipo de contacto «Cliente»", []],
    ["contact_type_updated", config("contact_type_updated", { name: "Cliente", changes: { color: { from: "#111", to: "#222" } } }), "Cambió el tipo de contacto «Cliente»", ["Color: #111 → #222"]],
    ["contact_type_default_changed", config("contact_type_default_changed", { name: "Cliente" }, "Prospecto", "Cliente"), "Cambió el tipo de contacto por defecto de «Prospecto» a «Cliente»", []],
    ["contact_types_reordered", config("contact_types_reordered"), "Cambió el orden de los tipos de contacto", []],
    ["contact_type_archived", config("contact_type_archived", { name: "Cliente", contacts: 3 }), "Archivó el tipo de contacto «Cliente»", ["Tenía historial: se archivó en vez de borrarse"]],
    ["contact_type_restored", config("contact_type_restored", { name: "Cliente" }), "Restauró el tipo de contacto «Cliente»", []],
    ["contact_type_deleted", config("contact_type_deleted", { name: "Cliente" }), "Eliminó el tipo de contacto «Cliente»", []],
    // Canales
    ["channel_connect_started", config("channel_connect_started", { platform: "whatsapp" }), "Empezó a conectar un canal de WhatsApp", []],
    ["channels_synced", config("channels_synced", { created: 1, deactivated: 0, updated: 2 }), "Sincronizó los canales con Zernio", ["1 canal nuevo", "0 canales desactivados", "2 canales actualizados"]],
    ["channel_deleted", config("channel_deleted", { channel_id: C1, late_account_id: "acc_123" }), "Eliminó un canal", []],
    ["channel_toggled on", config("channel_toggled", { channel_id: C1 }, null, "on"), "Activó el canal «WhatsApp Ventas»", []],
    ["channel_toggled off sin nombre", config("channel_toggled", { channel_id: "no-existe" }, null, "off"), "Desactivó un canal", []],
    // Difusiones
    ["broadcast_launched", config("broadcast_launched", { broadcast_id: B1, recipients: 1250, excluded: 4 }), "Lanzó la difusión «Promo de noviembre»", ["Destinatarios: 1,250", "Excluidos: 4"]],
    ["broadcast_paused", config("broadcast_paused", { broadcast_id: B1, sent: 49, pending: 57, failed: 13 }), "Pausó la difusión «Promo de noviembre»", ["Enviados: 49", "Pendientes: 57", "Con error: 13"]],
    ["broadcast_resumed", config("broadcast_resumed", { broadcast_id: B1, sent: 49, pending: 57 }), "Reanudó la difusión «Promo de noviembre»", ["Enviados: 49", "Pendientes: 57"]],
    ["broadcast_cancelled", config("broadcast_cancelled", { broadcast_id: B1 }), "Canceló la difusión «Promo de noviembre»", []],
    ["broadcast_auto_paused", config("broadcast_auto_paused", { broadcast_id: B1, consecutive_failures: 20, sent: 3, pending: 9 }), "Se pausó sola la difusión «Promo de noviembre» por errores seguidos", ["Enviados: 3", "Pendientes: 9", "Errores seguidos antes de pausarse: 20"]],
    ["broadcast borrada", config("broadcast_paused", { broadcast_id: "no-existe" }), "Pausó una difusión", []],
    // Flujos
    ["flow_published", config("flow_published", { flow_id: F1, version: 3 }), "Publicó el flujo «Bienvenida»", ["Versión 3"]],
    ["flow_deleted", config("flow_deleted", { flow_id: F1 }), "Eliminó el flujo «Bienvenida»", []],
    ["flow_deleted ya borrado", config("flow_deleted", { flow_id: "no-existe" }), "Eliminó un flujo", []],
    // Exportaciones
    ["data_exported", config("data_exported", { file: "metricas-asesores.csv", format: "csv" }, null, "metricas-asesores.csv"), "Descargó el archivo «metricas-asesores.csv»", []],
    ["data_exported con filas", config("data_exported", { file: "contactos.csv", rows: 1250 }), "Descargó el archivo «contactos.csv» (1,250 filas)", []],
    ["source_downloaded", config("source_downloaded"), "Descargó el código de la app", []],
    // Nombres que antes se perdían
    ["member_removed con nombre guardado", config("member_removed", { user_id: "no-existe", name: "Andrés Asesor", email: "a@x.pe", role: "member" }, "member"), "Quitó a Andrés Asesor del equipo", ["Correo: a@x.pe", "Rol que tenía: Miembro"]],
    ["member_removed fila antigua sin nombre", config("member_removed", { user_id: "no-existe", role: "member" }, "member"), "Quitó a una persona del equipo", ["Rol que tenía: Miembro"]],
    ["channel_deleted con nombre", config("channel_deleted", { channel_id: "no-existe", channel_name: "WhatsApp Ventas", platform: "whatsapp" }), "Eliminó el canal «WhatsApp Ventas»", ["Red: WhatsApp"]],
    // Horario, feriados y atención
    ["hours_changed empresa", config("hours_changed", { scope: "company", day_mon_from: "09:00-21:00", day_mon_to: "09:00-20:00", day_sun_from: "Cerrado", day_sun_to: "10:00-14:00, 15:00-18:00" }), "Cambió el horario de atención de la empresa", ["Lunes: 09:00–21:00 → 09:00–20:00", "Domingo: Cerrado → 10:00–14:00, 15:00–18:00"]],
    ["hours_changed equipo", config("hours_changed", { scope: "team", team_name: "Ventas", uses_company_hours: true, day_tue_from: "09:00-18:00", day_tue_to: "Cerrado" }), "Cambió el horario de atención del equipo «Ventas»", ["Martes: 09:00–18:00 → Cerrado", "Ahora usa el horario de la empresa"]],
    ["holiday_added", config("holiday_added", { name: "Día del Maestro", date: "2026-07-06" }), "Añadió el feriado «Día del Maestro» (6 de julio de 2026)", ["Aplica a toda la empresa"]],
    ["holiday_removed de un equipo", config("holiday_removed", { name: "Aniversario", date: "2026-12-01", team_name: "Ventas" }), "Quitó el feriado «Aniversario» (1 de diciembre de 2026)", ["Aplica al equipo «Ventas»"]],
    ["holidays_loaded", config("holidays_loaded", { year: 2027, added: 14 }), "Cargó los feriados de Perú de 2027", ["14 feriados agregados", "Aplica a toda la empresa"]],
    ["attention_settings_changed", config("attention_settings_changed", { visibility_from: "own", visibility_to: "team", assignment_from: "round_robin", assignment_to: "least_load", return_queue_from: false, return_queue_to: true, stale_days_from: 7, stale_days_to: 10 }), "Cambió los ajustes de atención", ["Qué gestiones ve el asesor: Solo sus gestiones → Todas las de su equipo", "Reparto cuando no hay equipos: Por turnos → Al de menor carga", "El asesor puede devolver gestiones a la cola: No → Sí", "Días en la misma etapa para marcar una gestión como atrasada: 7 → 10"]],
    ["attention_automation_changed", config("attention_automation_changed", { off_hours_enabled_from: false, off_hours_enabled_to: true, off_hours_text_changed: true, min_hours_from: null, min_hours_to: 4, reassign_minutes_from: null, reassign_minutes_to: 30 }), "Cambió la atención automática", ["Respuesta fuera de horario: Desactivada → Activada", "Se cambió el texto de la respuesta fuera de horario (no se guarda en el registro)", "Horas entre respuestas fuera de horario: una sola vez por gestión → 4 horas", "Reasignación por espera: Desactivada → 30 minutos"]],
    ["global_keywords_changed", config("global_keywords_changed", { added: "stop (baja)", removed: "hola (alta)", total: 3 }), "Cambió las palabras clave globales del espacio", ["Agregó: stop (baja)", "Quitó: hola (alta)", "Quedan 3 palabras"]],
    // Equipos de trabajo
    ["team_created", config("team_created", { team_name: "Ventas" }, null, "Ventas"), "Creó el equipo «Ventas»", []],
    ["team_renamed", config("team_renamed", { team_name: "Ventas Lima" }, "Ventas", "Ventas Lima"), "Cambió el nombre del equipo «Ventas» a «Ventas Lima»", []],
    ["team_archived", config("team_archived", { team_name: "Ventas" }), "Archivó el equipo «Ventas»", []],
    ["team_restored", config("team_restored", { team_name: "Ventas" }), "Restauró el equipo «Ventas»", []],
    ["team_default_changed", config("team_default_changed", { team_name: "Soporte" }, "Ventas", "Soporte"), "Marcó el equipo «Soporte» como equipo por defecto", ["Antes era «Ventas»"]],
    ["team_assignment_mode_changed", config("team_assignment_mode_changed", { team_name: "Ventas" }, "round_robin", "manual"), "Cambió el modo de reparto del equipo «Ventas»", ["Modo de reparto: Por turnos → Manual"]],
    ["team_supervisor_skips_changed", config("team_supervisor_skips_changed", { team_name: "Ventas" }, null, "on"), "Cambió si el supervisor recibe chats en el equipo «Ventas»", ["El supervisor no recibe chats: No → Sí"]],
    ["team_member_added", config("team_member_added", { team_name: "Ventas", user_id: U1 }, null, "agent"), "Añadió a Andrés Asesor al equipo «Ventas»", ["Rol en el equipo: Asesor"]],
    ["team_member_removed", config("team_member_removed", { team_name: "Ventas", user_id: U1 }, "supervisor"), "Quitó a Andrés Asesor del equipo «Ventas»", ["Rol que tenía en el equipo: Supervisor"]],
    ["team_member_role_changed", config("team_member_role_changed", { team_name: "Ventas", user_id: U1 }, "agent", "supervisor"), "Cambió el rol de Andrés Asesor en el equipo «Ventas» de Asesor a Supervisor", []],
    // Respuestas compartidas, diccionario
    ["saved_reply_created", config("saved_reply_created", { name: "Saludo", scope: "workspace", team_name: null }), "Creó la respuesta guardada «Saludo» de la empresa", []],
    ["saved_reply_updated", config("saved_reply_updated", { name: "Saludo nuevo", scope: "team", team_name: "Ventas", fields: "título, texto" }, "Saludo", "Saludo nuevo"), "Cambió la respuesta guardada «Saludo nuevo» del equipo «Ventas»", ["Título: Saludo → Saludo nuevo", "Se cambió: título, texto (el texto no se guarda en el registro)"]],
    ["saved_reply_deleted", config("saved_reply_deleted", { name: "Saludo", scope: "workspace" }), "Eliminó la respuesta guardada «Saludo» de la empresa", []],
    ["spell_word_added", config("spell_word_added", { word: "creatina" }, null, "creatina"), "Agregó «creatina» al diccionario de la tienda", []],
    ["spell_word_approved", config("spell_word_approved", { word: "whey" }, null, "whey"), "Aprobó «whey» para el diccionario de la tienda", []],
    ["spell_word_rejected", config("spell_word_rejected", { word: "xyz" }, null, "xyz"), "Rechazó el pedido de agregar «xyz» al diccionario de la tienda", []],
    ["spell_word_removed", config("spell_word_removed", { word: "whey" }, null, "whey"), "Quitó «whey» del diccionario de la tienda", []],
    // Secuencias
    ["sequence_created", config("sequence_created", { name: "Bienvenida" }, null, "Bienvenida"), "Creó la secuencia «Bienvenida»", []],
    ["sequence_activated", config("sequence_activated", { name: "Bienvenida" }, "draft", "active"), "Activó la secuencia «Bienvenida»", []],
    ["sequence_paused", config("sequence_paused", { name: "Bienvenida" }, "active", "paused"), "Pausó la secuencia «Bienvenida»", []],
    ["sequence_edited", config("sequence_edited", { name: "Bienvenida 2", steps_from: 2, steps_to: 3, fields: "nombre, pasos" }, "Bienvenida", "Bienvenida 2"), "Cambió la secuencia «Bienvenida 2»", ["Nombre: Bienvenida → Bienvenida 2", "Pasos: 2 → 3", "Se cambió: nombre, pasos"]],
    ["sequence_deleted", config("sequence_deleted", { name: "Bienvenida" }, "Bienvenida"), "Eliminó la secuencia «Bienvenida»", []],
    // Tipos propios de auditoría
    ["contacts_imported", { type: "contacts_imported", from_value: null, to_value: "b", meta: { file_name: "clientes.csv", total: 120, created: 100, updated: 20, skipped: 0, errors: 2, consent_declared: true, consented: 100 } }, "Importó contactos desde «clientes.csv»", ["120 filas en el archivo", "100 contactos nuevos", "20 contactos actualizados", "2 filas con error", "Se declaró que aceptaron publicidad (100 contactos)"]],
    ["contact_data_erased", { type: "contact_data_erased", from_value: null, to_value: null, meta: { erasure_id: "e", cases_kept: 2, claims_kept: 1 } }, "Eliminó los datos de un cliente", ["Se conservaron 2 gestiones sin datos personales", "Se conservó 1 reclamo sin datos personales"]],
    ["contact_data_erase_files_retried", { type: "contact_data_erase_files_retried", from_value: null, to_value: null, meta: { pending: 0 } }, "Reintentó borrar los archivos de un cliente eliminado", ["Ya no quedan archivos pendientes"]],
  ];

  for (const [name, row, title, details] of cases) {
    it(name, () => {
      const d = describeAudit(row, ctx);
      expect(d.title).toBe(title);
      expect(d.details).toEqual(details);
      expect(d.known).toBe(true);
      expect(d.category).not.toBeNull();
    });
  }

  it("cubre cada acción de AUDIT_ACTIONS", () => {
    const covered = new Set(cases.flatMap(([, row]) => ((row.meta as { action?: string }).action ? [(row.meta as { action: string }).action] : [])));
    for (const action of Object.keys(AUDIT_ACTIONS)) expect(covered.has(action), `falta la prueba de ${action}`).toBe(true);
  });

  it("con el cliente conocido, la corrección y la descarga lo nombran", () => {
    const corrected = describeAudit(
      { type: "contact_data_corrected", from_value: null, to_value: null, meta: { fields: ["teléfono", "otra-cosa"] } },
      { contactName: "Camila Quispe" },
    );
    expect(corrected.title).toBe("Corrigió datos personales de Camila Quispe");
    expect(corrected.details).toEqual(["Dato corregido: teléfono (los valores no se guardan en el registro)"]);
    expect(corrected.category).toBe("contacts");
    expect(describeAudit({ type: "contact_data_corrected", from_value: null, to_value: null, meta: {} }).title).toBe("Corrigió datos personales de un cliente");
    expect(describeAudit({ type: "contact_data_exported", from_value: null, to_value: null, meta: { format: "html" } }, { contactName: "Camila Quispe" }).title).toBe(
      "Descargó una copia de los datos de Camila Quispe",
    );
  });

  it("los cambios de publicidad hechos por una persona no copian la nota libre", () => {
    const row: AuditRowInput = {
      type: "contact_unsubscribed",
      from_value: "accepted",
      to_value: "opted_out",
      meta: { source: "manual", note: "Dijo que se llama Juan y vive en Av. Siempre Viva 123" },
    };
    const d = describeAudit(row, { contactName: "Camila Quispe" });
    expect(d.title).toBe("Marcó a Camila Quispe como dado de baja de la publicidad");
    expect(d.details).toEqual(["Estado: Aceptó publicidad → De baja de publicidad", "Lo anotó una persona desde la ficha del cliente"]);
    expect(JSON.stringify(d)).not.toContain("Siempre Viva");
    const accepted = describeAudit({ ...row, type: "contact_subscribed", from_value: "unknown", to_value: "accepted" }, {});
    expect(accepted.title).toBe("Registró que un cliente aceptó recibir publicidad");
  });

  it("al eliminar los datos de un cliente nunca se nombra al cliente", () => {
    const d = describeAudit(
      { type: "contact_data_erased", from_value: null, to_value: null, meta: { cases_kept: 0, name: "Camila", phone: "+51999" } },
      { contactName: "Camila Quispe" },
    );
    expect(JSON.stringify(d)).not.toMatch(/Camila|999/);
  });
});

describe("describeAudit: respaldo y seguridad", () => {
  it("una acción desconocida da una frase general, sin JSON ni nombres de campo", () => {
    const d = describeAudit(
      { type: "config_changed", from_value: null, to_value: null, meta: { action: "algo_nuevo", entity: "team", api_key: "sk-123", extra: { a: 1 } } },
      ctx,
    );
    expect(d.title).toBe("Hizo un cambio en el equipo");
    expect(d.known).toBe(false);
    expect(d.category).toBe("team");
    expect(`${d.title} ${d.details.join(" ")}`).not.toMatch(/sk-123|algo_nuevo|[{}"]/);
  });

  it("sin acción, sin meta o con meta rara no se rompe", () => {
    for (const meta of [null, undefined, "texto", 5, [], {}, { action: 5 }, { action: "x", entity: 7 }]) {
      const d = describeAudit({ type: "config_changed", from_value: null, to_value: null, meta }, ctx);
      expect(d.title).toBe("Hizo un cambio de configuración");
      expect(d.details).toEqual([]);
    }
    expect(describeAudit({ type: "otro_tipo", from_value: null, to_value: null, meta: {} }).title).toBe("Registró un cambio");
  });

  it("solo muestra campos permitidos: una clave metida en meta nunca aparece", () => {
    const rows: AuditRowInput[] = [
      config("api_key_changed", { zernio: true, ai: true, late_api_key: "sk-SECRETO-1", value: "sk-SECRETO-2", token: "t-SECRETO-3" }, "sk-SECRETO-4", "sk-SECRETO-5"),
      config("mail_settings_changed", { new_host: "smtp.x.pe", password: "SECRETO-6", new_password: "SECRETO-7", password_changed: true }),
      config("member_created", { user_id: U1, access_url: "https://app/auth/confirm?token_hash=SECRETO-8", email: "a@x.pe" }),
      config("case_type_updated", { name: "Venta", changes: { webhook_secret: { from: "SECRETO-9", to: "SECRETO-10" }, name: { from: "A", to: "B" } } }),
      config("channel_deleted", { channel_id: C1, late_account_id: "acc_SECRETO-11" }),
      config("data_exported", { file: "a.csv", token: "SECRETO-12" }),
    ];
    for (const row of rows) {
      const out = JSON.stringify(describeAudit(row, ctx));
      expect(out).not.toMatch(/SECRETO/);
    }
  });

  it("recorta textos largos y limpia espacios", () => {
    const d = describeAudit(config("case_type_created", { name: `  ${"x".repeat(500)}\n\n  ` }), ctx);
    expect(d.title.length).toBeLessThan(160);
    expect(d.title).toContain("…");
  });

  it("las acciones nuevas caen en categorías del filtro y las secuencias van con las difusiones", () => {
    const labels = Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c.value, c.label]));
    expect(labels.broadcasts).toBe("Difusiones y secuencias");
    for (const [action, def] of Object.entries(AUDIT_ACTIONS)) {
      expect(labels[def.category], action).toBeDefined();
    }
    expect(AUDIT_ACTIONS.sequence_created.category).toBe("broadcasts");
    expect(AUDIT_ACTIONS.team_member_added.category).toBe("team");
    expect(AUDIT_ACTIONS.hours_changed.category).toBe("config");
    expect(auditCategoryFilter("broadcasts")).toContain("sequence_deleted");
  });

  it("una acción nueva desconocida de una entidad nueva cae en su categoría", () => {
    const d = describeAudit({ type: "config_changed", from_value: null, to_value: null, meta: { action: "algo_mas", entity: "sequence" } });
    expect(d.title).toBe("Hizo un cambio en una secuencia");
    expect(d.category).toBe("broadcasts");
  });

  it("los cambios nuevos no copian textos de respuestas, pasos ni campos fuera de la lista", () => {
    const rows: AuditRowInput[] = [
      config("saved_reply_updated", { name: "Saludo", scope: "workspace", body: "SECRETO-1 texto completo", text: "SECRETO-2", fields: "texto" }),
      config("sequence_edited", { name: "Seq", content: "SECRETO-3 paso", steps_from: 1, steps_to: 2, steps: "SECRETO-4" }),
      config("attention_automation_changed", { off_hours_text_changed: true, off_hours_text: "SECRETO-5" }),
      config("hours_changed", { scope: "company", token: "SECRETO-6" }),
      config("member_removed", { user_id: U1, name: "Andrés", api_key: "SECRETO-7" }),
    ];
    for (const row of rows) expect(JSON.stringify(describeAudit(row, ctx))).not.toMatch(/SECRETO/);
  });

  it("cada categoría del filtro tiene al menos una acción o tipo", () => {
    for (const c of AUDIT_CATEGORIES) expect(auditCategoryFilter(c.value).length, c.label).toBeGreaterThan(0);
  });
});

describe("filtros y ayudantes", () => {
  it("el filtro base repite el del índice parcial 00049, en el mismo orden", () => {
    const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "00049_registro_de_cambios.sql"), "utf8");
    const listed = (sql: string) => [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const indexPart = migration.slice(migration.indexOf("create index"));
    const fromFilter = [...AUDIT_ROW_FILTER.matchAll(/\b(config_changed|contacts_imported|contact_data_[a-z_]+|contact_subscribed|contact_unsubscribed)\b/g)].map((m) => m[1]);
    expect(listed(indexPart)).toEqual(fromFilter);
  });

  it("el filtro de una categoría pide solo sus acciones", () => {
    expect(auditCategoryFilter("team")).toContain("meta->>action.in.(member_created,member_readded");
    expect(auditCategoryFilter("team")).not.toContain("broadcast");
    expect(auditCategoryFilter("exports")).toContain("type.eq.contacts_imported");
    expect(auditCategoryFilter("contacts")).toContain("contact_data_erased");
    expect(auditCategoryFilter("contacts")).toContain("contact_subscribed");
  });

  it("auditLookupIds junta solo ids válidos sin repetir", () => {
    const ids = auditLookupIds([
      { meta: { user_id: U1, broadcast_id: B1 } },
      { meta: { user_id: U1, channel_id: C1, flow_id: F1 } },
      { meta: { user_id: "no-es-id", broadcast_id: 5 } },
      { meta: null },
    ]);
    expect(ids).toEqual({ people: [U1], broadcasts: [B1], channels: [C1], flows: [F1] });
  });

  it("quién lo hizo: Sistema, nombre o Persona eliminada", () => {
    expect(auditActorLabel(null, {})).toBe("Sistema");
    expect(auditActorLabel(U1, { [U1]: "Andrés Asesor" })).toBe("Andrés Asesor");
    expect(auditActorLabel(U1, {})).toBe("Persona eliminada");
  });
});

describe("inventario: toda acción que registra el código está en AUDIT_ACTIONS", () => {
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it("las acciones de lib/audit.ts (AuditAction)", () => {
    const src = read("lib/audit.ts");
    const union = src.slice(src.indexOf("export type AuditAction"), src.indexOf("export type AuditEntity"));
    const actions = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(10);
    for (const a of actions) expect(AUDIT_ACTIONS[a], a).toBeDefined();
  });

  it("las acciones escritas con logActivity directo (equipo, correo, código, plantilla)", () => {
    const files = ["lib/actions/team.ts", "lib/actions/mail.ts", "app/api/v1/admin/source-zip/route.ts", "lib/business-templates.ts"];
    const found = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/\baction:\s*"([a-z_]+)"/g)) found.add(m[1]);
    // `action: "x"` también aparece en datos de plantillas de negocio (reglas): se ignoran las que no son de auditoría.
    const ignore = new Set(["set_contact_type", "schedule_case", "ask_key_date", "remind_tomorrow", "create_case", "close_case"]);
    for (const a of found) if (!ignore.has(a)) expect(AUDIT_ACTIONS[a], a).toBeDefined();
    expect(found.has("member_removed")).toBe(true);
  });

  it("las acciones de lib/actions/case-config.ts (audit(s, ...))", () => {
    const src = read("lib/actions/case-config.ts");
    const found = new Set<string>();
    for (const m of src.matchAll(/audit\(s,\s*"([a-z_]+)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/audit\(s,\s*`\$\{list\}_([a-z]+)`/g)) for (const list of ["stage", "category", "reason"]) found.add(`${list}_${m[1]}`);
    for (const m of src.matchAll(/audit\(s,\s*enabled \? "([a-z_]+)" : "([a-z_]+)"/g)) {
      found.add(m[1]);
      found.add(m[2]);
    }
    expect(found.size).toBeGreaterThan(30);
    for (const a of found) expect(AUDIT_ACTIONS[a], a).toBeDefined();
  });
});
