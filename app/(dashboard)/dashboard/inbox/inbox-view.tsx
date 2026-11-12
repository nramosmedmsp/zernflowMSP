"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MessageSquare, RefreshCw, User } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { CaseCard } from "@/components/inbox/case-card";
import { ComplaintBannerConnected, showComplaintBanner } from "@/components/inbox/complaint-banner";
import { useInboxData } from "@/components/inbox/use-inbox-data";
import { useContactCases } from "@/components/inbox/use-contact-cases";
import { useContactTypeThread } from "@/components/inbox/use-contact-type";
import { useCaseNotes } from "@/components/inbox/use-case-notes";
import { availableScopes, type InboxCase, type InboxConversation, type InboxMeta, type InboxRow } from "@/components/inbox/inbox-model";
import { createClient } from "@/lib/supabase/client";
import { persistConversationRead } from "@/lib/inbox-read";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { outboxMessages } from "@/lib/inbox-outbox";
import type { InboxMessage } from "@/lib/inbox-messages";
import { useOutbox } from "@/components/inbox/use-outbox";
import { useNewMessageAlerts } from "@/components/inbox/use-new-message-alerts";
import { AlertSettingsButton } from "@/components/inbox/alert-settings";
import { alertScopesFor } from "@/lib/inbox-alerts";
import { useReconnect } from "@/components/inbox/use-reconnect";
import { useViewAs } from "@/components/view-as/view-as-context";
import { viewAsMineEmptyNote } from "@/lib/view-as/ui-rules";
import { Info } from "lucide-react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El chat más reciente del contacto. */
function latestConversation(list: InboxConversation[]): InboxConversation | null {
  return (
    [...list].sort(
      (a, b) =>
        new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime(),
    )[0] ?? null
  );
}

function MineEmptyNote({ text }: { text: string }) {
  return (
    <p
      data-testid="view-as-mine-note"
      className="mt-6 flex max-w-md items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {text}
    </p>
  );
}

