"use client";

// Archivos que el asesor va a enviar (antes de pulsar Enviar): revisa que el
// canal los acepte, achica las fotos grandes y arma la vista previa.

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ATTACHMENTS, baseMime, imageMaxBytes, validateOutgoingAttachment } from "@/lib/chat-media";
import type { OutboxAttachment } from "@/lib/inbox-outbox";
import type { Platform } from "@/lib/types/database";
import { compressImage, jpegName } from "./compress-image";

export interface TrayItem extends OutboxAttachment {
  id: string;
}

/** Archivo de una respuesta guardada (ya está en el bucket). */
export interface ReplyFile {
  replyId: string;
  path: string;
  name: string;
  mime: string;
  size: number | null;
}

function revoke(item: TrayItem) {
  if (item.localUrl?.startsWith("blob:")) URL.revokeObjectURL(item.localUrl);
}

export function useAttachments(platform: Platform, onError: (message: string) => void) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [preparing, setPreparing] = useState(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Al salir del chat sin enviar, se liberan las vistas previas.
  useEffect(() => () => itemsRef.current.forEach(revoke), []);

  const add = useCallback(
    async (files: File[]) => {
      const room = MAX_ATTACHMENTS - itemsRef.current.length;
      if (files.length === 0) return;
      if (room <= 0) {
        onError(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos a la vez.`);
        return;
      }
      if (files.length > room) onError(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos a la vez.`);
      setPreparing(true);
      try {
        const ready: TrayItem[] = [];
        for (const original of files.slice(0, room)) {
          let file: Blob = original;
          let name = original.name || "archivo";
          let mime = baseMime(original.type);
          const check = validateOutgoingAttachment(platform, { mime, size: original.size });
          if (!check.ok) {
            onError(`${name}: ${check.error}`);
            continue;
          }
          if (check.compress) {
            const smaller = await compressImage(original, imageMaxBytes(platform));
            if (!smaller) {
              onError(`${name}: la foto pesa demasiado y no se pudo achicar.`);
              continue;
            }
            file = smaller;
            mime = "image/jpeg";
            name = jpegName(name);
          }
          ready.push({
            id: crypto.randomUUID(),
            path: null,
            file,
            name,
            mime,
            size: file.size,
            kind: check.kind,
            localUrl: check.kind === "image" ? URL.createObjectURL(file) : null,
          });
        }
        if (ready.length > 0) setItems((prev) => [...prev, ...ready].slice(0, MAX_ATTACHMENTS));
      } finally {
        setPreparing(false);
      }
    },
    [platform, onError],
  );

  const addReplyFile = useCallback(
    (reply: ReplyFile) => {
      const mime = baseMime(reply.mime);
      const check = validateOutgoingAttachment(platform, { mime, size: reply.size ?? 0 });
      if (!check.ok) {
        onError(`${reply.name}: ${check.error}`);
        return;
      }
      if (itemsRef.current.length >= MAX_ATTACHMENTS) {
        onError(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos a la vez.`);
        return;
      }
      if (itemsRef.current.some((i) => i.path === reply.path)) return;
      setItems((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          path: reply.path,
          file: null,
          name: reply.name,
          mime,
          size: reply.size ?? 0,
          kind: check.kind,
          localUrl: check.kind === "image" ? `/api/v1/media/reply/${reply.replyId}` : null,
        },
      ]);
    },
    [platform, onError],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone) revoke(gone);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  /** Entrega los archivos para enviar y vacía la bandeja (las vistas previas siguen en el chat). */
  const take = useCallback((): OutboxAttachment[] => {
    const taken = itemsRef.current.map(({ path, file, name, mime, size, kind, localUrl }) => ({ path, file, name, mime, size, kind, localUrl }));
    itemsRef.current = [];
    setItems([]);
    return taken;
  }, []);

  return { items, preparing, add, addReplyFile, remove, take };
}
