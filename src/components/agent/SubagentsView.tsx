/**
 * SubagentsView — Catálogo CRUD de subagentes especializados.
 *
 * El usuario puede:
 *   - Ver los subagentes predefinidos (Web Researcher, File Reader, Email Summarizer).
 *   - Crear subagentes propios con:
 *     - nombre + descripción
 *     - system prompt + verification prompt
 *     - lista blanca de tools (checkboxes)
 *     - presupuesto (pasos/tokens/tiempo)
 *     - provider/modelo asignado (opcional)
 *   - Editar y borrar subagentes.
 *
 * Cada subagente se persiste vía subagentRegistry (localStorage).
 */

import { useEffect, useState } from 'react';
import {
  Plus, Trash2, Pencil, X, Save, Bot, Clock, Coins, Wrench, Check,
} from 'lucide-react';
import { Button, Badge, cn } from '@/components/common/Button';
import { subagentRegistry, type SubagentDef } from '@/agent/subagent';
import { ADVANCED_TOOLS } from '@/lib/tools';

export function SubagentsView() {
  const [list, setList] = useState<SubagentDef[]>([]);
  const [editing, setEditing] = useState<SubagentDef | null>(null);
  const [isNew, setIsNew] = useState(false);

  function refresh() {
    subagentRegistry.ensureDefaults();
    setList(subagentRegistry.list());
  }

  useEffect(() => {
    refresh();
  }, []);

  function startNew() {
    setIsNew(true);
    setEditing({
      id: `subagent-${Date.now()}`,
      name: '',
      description: '',
      providerId: null,
      model: null,
      allowedTools: [],
      systemPrompt: '',
      verificationPrompt: '',
      defaultBudget: { maxSteps: 6, maxTokens: 6000, maxTimeMs: 60_000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  function saveEditing() {
    if (!editing) return;
    if (!editing.name.trim()) {
      alert('El subagente necesita un nombre.');
      return;
    }
    subagentRegistry.save(editing);
    setEditing(null);
    setIsNew(false);
    refresh();
  }

  function cancelEditing() {
    setEditing(null);
    setIsNew(false);
  }

  function deleteOne(id: string) {
    if (!confirm('¿Eliminar este subagente? No se puede deshacer.')) return;
    subagentRegistry.delete(id);
    refresh();
  }

  if (editing) {
    return (
      <SubagentEditor
        def={editing}
        isNew={isNew}
        onChange={setEditing}
        onSave={saveEditing}
        onCancel={cancelEditing}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-medium flex items-center gap-2">
              <Bot size={20} className="text-accent" />
              Subagentes
            </h1>
            <p className="text-text-secondary text-xs mt-1">
              Agentes especializados que el orquestador puede invocar. Cada uno tiene su propio set de tools,
              presupuesto y criterio de éxito.
            </p>
          </div>
          <Button variant="primary" onClick={startNew}>
            <Plus size={14} /> Nuevo
          </Button>
        </div>

        {/* Lista */}
        <div className="space-y-3">
          {list.length === 0 && (
            <div className="text-center py-12 text-text-muted text-sm">
              No hay subagentes. Pulsa "Nuevo" para crear el primero.
            </div>
          )}
          {list.map((s) => (
            <div
              key={s.id}
              className="codex-card p-4 hover:border-border-accent transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium">{s.name}</h3>
                    {s.skillName && (
                      <Badge color="accent">skill: {s.skillName}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mb-2">{s.description}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Wrench size={10} /> {s.allowedTools.length} tools
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={10} /> {s.defaultBudget.maxSteps} pasos / {Math.round(s.defaultBudget.maxTimeMs / 1000)}s
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Coins size={10} /> {s.defaultBudget.maxTokens} tokens
                    </span>
                    {s.providerId && (
                      <Badge color="default">{s.providerId}{s.model ? ` · ${s.model}` : ''}</Badge>
                    )}
                  </div>
                  {/* Tools list */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.allowedTools.slice(0, 6).map((t) => (
                      <code key={t} className="text-[10px] px-1.5 py-0.5 bg-app-bg border border-border rounded">
                        {t}
                      </code>
                    ))}
                    {s.allowedTools.length > 6 && (
                      <span className="text-[10px] text-text-muted">
                        +{s.allowedTools.length - 6} más
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => { setIsNew(false); setEditing(s); }}
                    className="codex-icon-btn"
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteOne(s.id)}
                    className="codex-icon-btn text-danger hover:text-danger"
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Editor
// ============================================================================

function SubagentEditor({
  def, isNew, onChange, onSave, onCancel,
}: {
  def: SubagentDef;
  isNew: boolean;
  onChange: (d: SubagentDef) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function toggleTool(name: string) {
    const set = new Set(def.allowedTools);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange({ ...def, allowedTools: Array.from(set) });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-medium">
            {isNew ? 'Nuevo subagente' : `Editar ${def.name}`}
          </h1>
          <div className="flex gap-2">
            <Button onClick={onCancel}><X size={14} /> Cancelar</Button>
            <Button variant="primary" onClick={onSave}><Save size={14} /> Guardar</Button>
          </div>
        </div>

        {/* Nombre */}
        <Field label="Nombre" desc="Cómo se llama este subagente en el catálogo.">
          <input
            type="text"
            value={def.name}
            onChange={(e) => onChange({ ...def, name: e.target.value })}
            placeholder="Ej: Web Researcher, Email Summarizer…"
            className="codex-input w-full px-3 py-2 text-sm"
          />
        </Field>

        {/* Descripción */}
        <Field label="Descripción" desc="El orquestador usa esto para decidir si invocarte.">
          <textarea
            value={def.description}
            onChange={(e) => onChange({ ...def, description: e.target.value })}
            placeholder="Ej: Busca información en internet y devuelve un resumen con fuentes."
            className="codex-input w-full px-3 py-2 text-sm min-h-[60px] resize-y"
          />
        </Field>

        {/* System prompt */}
        <Field
          label="System prompt"
          desc="Instrucciones específicas del subagente. Define su comportamiento y formato de salida."
        >
          <textarea
            value={def.systemPrompt}
            onChange={(e) => onChange({ ...def, systemPrompt: e.target.value })}
            placeholder="Eres un… Cuando termines, responde EXACTAMENTE: RESULT: … EVIDENCE: …"
            className="codex-input w-full px-3 py-2 text-xs font-mono min-h-[140px] resize-y"
          />
        </Field>

        {/* Verification prompt */}
        <Field
          label="Prompt de verificación"
          desc="El orquestador lo usa para validar que el subagente realmente cumplió."
        >
          <textarea
            value={def.verificationPrompt}
            onChange={(e) => onChange({ ...def, verificationPrompt: e.target.value })}
            placeholder="Ej: ¿El resultado incluye al menos 2 URLs verificables?"
            className="codex-input w-full px-3 py-2 text-xs min-h-[60px] resize-y"
          />
        </Field>

        {/* Tools whitelist */}
        <Field
          label="Tools permitidas"
          desc="Sólo las tools marcadas estarán disponibles para este subagente. Restringe para ganar seguridad."
        >
          <div className="grid grid-cols-2 gap-1.5">
            {ADVANCED_TOOLS.map((t) => {
              const checked = def.allowedTools.includes(t.name);
              return (
                <button
                  key={t.name}
                  onClick={() => toggleTool(t.name)}
                  className={cn(
                    'text-left px-2 py-1.5 rounded-codex border text-[11px] flex items-center gap-1.5 transition-colors',
                    checked
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-border hover:border-border-accent text-text-secondary',
                  )}
                >
                  {checked ? <Check size={10} className="text-accent" /> : <span className="w-[10px]" />}
                  <code className="truncate">{t.name}</code>
                  {t.destructive && <span className="text-danger text-[9px]">⚠</span>}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Presupuesto */}
        <Field
          label="Presupuesto"
          desc="Límites máximos por invocación. Si se excede, el subagente se detiene y el orquestador decide."
        >
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="Pasos"
              value={def.defaultBudget.maxSteps}
              onChange={(v) => onChange({ ...def, defaultBudget: { ...def.defaultBudget, maxSteps: v } })}
              min={1}
              max={50}
            />
            <NumberField
              label="Tokens"
              value={def.defaultBudget.maxTokens}
              onChange={(v) => onChange({ ...def, defaultBudget: { ...def.defaultBudget, maxTokens: v } })}
              min={500}
              max={100_000}
              step={500}
            />
            <NumberField
              label="Tiempo (s)"
              value={Math.round(def.defaultBudget.maxTimeMs / 1000)}
              onChange={(v) => onChange({ ...def, defaultBudget: { ...def.defaultBudget, maxTimeMs: v * 1000 } })}
              min={5}
              max={600}
            />
          </div>
        </Field>

        {/* Provider/model opcional */}
        <Field
          label="Proveedor y modelo (opcional)"
          desc="Si vacío, hereda el del orquestador. Útil para usar modelos baratos en tareas rutinarias."
        >
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={def.providerId ?? ''}
              onChange={(e) => onChange({ ...def, providerId: e.target.value || null })}
              placeholder="Ej: google, openai, anthropic…"
              className="codex-input px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={def.model ?? ''}
              onChange={(e) => onChange({ ...def, model: e.target.value || null })}
              placeholder="Ej: gemini-1.5-flash, gpt-4o-mini…"
              className="codex-input px-3 py-2 text-sm"
            />
          </div>
        </Field>

        {/* Skill opcional */}
        <Field
          label="Skill asociada (opcional)"
          desc="Si este subagente envuelve una skill existente, indica su nombre."
        >
          <input
            type="text"
            value={def.skillName ?? ''}
            onChange={(e) => onChange({ ...def, skillName: e.target.value || undefined })}
            placeholder="Ej: web_researcher"
            className="codex-input w-full px-3 py-2 text-sm"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium mb-1">{label}</div>
      {desc && <p className="text-xs text-text-muted mb-2">{desc}</p>}
      {children}
    </div>
  );
}

function NumberField({
  label, value, onChange, min, max, step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <div className="text-[10px] text-text-muted mb-1">{label}</div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="codex-input w-full px-2 py-1.5 text-sm"
      />
    </div>
  );
}
