"use client";

// Avisos de mensaje nuevo (lib/inbox-alerts.ts): número en la pestaña, sonido y
// notificación de Windows. Se comparan los no leídos de cada chat entre una
// actualización de la lista y la siguiente (llegan por Realtime).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  alertSettingsKey,
  evaluateAlerts,
  parseAlertSettings,
  titleWithCount,
  unreadChatsInScope,
  unreadSnapshot,
  type AlertSettings,
} from "@/lib/inbox-alerts";
import type { InboxCase, InboxConversation } from "./inbox-model";

function readSettings(userId: string): AlertSettings {
  try {
    return parseAlertSettings(window.localStorage.getItem(alertSettingsKey(userId)));
  } catch {
    return parseAlertSettings(null);
  }
}

let audio: AudioContext | null = null;

/** Dos tonos cortos y suaves. */
function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
    const start = audio.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = start + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {
    // Sin audio: el aviso sigue con el número de la pestaña.
  }
}

export function useNewMessageAlerts({
  userId,
  conversations,
  casesByContact,
  selectedId,
  onOpen,
}: {
  userId: string;
  conversations: InboxConversation[];
  casesByContact: ReadonlyMap<string, InboxCase[]>;
  selectedId: string | null;
  /** Clic en la notificación de Windows: abre ese chat. */
  onOpen: (conversationId: string) => void;
}) {
  const [settings, setSettings] = useState<AlertSettings>(() =>
    typeof window === "undefined" ? parseAlertSettings(null) : readSettings(userId),
  );

  const update = useCallback(
    (patch: Partial<AlertSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        try {
          window.localStorage.setItem(alertSettingsKey(userId), JSON.stringify(next));
        } catch {
          // Sin almacenamiento: vale solo mientras la página esté abierta.
        }
        return next;
      });
    },
    [userId],
  );

  // Mensajes nuevos: sonido y notificación.
  const previous = useRef<Map<string, number> | null>(null);
  const latest = useRef({ settings, casesByContact, selectedId, onOpen });
  useEffect(() => {
    latest.current = { settings, casesByContact, selectedId, onOpen };
  }, [settings, casesByContact, selectedId, onOpen]);

  const pending = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const before = previous.current;
    previous.current = unreadSnapshot(conversations);
    if (!before) return;
    const { settings: s, selectedId: open } = latest.current;
    const visible = document.visibilityState === "visible";
    // Se evalúa aunque el sonido esté apagado para no acumular pendientes viejos.
    const result = evaluateAlerts({
      before,
      conversations,
      pending: pending.current,
      casesByContact,
      userId,
      scope: s.scope,
      openId: open,
      visible,
      now: Date.now(),
    });
    pending.current = result.pending;
    if (!s.sound && !s.desktop) return;
    const fresh = result.alertIds.map((id) => conversations.find((c) => c.id === id)!);
    if (fresh.length === 0) return;

    if (s.sound) playChime();
    if (s.desktop && !visible && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const c of fresh.slice(0, 3)) {
        const name = c.contacts?.display_name?.trim() || "Cliente";
        const n = new Notification(`Mensaje de ${name}`, {
          body: c.last_message_preview ?? "",
          tag: `zf-chat-${c.id}`,
        });
        n.onclick = () => {
          window.focus();
          latest.current.onOpen(c.id);
          n.close();
        };
      }
    }
  }, [conversations, casesByContact, userId]);

  // Número en la pestaña.
  const count = settings.tabCount ? unreadChatsInScope(conversations, casesByContact, userId, settings.scope) : 0;
  useEffect(() => {
    document.title = titleWithCount(document.title, count);
  }, [count]);
  useEffect(() => () => {
    document.title = titleWithCount(document.title, 0);
  }, []);

  return { settings, update, unreadCount: count };
}