export function InboxView({
  conversations: initialConversations,
  cases: initialCases,
  workspaceId,
  meta,
}: {
  conversations: InboxConversation[];
  cases: InboxCase[];
  workspaceId: string;
  meta: InboxMeta;
}) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const viewAs = useViewAs();
  const data = useInboxData({ workspaceId, initialConversations, initialCases, viewing: viewAs.active });
  const {
    conversations,
    casesByContact,
    ensureContactConversations,
    refreshContactCases,
    markConversationRead,
    patchContact,
    refreshContact,
  } = data;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  // En pantallas de menos de 1280 px la ficha del contacto empieza cerrada: se abre con el botón y tapa el chat.
  const [showContactPanel, setShowContactPanel] = useState(() => typeof window === "undefined" || window.innerWidth >= 1280);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; contactId?: string } | null>(null);
  // Aviso de reclamo ya atendido en este navegador (hasta que llegue el cambio en tiempo real).
  const [handledComplaint, setHandledComplaint] = useState<string | null>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const contactId = selected?.contact_id ?? null;
  const contactCases = useContactCases(contactId);
  const { notes, addLocal: addLocalNote } = useCaseNotes(contactId, selectedId);
  const casesData = contactCases.data;

  // Gestión activa: la elegida (URL o selector) si sigue en la vista; si no, la que sugiere el servidor.
  const allCases = casesData ? [...casesData.cases, ...casesData.recentClosed] : [];
  const activeCase =
    allCases.find((c) => c.id === activeCaseId) ??
    allCases.find((c) => c.id === casesData?.activeCaseId) ??
    null;

  // Guarda contacto y gestión en la URL sin volver a pedir la página al servidor.
  const syncUrl = useCallback((contact: string | null, caseId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (contact) params.set("contact", contact);
    else params.delete("contact");
    if (caseId) params.set("case", caseId);
    else params.delete("case");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  // ?contact=<id>&case=<id> (p. ej. desde una notificación) abre ese chat y esa gestión.
  const paramContact = searchParams.get("contact");
  const paramCase = searchParams.get("case");
  const lastParams = useRef<string | null>(null);
  useEffect(() => {
    const key = `${paramContact ?? ""}|${paramCase ?? ""}`;
    if (lastParams.current === key) return;
    // El enlace se da por atendido solo cuando el chat se abrió: si llega otro
    // mensaje mientras carga, este efecto corre de nuevo y lo termina.
    if (!paramContact || !UUID_RE.test(paramContact)) {
      lastParams.current = key;
      return;
    }
    const wantedCase = paramCase && UUID_RE.test(paramCase) ? paramCase : null;

    const current = conversations.find((c) => c.id === selectedId);
    if (current?.contact_id === paramContact) {
      lastParams.current = key;
      if (wantedCase) setActiveCaseId(wantedCase);
      return;
    }
    let cancelled = false;
    (async () => {
      let list = conversations.filter((c) => c.contact_id === paramContact);
      if (list.length === 0) list = await ensureContactConversations(paramContact, true);
      if (cancelled) return;
      lastParams.current = key;
      const target = latestConversation(list);
      if (!target) {
        setNotice({ text: "Este contacto no tiene un chat que puedas ver.", contactId: paramContact });
        return;
      }
      setNotice(null);
      setSelectedId(target.id);
      setActiveCaseId(wantedCase);
    })();
    return () => {
      cancelled = true;
    };
  }, [paramContact, paramCase, conversations, selectedId, ensureContactConversations]);

  const handleSelect = useCallback(
    (row: InboxRow) => {
      setNotice(null);
      setSelectedId(row.conversation.id);
      setActiveCaseId(row.case?.id ?? null);
      lastParams.current = `${row.conversation.contact_id}|${row.case?.id ?? ""}`;
      syncUrl(row.conversation.contact_id, row.case?.id ?? null);
    },
    [syncUrl],
  );

  // Solo en pantallas angostas: vuelve de un chat a la lista (una columna a la vez).
  const handleBackToList = useCallback(() => {
    setNotice(null);
    setSelectedId(null);
    setActiveCaseId(null);
    lastParams.current = "|";
    syncUrl(null, null);
  }, [syncUrl]);

  // Clic en una notificación de Windows: abre ese chat.
  const openFromAlert = useCallback(
    (conversationId: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation) return;
      setNotice(null);
      setSelectedId(conversation.id);
      setActiveCaseId(null);
      lastParams.current = `${conversation.contact_id}|`;
      syncUrl(conversation.contact_id, null);
    },
    [conversations, syncUrl],
  );
  const alerts = useNewMessageAlerts({
    userId: meta.userId,
    conversations,
    casesByContact,
    selectedId,
    onOpen: openFromAlert,
  });

  const handleSelectCase = useCallback(
    (caseId: string) => {
      setActiveCaseId(caseId);
      if (contactId) {
        lastParams.current = `${contactId}|${caseId}`;
        syncUrl(contactId, caseId);
      }
    },
    [contactId, syncUrl],
  );

  // Control de reclamos: aviso «Parece un reclamo» mientras no haya una Postventa atendiéndolo.
  const complaintKey = selected?.complaint_flagged_at ? `${selected.id}|${selected.complaint_flagged_at}` : null;
  const showComplaint =
    !!selected && complaintKey !== handledComplaint && showComplaintBanner(selected.complaint_flagged_at, casesData);

  // Después de una acción: vuelve a leer la tarjeta y las gestiones del contacto en la lista.
  const reloadContactCases = contactCases.reload;
  const handleCaseChanged = useCallback(async () => {
    if (!contactId) return;
    // El contacto también: una regla de venta o un cambio de tipo hecho en el panel actualiza el chip de la lista.
    await Promise.all([reloadContactCases(), refreshContactCases(contactId), refreshContact(contactId)]);
  }, [contactId, reloadContactCases, refreshContactCases, refreshContact]);

  // No leídos al abrir el chat: el hilo marca dónde empiezan los nuevos.
  const unread = selected?.unread_count ?? 0;
  const [opened, setOpened] = useState<{ id: string | null; unread: number }>({ id: null, unread: 0 });
  if (opened.id !== selectedId) setOpened({ id: selectedId, unread });

  // Chat abierto y a la vista: sus mensajes quedan leídos, también los que
  // llegan mientras está abierto o cuando la pestaña vuelve a verse.
  // En "Ver como" no se marca nada: mirar no deja huella.
  const viewing = viewAs.active;
  useEffect(() => {
    if (viewing || !selectedId || unread === 0) return;
    const markRead = () => {
      if (document.hidden) return;
      markConversationRead(selectedId);
      void persistConversationRead(createClient(), selectedId);
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [viewing, selectedId, unread, markConversationRead]);

  // Envíos: viven aquí para que un fallo después de cambiar de chat no se pierda.
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const handleDelivered = useCallback(
    (conversationId: string) => {
      const sentTo = conversationsRef.current.find((c) => c.id === conversationId)?.contact_id;
      if (!sentTo) return;
      if (sentTo === contactId) void handleCaseChanged();
      else void refreshContactCases(sentTo);
    },
    [contactId, handleCaseChanged, refreshContactCases],
  );
  const outbox = useOutbox({ onDelivered: handleDelivered });
  const { settle } = outbox;
  const selectedOutbox = useMemo(
    () => (selectedId ? outboxMessages(outbox.items, selectedId, meta.userId) : []),
    [outbox.items, selectedId, meta.userId],
  );
  const handleServerMessages = useCallback(
    (serverMessages: InboxMessage[]) => {
      if (selectedId) settle(selectedId, serverMessages);
    },
    [selectedId, settle],
  );

  // Al volver internet o tras suspender la laptop, la lista se vuelve a pedir.
  useReconnect(useCallback(() => router.refresh(), [router]));

  // Imports conversations that already exist in Zernio (e.g. from before the
  // webhook was registered), then refreshes the server-rendered list.
  // Solo administradores: la ruta responde 403 a los demás.
  async function handleSyncConversations() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/v1/channels/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        setSyncError(json.error || "No se pudo sincronizar");
        toast.error(json.error || "No se pudo sincronizar");
        return;
      }
      toast.success("Conversaciones sincronizadas");
      router.refresh();
    } catch {
      setSyncError("No se pudo sincronizar. Revisa tu conexión.");
      toast.error("No se pudo sincronizar. Revisa tu conexión.");
    } finally {
      setSyncing(false);
    }
  }

  const me = meta.members.find((m) => m.userId === meta.userId);
  // La identidad de ejemplo de "Ver como" por rol no se asigna ni se menciona.
  const selectableMembers = useMemo(() => meta.members.filter((m) => !m.sample), [meta.members]);
  const meInfo = useMemo(() => ({ userId: meta.userId, name: me?.name ?? "" }), [meta.userId, me?.name]);
  const contactType = useContactTypeThread({
    conversation: selected,
    casesData,
    types: meta.contactTypes ?? [],
    me: meInfo,
    patchContact,
    reload: handleCaseChanged,
  });
  const mineNote = viewAs.active && viewAs.info ? viewAsMineEmptyNote(viewAs.info, availableScopes(meta).includes("unassigned")) : null;
  const teamName = activeCase?.teamId ? meta.teams.find((t) => t.id === activeCase.teamId)?.name ?? null : null;

  return (
    <div className="flex h-full">
      {/* Left panel: Conversation list */}
      <div className={cn("w-full flex-shrink-0 lg:block lg:w-80", selected ? "hidden" : "block")}>
        <ConversationList
          workspaceId={workspaceId}
          conversations={conversations}
          casesByContact={casesByContact}
          meta={meta}
          selectedId={selectedId}
          onSelect={handleSelect}
          onSync={meta.isAdmin ? handleSyncConversations : undefined}
          syncing={syncing}
          syncError={conversations.length > 0 ? syncError : null}
          failedConversationIds={outbox.failedIds}
          headerActions={
            viewing ? undefined : (
              <AlertSettingsButton settings={alerts.settings} onChange={alerts.update} scopes={alertScopesFor(meta)} />
            )
          }
        />
      </div>

      {/* Center panel: Message thread */}
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col lg:flex", selected ? "flex" : "hidden")}>
        {selected && (
          <div className="flex shrink-0 items-center border-b border-border px-2 py-1 lg:hidden">
            <button
              type="button"
              onClick={handleBackToList}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a la lista
            </button>
          </div>
        )}
        {/* Toggle contact panel button */}
        {selected && !showContactPanel && (
          <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
            <button
              onClick={() => setShowContactPanel(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Mostrar información del contacto"
            >
              <User className="h-3.5 w-3.5" />
              Información del contacto
            </button>
          </div>
        )}
        {notice && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <span>{notice.text}</span>
            {notice.contactId && (
              <Link href={`/dashboard/contacts/${notice.contactId}`} className="font-medium text-primary hover:underline">
                Ver ficha completa
              </Link>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1">
          {conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                Aún no hay conversaciones
              </p>
              {meta.isAdmin ? (
                <>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                    Si ya tienes conversaciones en Zernio, sincronízalas para
                    traerlas a tu bandeja.
                  </p>
                  <button
                    onClick={handleSyncConversations}
                    disabled={syncing}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                    {syncing ? "Sincronizando…" : "Sincronizar conversaciones"}
                  </button>
                  {syncError && (
                    <p className="mt-2 text-xs text-destructive">{syncError}</p>
                  )}
                </>
              ) : (
                <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                  Aquí verás los chats de las gestiones que te asignen.
                </p>
              )}
              {mineNote && <MineEmptyNote text={mineNote} />}
            </div>
          ) : (
            <MessageThread
              key={selected?.id ?? "none"}
              conversation={selected}
              emptyNote={mineNote ? <MineEmptyNote text={mineNote} /> : null}
              outbox={selectedOutbox}
              initialUnread={opened.unread}
              onSend={(text, attachments) =>
                selected &&
                outbox.send(
                  { id: selected.id, contactName: selected.contacts?.display_name ?? null, platform: selected.platform },
                  text,
                  attachments,
                )
              }
              onRetry={(clientId) => void outbox.retry(clientId)}
              onServerMessages={handleServerMessages}
              caseSlot={
                selected ? (
                  <>
                    {casesData ? (
                      <CaseCard
                        data={casesData}
                        activeCaseId={activeCase?.id ?? null}
                        members={selectableMembers}
                        onSelectCase={handleSelectCase}
                        onChanged={handleCaseChanged}
                      />
                    ) : contactCases.error ? (
                      <div className="shrink-0 border-b border-border px-4 py-2 text-xs text-destructive">
                        {contactCases.error}
                      </div>
                    ) : (
                      <div className="h-[41px] shrink-0 border-b border-border bg-muted/30" />
                    )}
                    {showComplaint && casesData && (
                      <ComplaintBannerConnected
                        conversationId={selected.id}
                        excerpt={selected.complaint_excerpt}
                        typeName={casesData.caseTypes.find((t) => t.protected && !t.archived)?.name}
                        onChanged={async (caseId) => {
                          setHandledComplaint(complaintKey);
                          await handleCaseChanged();
                          if (caseId) handleSelectCase(caseId);
                        }}
                      />
                    )}
                  </>
                ) : null
              }
              notes={notes}
              members={selectableMembers}
              noteCase={activeCase}
              me={meInfo}
              teamName={teamName}
              workspaceName={meta.workspaceName}
              onNoteAdded={addLocalNote}
              onCaseActivity={() => void handleCaseChanged()}
              isDemo={!!selected && (meta.demoChannelIds ?? []).includes(selected.channel_id)}
              canSimulate={meta.isAdmin}
              isAdmin={meta.isAdmin}
              contactType={contactType}
            />
          )}
        </div>
      </div>

      {/* Right panel: Contact info */}
      {showContactPanel && selected?.contact_id && (
        <div className="max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:max-w-full max-xl:shadow-xl">
        <ContactPanel
          key={selected.contact_id}
          contactId={selected.contact_id}
          workspaceId={workspaceId}
          onClose={() => setShowContactPanel(false)}
          cases={casesData}
          members={selectableMembers}
          onContactChanged={() => void handleCaseChanged()}
        />
        </div>
      )}
    </div>
  );
}
