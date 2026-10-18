"use client";

const POPULAR_MODELS = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

interface AiResponsePanelData {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextMessages?: number;
  sendDirectly?: boolean;
  [key: string]: unknown;
}

interface AiResponsePanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function AiResponsePanel({ data: rawData, onChange }: AiResponsePanelProps) {
  const data = rawData as AiResponsePanelData;
  const currentModel = data.model || "openai/gpt-4o-mini";

  return (
    <div className="space-y-4">
      {/* System Prompt */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Instrucciones del sistema (prompt)
        </label>
        <textarea
          value={data.systemPrompt || ""}
          onChange={(e) => onChange({ ...data, systemPrompt: e.target.value })}
          placeholder="Eres un asesor de atención al cliente amable y servicial..."
          rows={8}
          className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Indica cómo debe comportarse y responder la IA.
        </p>
      </div>

      {/* Model */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Modelo
        </label>
        <input
          type="text"
          value={currentModel}
          onChange={(e) => onChange({ ...data, model: e.target.value })}
          placeholder="proveedor/modelo (ej. openai/gpt-4o-mini)"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {POPULAR_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...data, model: m.id })}
              className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                currentModel === m.id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                  : "border-border text-muted-foreground hover:border-input"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground/60">
          Cualquier modelo compatible con{" "}
          <a
            href="https://vercel.com/ai-gateway"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground"
          >
            Vercel AI Gateway
          </a>
          . Formato: proveedor/nombre-del-modelo
        </p>
      </div>

      {/* Temperature */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Temperatura</label>
          <span className="text-xs text-muted-foreground">{data.temperature ?? 0.7}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={data.temperature ?? 0.7}
          onChange={(e) => onChange({ ...data, temperature: parseFloat(e.target.value) })}
          className="w-full"
        />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/60">
          <span>Precisa</span>
          <span>Creativa</span>
        </div>
      </div>

      {/* Max Tokens */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Máximo de tokens
        </label>
        <input
          type="number"
          value={data.maxTokens ?? 500}
          onChange={(e) => onChange({ ...data, maxTokens: parseInt(e.target.value) || 500 })}
          min={1}
          max={4096}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Longitud máxima de la respuesta de la IA.
        </p>
      </div>

      {/* Context Messages */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Mensajes de contexto
        </label>
        <input
          type="number"
          value={data.contextMessages ?? 10}
          onChange={(e) => onChange({ ...data, contextMessages: parseInt(e.target.value) || 10 })}
          min={1}
          max={50}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Cuántos mensajes anteriores se incluyen como contexto para la IA.
        </p>
      </div>

      {/* Send Directly */}
      <div>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={data.sendDirectly ?? true}
            onChange={(e) => onChange({ ...data, sendDirectly: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-border text-blue-500 focus:ring-blue-500"
          />
          Enviar la respuesta automáticamente
        </label>
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          La respuesta generada siempre queda disponible para los nodos
          siguientes como {"{{ai_response}}"}. Desactívalo para solo guardarla
          y enviarla tú mismo con un nodo Enviar mensaje.
        </p>
      </div>
    </div>
  );
}
