"use client";

import { useState } from "react";
import {
  Settings,
  Key,
  Hash,
  Save,
  Plus,
  X,
  Check,
  Eye,
  EyeOff,
  Plug,
  Loader2,
  ExternalLink,
  Users,
  ChevronRight,
  Sparkles,
  Mail,
  Briefcase,
  Contact,
  UsersRound,
  Headset,
  Clock,
  MessageSquareText,
  MessageCircle,
  KeyRound,
  SpellCheck,
  FileCode2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { saveWorkspaceSettings } from "@/lib/actions/settings";
import { isAdminRole } from "@/lib/permissions";
import { settingsLinksFor, type SettingsLinkKey } from "./settings-nav";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";

const LINK_ICONS: Record<SettingsLinkKey, LucideIcon> = {
  general: Settings,
  team: Users,
  mail: Mail,
  cases: Briefcase,
  "contact-types": Contact,
  teams: UsersRound,
  hours: Clock,
  attention: Headset,
  replies: MessageSquareText,
  "whatsapp-templates": MessageCircle,
  dictionary: SpellCheck,
  source: FileCode2,
  password: KeyRound,
};

/** Navegación de Configuración: cada persona ve solo lo que puede usar. */
function SettingsNav({ role }: { role: string | null | undefined }) {
  const links = settingsLinksFor(role);
  return (
    <nav aria-label="Secciones de configuración">
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((link) => {
          const Icon = LINK_ICONS[link.key];
          const className =
            "group flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted";
          const content = (
            <>
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{link.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{link.description}</span>
              </span>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          );
          return (
            <li key={link.key}>
              {link.href.startsWith("#") ? (
                <a href={link.href} className={className}>
                  {content}
                </a>
              ) : (
                <Link href={link.href} className={className}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface WorkspaceSettings {
  id: string;
  name: string;
  hasApiKey: boolean;
  hasAiKey: boolean;
  globalKeywords: string[];
}

interface TestResult {
  success: boolean;
  accountCount?: number;
  error?: string;
}

export function SettingsView({
  workspace,
  role,
  canManageSecrets = false,
}: {
  workspace: WorkspaceSettings;
  role: string | null | undefined;
  /** Solo el Dueño cambia las claves; el resto ve si están configuradas. */
  canManageSecrets?: boolean;
}) {
  const [name, setName] = useState(workspace.name);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiKey, setAiKey] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [keywords, setKeywords] = useState<string[]>(workspace.globalKeywords);
  const [newKeyword, setNewKeyword] = useState("");
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function addKeyword() {
    const trimmed = newKeyword.trim().toLowerCase();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) {
      setNewKeyword("");
      return;
    }
    setKeywords((prev) => [...prev, trimmed]);
    setNewKeyword("");
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  async function handleTestConnection() {
    const keyToTest = apiKey.trim();
    if (!keyToTest) return;

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/v1/channels/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyToTest, workspaceId: workspace.id }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setTestResult({
          success: false,
          error: data.error || `Falló la conexión (${res.status})`,
        });
        return;
      }

      const accounts = data.accounts || [];
      setTestResult({
        success: true,
        accountCount: accounts.length,
      });
      toast.success("Conexión verificada y clave guardada");

      // Key was saved and channels synced server-side
      setApiKey("");
    } catch {
      setTestResult({
        success: false,
        error: "No se pudo conectar con la API de Zernio. Revisa tu conexión a internet.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Las claves se guardan en el servidor (workspace_secrets) y nunca vuelven
      // al navegador; solo se envían si se escribió una nueva.
      const result = await saveWorkspaceSettings({
        workspaceId: workspace.id,
        name: name.trim(),
        globalKeywords: keywords,
        lateApiKey: canManageSecrets ? apiKey.trim() || undefined : undefined,
        aiApiKey: canManageSecrets ? aiKey.trim() || undefined : undefined,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      setSaved(true);
      toast.success("Configuración guardada");
      setApiKey("");
      setAiKey("");
      setTestResult(null);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      const message = err instanceof Error ? err.message : "No se pudo guardar la configuración. Inténtalo de nuevo.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const isAdmin = isAdminRole(role);

  // Los miembros no administran el espacio: solo ven lo suyo.
  if (!isAdmin) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-8 py-6">
          <h1 className="text-2xl font-bold">Configuración</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tus respuestas guardadas y tu cuenta</p>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-2xl px-8 py-8">
            <SettingsNav role={role} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Administra la configuración de tu espacio de trabajo
        </p>
      </div>

      {/* Settings form */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          <SettingsNav role={role} />

          <hr className="border-border" />

          {/* Nombre del espacio de trabajo */}
          <section id="general" className="scroll-mt-8">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">General</h2>
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-muted-foreground">
                Nombre del espacio de trabajo
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </section>

          <hr className="border-border" />

          {/* Zernio API Key */}
          <section>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Clave de API de Zernio</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Tu clave de API de Zernio se usa para conectar con las redes sociales.
              {workspace.hasApiKey && " Ya hay una clave configurada."}
            </p>
            {!canManageSecrets && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Solo el Dueño puede cambiar las claves de API.
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Puedes obtener tu clave de API en tu{" "}
              <a
                href="https://zernio.com/dashboard/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80"
              >
                panel de Zernio
                <ExternalLink className="h-3 w-3" />
              </a>
              . Regístrate en{" "}
              <a
                href="https://zernio.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                zernio.com
              </a>{" "}
              si aún no tienes una cuenta.
            </p>

            <div className="mt-4 relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                disabled={!canManageSecrets}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  // Clear test result when key changes
                  if (testResult) setTestResult(null);
                }}
                placeholder={
                  workspace.hasApiKey
                    ? "Ingresa una clave nueva para reemplazar la actual"
                    : "Ingresa tu clave de API de Zernio"
                }
                className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm font-mono placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Botón Probar conexión */}
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleTestConnection}
                disabled={!canManageSecrets || !apiKey.trim() || testing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plug className="h-3.5 w-3.5" />
                )}
                {testing ? "Probando..." : "Probar conexión"}
              </button>

              {testResult && testResult.success && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3.5 w-3.5" />
                  Conectado ({testResult.accountCount}{" "}
                  {testResult.accountCount === 1 ? "cuenta encontrada" : "cuentas encontradas"})
                </span>
              )}

              {testResult && !testResult.success && (
                <span className="text-xs text-red-600">
                  {testResult.error}
                </span>
              )}
            </div>

            {workspace.hasApiKey && !testResult && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-green-600">
                <Check className="h-3 w-3" />
                Clave de API configurada
              </p>
            )}
          </section>

          <hr className="border-border" />

          {/* Clave de API de AI Gateway */}
          <section>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">AI Gateway</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Necesaria para el nodo de respuesta con IA de los flujos. Usa{" "}
              <a
                href="https://vercel.com/ai-gateway"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80"
              >
                Vercel AI Gateway
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              para acceder a modelos de OpenAI, Anthropic y Google con una sola clave.
              {workspace.hasAiKey && " Ya hay una clave configurada."}
            </p>

            <div className="mt-4 relative">
              <input
                type={showAiKey ? "text" : "password"}
                value={aiKey}
                disabled={!canManageSecrets}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={
                  workspace.hasAiKey
                    ? "Ingresa una clave nueva para reemplazar la actual"
                    : "Ingresa tu clave de API de AI Gateway"
                }
                className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm font-mono placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowAiKey(!showAiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showAiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {workspace.hasAiKey && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-green-600">
                <Check className="h-3 w-3" />
                Clave de AI Gateway configurada
              </p>
            )}
          </section>

          <hr className="border-border" />

          {/* Palabras clave globales */}
          <section>
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Palabras clave globales</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Palabras clave que activan flujos en todos los canales. Los activadores propios de cada flujo tienen prioridad sobre las palabras clave globales.
            </p>

            {/* Campo de palabra clave */}
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Agregar una palabra clave..."
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={addKeyword}
                disabled={!newKeyword.trim()}
                className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Lista de palabras clave */}
            {keywords.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium"
                  >
                    {kw}
                    <button
                      onClick={() => removeKeyword(kw)}
                      className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground/70">
                No hay palabras clave globales configuradas
              </p>
            )}
          </section>

          <hr className="border-border" />

          {/* Botón Guardar */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Spinner />
                  Guardando…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Guardar cambios
                </>
              )}
            </button>

            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Check className="h-4 w-4" />
                Configuración guardada
              </span>
            )}

            {error && (
              <span className="text-sm text-red-600">
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
