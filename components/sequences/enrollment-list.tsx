"use client";

import { useState } from "react";
import { Users, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { cancelEnrollment } from "@/lib/actions/sequences";

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
}: {
  enrollments: Enrollment[];
}) {
  const [enrollments, setEnrollments] = useState(initial);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function handleCancel(enrollmentId: string) {
    setCancelling(enrollmentId);
    const result = await cancelEnrollment(enrollmentId);

    if (!result.error) {
      setEnrollments((prev) =>
        prev.map((e) =>
          e.id === enrollmentId ? { ...e, status: "cancelled" as const } : e
        )
      );
    }
    setCancelling(null);
  }

  return (
    <div className="px-8 py-6">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-lg font-semibold">Inscripciones</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contactos que están en esta secuencia
        </p>

        {enrollments.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no hay contactos inscritos
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Los contactos se pueden inscribir mediante flujos o de forma manual
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border rounded-lg border border-border">
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
