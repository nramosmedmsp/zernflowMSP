"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, XCircle, Loader2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { cancelEnrollment } from "@/lib/actions/sequences";
import { useToast } from "@/components/ui/toast";
import { sequenceEnrollGate } from "@/lib/sequences/enroll-gate";
import { EnrollContactDialog } from "@/components/sequences/enroll-contact-dialog";
import { secondaryButtonClass } from "@/components/inbox/ui";

interface Enrollment {
  id: string;
  contactName: string;
  currentStepIndex: number;
  status: "active" | "completed" | "cancelled";
  enrolledAt: string;
  /** Último paso que no se pudo enviar (la inscripción siguió con el paso siguiente). */
  lastFailure?: { stepIndex: number; reason: string; at: string } | null;
}

const statusConfig = {
  active: {
    label: "Activa",
    classes:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  completed: {
    label: "Completada",
    classes:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  cancelled: {
    label: "Cancelada",
    classes: "bg-muted text-muted-foreground",
  },
};

export function EnrollmentList({
  enrollments: initial,
  sequence,
  canEnroll = false,
}: {
  enrollments: Enrollment[];
  /** La secuencia (estado guardado y número de pasos) para decidir si se puede inscribir. */
  sequence?: { id: string; name: string; status: string; stepCount: number };
  /** Solo Dueño y Administrador inscriben a mano. */
  canEnroll?: boolean;
}) {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState(initial);
  // Tras inscribir se recarga la página: la lista nueva reemplaza a la que se veía.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setEnrollments(initial);
  }
  const [enrollOpen, setEnrollOpen] = useState(false);
  const enrollGate = sequence ? sequenceEnrollGate({ status: sequence.status, stepCount: sequence.stepCount }) : null;
  const [cancelling, setCancelling] = useState<string | null>(null);
  const toast = useToast();

  async function handleCancel(enrollmentId: string) {
    setCancelling(enrollmentId);
    try {
      const result = await cancelEnrollment(enrollmentId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setEnrollments((prev) =>
        prev.map((e) =>
          e.id === enrollmentId ? { ...e, status: "cancelled" as const } : e
        )
      );
    } catch {
      toast.error("No se pudo cancelar la inscripción. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="px-8 py-6" data-testid="enrollment-list">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Inscripciones
              {enrollments.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">({enrollments.length})</span>
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Contactos que están en esta secuencia
            </p>
          </div>
          {canEnroll && sequence && enrollGate && (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => setEnrollOpen(true)}
                disabled={!enrollGate.ok}
                title={enrollGate.ok ? undefined : enrollGate.message}
                className={cn(secondaryButtonClass, !enrollGate.ok && "cursor-not-allowed")}
                data-testid="enroll-contact-button"
              >
                <UserPlus className="h-4 w-4" />
                Inscribir contacto
              </button>
              {!enrollGate.ok && (
                <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="enroll-disabled-reason">
                  {enrollGate.message}
                </p>
              )}
            </div>
          )}
        </div>
        {canEnroll && sequence && (
          <EnrollContactDialog
            open={enrollOpen}
            sequenceId={sequence.id}
            sequenceName={sequence.name}
            onClose={() => setEnrollOpen(false)}
            onEnrolled={() => router.refresh()}
          />
        )}

        {enrollments.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no hay contactos inscritos
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {canEnroll ? "Se inscriben desde los flujos o con el botón «Inscribir contacto»" : "Los contactos se inscriben desde los flujos"}
            </p>
          </div>
        ) : (
          <div
            className="mt-4 max-h-[40vh] divide-y divide-border overflow-y-auto rounded-lg border border-border"
            data-testid="enrollment-scroll"
          >
            {enrollments.map((enrollment) => {
              const status = statusConfig[enrollment.status];
              const isCancelling = cancelling === enrollment.id;

              return (
                <div
                  key={enrollment.id}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {enrollment.contactName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Paso {enrollment.currentStepIndex + 1}
                      <span className="mx-1.5">-</span>
                      Inscrito el {formatDateTime(enrollment.enrolledAt)}
                    </p>
                    {enrollment.lastFailure && (
                      <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                        Paso {enrollment.lastFailure.stepIndex + 1} no enviado: {enrollment.lastFailure.reason}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                      status.classes
                    )}
                  >
                    {status.label}
                  </span>
                  {enrollment.status === "active" && (
                    <button
                      onClick={() => handleCancel(enrollment.id)}
                      disabled={isCancelling}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50"
                      title="Cancelar inscripción"
                    >
                      {isCancelling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
