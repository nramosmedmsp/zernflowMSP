import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { OWNER_ONLY_MAIL_MESSAGE, canManageMailSettings } from "@/lib/team-rules";
import { getMailStatus } from "@/lib/mail/settings";
import { isMailSecurity } from "@/lib/mail/config";
import { MailSettingsView } from "@/components/settings/mail-settings-view";

export const metadata: Metadata = { title: "Correo" };

export default async function MailSettingsPage() {
  const { role, user } = await getWorkspace();

  if (!canManageMailSettings(role)) {
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
            <h1 className="text-2xl font-bold">Correo</h1>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">
          {OWNER_ONLY_MAIL_MESSAGE}
        </p>
      </div>
    );
  }

  const service = await createServiceClient();
  const { row, status } = await getMailStatus(service);

  return (
    <MailSettingsView
      initial={{
        host: row?.host ?? "",
        port: row?.port ? String(row.port) : "",
        security: isMailSecurity(row?.security) ? row.security : "starttls",
        username: row?.username ?? "",
        hasPassword: !!row?.password_encrypted,
        fromEmail: row?.from_email ?? "",
        fromName: row?.from_name ?? "",
      }}
      initialStatus={status}
      userEmail={user.email ?? ""}
    />
  );
}
