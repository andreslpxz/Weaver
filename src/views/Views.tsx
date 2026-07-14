import { useEffect, useState } from 'react';
import {
  Puzzle,
  Sparkles,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  ExternalLink,
  Palette,
  Brain,
  Search,
  Terminal,
  FileText,
  Check,
  X,
  Shield,
  ChevronDown,
  ChevronRight,
  Loader2,
  Power,
  Circle,
} from 'lucide-react';
import { mcpClient, listPresets, type McpServer, type ToolApproval } from '@/mcp/client';
import { type McpPreset } from '@/mcp/presets';
import { skillsRegistry, type Skill } from '@/skills/registry';
import { skillsInstaller } from '@/skills/installer';
import { Badge, Button } from '@/components/common/Button';
import { runtime } from '@/lib/tauri';
import { THEMES, type ThemeId } from '@/lib/themes';
import { useWeaver } from '@/store/weaver';
import { memory } from '@/agent/memory';
import {
  IMPORT_PROMPT,
  importMemory,
  listImportedMemories,
  CATEGORY_LABELS,
  type MemorySource,
  type ImportedCategory,
} from '@/lib/memory-import';
import {
  getTavilyApiKey,
  setTavilyApiKey,
  deleteTavilyApiKey,
} from '@/lib/tools';

// ============================================================================
// ComplementosView — MCP servers + Skills importadas (skills.sh)
// ============================================================================

export function ComplementosView() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    setServers(mcpClient.listServers());
    skillsRegistry.loadAll().then(setSkills);
  }, []);

  function addServer() {
    if (!name.trim()) return;
    const server: McpServer = {
      id: crypto.randomUUID(),
      name: name.trim(),
      transport: 'stdio',
      command: 'npx',
      args: ['-y', url.trim() || name.trim()],
      enabled: true,
      status: 'installed',
    };
    mcpClient.saveServer(server);
    setServers(mcpClient.listServers());
    setName('');
    setUrl('');
  }

  async function installSkill() {
    if (!url.trim()) return;
    const result = await skillsInstaller.install(url.trim(), name.trim() || undefined);
    if (result.ok) {
      setUrl('');
      setName('');
      skillsRegistry.loadAll().then(setSkills);
    } else {
      alert(result.message);
    }
  }

  async function installFindSkills() {
    const r = await skillsInstaller.installFindSkills();
    if (r.ok) skillsRegistry.loadAll().then(setSkills);
    else alert(r.message);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-medium mb-2">Complementos</h1>
        <p className="text-text-secondary text-sm mb-8">
          Haz que Weaver se adapte a tu estilo. Conecta servidores MCP, instala skills de{' '}
          <code className="text-accent">skills.sh</code> y aprende de tus flujos.
        </p>

        {/* Quick install */}
        <div className="codex-card p-4 mb-6 bg-gradient-to-br from-accent/10 to-transparent">
          <div className="flex items-center gap-3">
            <Sparkles size={20} className="text-accent" />
            <div className="flex-1">
              <div className="font-medium">Instalar find-skills (recomendado)</div>
              <div className="text-xs text-text-muted">
                Permite a Weaver descubrir nuevas skills de la comunidad.
              </div>
            </div>
            <Button variant="primary" onClick={installFindSkills}>
              <Plus size={12} /> Instalar
            </Button>
          </div>
        </div>

        {/* Skill installer */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Puzzle size={14} /> Instalar skill desde URL
          </h2>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/vercel-labs/skills"
              className="codex-input flex-1 px-3 py-2 text-sm"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nombre (opcional)"
              className="codex-input w-44 px-3 py-2 text-sm"
            />
            <Button variant="primary" onClick={installSkill}>
              Instalar
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Equivale a: <code>npx skills add &lt;url&gt; --skill &lt;name&gt;</code>
          </p>
        </section>

        {/* Skills instaladas */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3">Skills instaladas ({skills.length})</h2>
          {skills.length === 0 ? (
            <EmptyStateCard
              icon={<Puzzle size={32} className="text-accent" />}
              title="Aún no hay skills instaladas"
              description="Las skills son procedimientos reutilizables que Weaver puede aprender de tareas exitosas o instalar desde la comunidad. Prueba instalando find-skills arriba para descubrir skills de la comunidad."
              actionLabel="Instalar find-skills"
              onAction={installFindSkills}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {skills.map((s) => (
                <div key={s.name} className="codex-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{s.name}</span>
                    <Badge color={s.source === 'learned' ? 'accent' : 'default'}>{s.source}</Badge>
                  </div>
                  <p className="text-xs text-text-muted mt-1">{s.description}</p>
                  {s.triggers.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.triggers.slice(0, 3).map((t, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-app-input rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* MCP servers — catálogo de presets + instalados */}
        <McpSection servers={servers} setServers={setServers} />

        {/* MCP servers — custom (avanzado) */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Plus size={14} /> Añadir servidor MCP personalizado
          </h2>
          <div className="flex gap-2 mb-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nombre del servidor"
              className="codex-input flex-1 px-3 py-2 text-sm"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="paquete npm o comando"
              className="codex-input flex-1 px-3 py-2 text-sm"
            />
            <Button variant="primary" onClick={addServer}>
              <Plus size={12} /> Añadir
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Para servidores MCP no incluidos en el catálogo de arriba.
          </p>
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// McpSection — catálogo de presets + servidores instalados
// ============================================================================

function McpSection({
  servers,
  setServers,
}: {
  servers: McpServer[];
  setServers: (s: McpServer[]) => void;
}) {
  const presets = listPresets();
  const [installing, setInstalling] = useState<string | null>(null);
  const [configuringServer, setConfiguringServer] = useState<string | null>(null);

  function installPreset(preset: McpPreset, envValues: Record<string, string>) {
    setInstalling(preset.id);
    try {
      mcpClient.installPreset(preset, envValues);
      setServers(mcpClient.listServers());
    } catch (e) {
      alert(`Error instalando ${preset.name}: ${e}`);
    } finally {
      setInstalling(null);
    }
  }

  function removeServer(id: string) {
    if (!confirm('¿Eliminar este servidor MCP? Se perderán las aprobaciones de tools.')) return;
    mcpClient.removeServer(id);
    setServers(mcpClient.listServers());
  }

  function toggleEnabled(server: McpServer) {
    mcpClient.saveServer({ ...server, enabled: !server.enabled });
    setServers(mcpClient.listServers());
  }

  return (
    <section>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Sparkles size={14} /> Servidores MCP — Catálogo
      </h2>
      <p className="text-xs text-text-muted mb-4">
        Instala servidores MCP oficiales con un solo click. Cada uno requiere
        credenciales que se te pedirán al instalar.
      </p>

      {/* Grid de presets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {presets.map((preset) => {
          const isInstalled = mcpClient.isPresetInstalled(preset.id);
          return (
            <McpPresetCard
              key={preset.id}
              preset={preset}
              installed={isInstalled}
              installing={installing === preset.id}
              onInstall={(env) => installPreset(preset, env)}
              onRemove={() => {
                const server = servers.find((s) => s.presetId === preset.id);
                if (server) removeServer(server.id);
              }}
            />
          );
        })}
      </div>

      {/* Servidores instalados con config de tools */}
      {servers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <SettingsIcon size={14} /> Instalados ({servers.length})
          </h3>
          {servers.map((s) => (
            <McpServerRow
              key={s.id}
              server={s}
              onRemove={() => removeServer(s.id)}
              onToggle={() => toggleEnabled(s)}
              onConfigure={() =>
                setConfiguringServer(
                  configuringServer === s.id ? null : s.id,
                )
              }
              showConfig={configuringServer === s.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// McpPresetCard — card de preset con logo SVG + form de credenciales
// ============================================================================

function McpPresetCard({
  preset,
  installed,
  installing,
  onInstall,
  onRemove,
}: {
  preset: McpPreset;
  installed: boolean;
  installing: boolean;
  onInstall: (env: Record<string, string>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  const canInstall = preset.envVars.every(
    (v) => !v.required || (envValues[v.name] && envValues[v.name].trim()),
  );

  function handleInstall() {
    onInstall(envValues);
    setExpanded(false);
    setEnvValues({});
  }

  return (
    <div
      className="codex-card p-4 transition-all hover:border-border-accent"
      style={{ borderColor: installed ? preset.color : undefined }}
    >
      <div className="flex items-start gap-3">
        {/* Logo SVG */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-codex flex items-center justify-center"
          style={{ backgroundColor: `${preset.color}15` }}
          dangerouslySetInnerHTML={{
            __html: preset.logo.replace(
              /<svg/,
              `<svg width="24" height="24" style="color: ${preset.color}"`,
            ),
          }}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm">{preset.name}</h3>
            {installed && (
              <Badge color="success">
                <Check size={9} className="inline mr-0.5" /> instalado
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-muted line-clamp-2">{preset.description}</p>
        </div>

        {/* Acción */}
        <div className="flex-shrink-0">
          {installed ? (
            <button
              onClick={onRemove}
              className="codex-icon-btn w-8 h-8 text-danger"
              title="Desinstalar"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <Button
              variant="primary"
              onClick={() => setExpanded(!expanded)}
              disabled={installing}
            >
              {installing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              Instalar
            </Button>
          )}
        </div>
      </div>

      {/* Form de credenciales (expandible) */}
      {expanded && !installed && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          {preset.envVars.length > 0 && (
            <>
              <p className="text-xs font-medium text-text-secondary">
                Configuración requerida:
              </p>
              {preset.envVars.map((envVar) => (
                <div key={envVar.name}>
                  <label className="text-xs text-text-secondary flex items-center gap-1 mb-1">
                    {envVar.label}
                    {envVar.required && <span className="text-danger">*</span>}
                  </label>
                  <input
                    type={envVar.type}
                    value={envValues[envVar.name] ?? ''}
                    onChange={(e) =>
                      setEnvValues({ ...envValues, [envVar.name]: e.target.value })
                    }
                    placeholder={envVar.name}
                    className="codex-input w-full px-2 py-1.5 text-xs font-mono"
                  />
                  <div className="flex items-center gap-1 mt-1">
                    <p className="text-[10px] text-text-muted flex-1">{envVar.helpText}</p>
                    {envVar.obtainUrl && (
                      <a
                        href={envVar.obtainUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                      >
                        Obtener <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Tools de ejemplo */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-1">
              Tools que expone:
            </p>
            <div className="flex flex-wrap gap-1">
              {preset.exampleTools.map((tool) => (
                <span
                  key={tool}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-app-elevated border border-border font-mono text-text-muted"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="primary" onClick={handleInstall} disabled={!canInstall}>
              <Check size={12} /> Confirmar instalación
            </Button>
            <Button variant="ghost" onClick={() => setExpanded(false)}>
              Cancelar
            </Button>
            <a
              href={preset.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline flex items-center gap-1 ml-auto self-center"
            >
              Docs <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// McpServerRow — fila de servidor instalado con toggle + config de tools
// ============================================================================

function McpServerRow({
  server,
  onRemove,
  onToggle,
  onConfigure,
  showConfig,
}: {
  server: McpServer;
  onRemove: () => void;
  onToggle: () => void;
  onConfigure: () => void;
  showConfig: boolean;
}) {
  const preset = server.presetId
    ? listPresets().find((p) => p.id === server.presetId)
    : null;

  return (
    <div className="codex-card">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Logo */}
          {preset ? (
            <div
              className="flex-shrink-0 w-8 h-8 rounded-codex flex items-center justify-center"
              style={{ backgroundColor: `${preset.color}15` }}
              dangerouslySetInnerHTML={{
                __html: preset.logo.replace(
                  /<svg/,
                  `<svg width="18" height="18" style="color: ${preset.color}"`,
                ),
              }}
            />
          ) : (
            <div className="flex-shrink-0 w-8 h-8 rounded-codex bg-app-elevated flex items-center justify-center">
              <Puzzle size={16} className="text-text-muted" />
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{server.name}</div>
            <div className="text-xs text-text-muted font-mono truncate">
              {server.transport}: {server.command} {(server.args ?? []).join(' ')}
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-1">
          <Badge color={server.enabled ? 'success' : 'default'}>
            {server.enabled ? 'activo' : 'pausado'}
          </Badge>
          <button
            onClick={onToggle}
            className="codex-icon-btn w-7 h-7"
            title={server.enabled ? 'Pausar' : 'Activar'}
          >
            <Power size={12} />
          </button>
          <button
            onClick={onConfigure}
            className="codex-icon-btn w-7 h-7"
            title="Configurar tools"
          >
            {showConfig ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <button
            onClick={onRemove}
            className="codex-icon-btn w-7 h-7 text-danger"
            title="Eliminar"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Panel de configuración de tools (expandible) */}
      {showConfig && <McpToolConfigPanel server={server} />}
    </div>
  );
}

// ============================================================================
// McpToolConfigPanel — panel de aprobación de tools
// ============================================================================

function McpToolConfigPanel({ server }: { server: McpServer }) {
  const [autoApprove, setAutoApprove] = useState(
    mcpClient.getApprovals(server.id).autoApproveAll,
  );
  const [, forceUpdate] = useState({});

  // Tools conocidas: si es preset, usar las exampleTools; si no, vacío.
  const preset = server.presetId
    ? listPresets().find((p) => p.id === server.presetId)
    : null;
  const knownTools = preset?.exampleTools ?? [];

  function setApproval(toolName: string, approval: ToolApproval) {
    if (approval === 'approved') mcpClient.approveTool(server.id, toolName);
    else if (approval === 'denied') mcpClient.denyTool(server.id, toolName);
    else mcpClient.resetTool(server.id, toolName);
    forceUpdate({});
  }

  function toggleAutoApprove() {
    const newVal = !autoApprove;
    setAutoApprove(newVal);
    mcpClient.setAutoApproveAll(server.id, newVal);
    forceUpdate({});
  }

  const approvals = mcpClient.getApprovals(server.id);

  return (
    <div className="border-t border-border p-3 bg-app-bg/50">
      {/* Auto-approve toggle */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-accent" />
          <div>
            <div className="text-sm font-medium">Aprobar todas las tools automáticamente</div>
            <div className="text-xs text-text-muted">
              Si está activado, cualquier tool del servidor se ejecutará sin pedir confirmación.
            </div>
          </div>
        </div>
        <button
          onClick={toggleAutoApprove}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            autoApprove ? 'bg-accent' : 'bg-border'
          }`}
          title={autoApprove ? 'Auto-approve ON' : 'Auto-approve OFF'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              autoApprove ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      {/* Lista de tools con aprobación individual */}
      {knownTools.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-2">
            Tools del servidor ({knownTools.length}):
          </p>
          <div className="space-y-1.5">
            {knownTools.map((toolName) => {
              const approval = autoApprove
                ? 'approved'
                : approvals.tools[toolName] ?? 'pending';
              return (
                <div
                  key={toolName}
                  className="flex items-center justify-between text-xs"
                >
                  <code className="font-mono text-text-secondary">{toolName}</code>
                  <div className="flex items-center gap-1">
                    {autoApprove ? (
                      <Badge color="success">
                        <Check size={9} className="inline" /> auto
                      </Badge>
                    ) : (
                      <>
                        <ApprovalButton
                          active={approval === 'approved'}
                          onClick={() => setApproval(toolName, 'approved')}
                          color="success"
                          icon={<Check size={10} />}
                          label="Permitir"
                        />
                        <ApprovalButton
                          active={approval === 'denied'}
                          onClick={() => setApproval(toolName, 'denied')}
                          color="danger"
                          icon={<X size={10} />}
                          label="Prohibir"
                        />
                        <ApprovalButton
                          active={approval === 'pending'}
                          onClick={() => setApproval(toolName, 'pending')}
                          color="default"
                          icon={<Circle size={8} />}
                          label="Preguntar"
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-muted">
          Las tools aparecerán aquí cuando el servidor esté corriendo en Tauri.
          En modo navegador solo se puede configurar la aprobación automática.
        </p>
      )}

      {/* Leyenda */}
      <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-3 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <Check size={9} className="text-success" /> Permitir
        </span>
        <span className="flex items-center gap-1">
          <X size={9} className="text-danger" /> Prohibir
        </span>
        <span className="flex items-center gap-1">
          <Circle size={6} /> Preguntar antes de ejecutar
        </span>
      </div>
    </div>
  );
}

function ApprovalButton({
  active,
  onClick,
  color,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  color: 'success' | 'danger' | 'default';
  icon: React.ReactNode;
  label: string;
}) {
  const colorClass =
    color === 'success'
      ? 'text-success border-success'
      : color === 'danger'
        ? 'text-danger border-danger'
        : 'text-text-muted border-border';
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-all ${
        active
          ? `${colorClass} bg-current/10`
          : 'border-border text-text-muted opacity-50 hover:opacity-100'
      }`}
    >
      {icon}
    </button>
  );
}

// ============================================================================
// HabilidadesView — Skills auto-aprendidas por el agente
// ============================================================================

export function HabilidadesView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    skillsRegistry.loadAll().then((all) => setSkills(all.filter((s) => s.source === 'learned')));
  }, []);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-medium mb-2">Habilidades</h1>
        <p className="text-text-secondary text-sm mb-8">
          Procedimientos que Weaver ha extraído de tareas exitosas. Se reutilizan
          automáticamente cuando un objetivo coincide con los triggers.
        </p>
        {skills.length === 0 ? (
          <EmptyStateCard
            icon={<Brain size={32} className="text-accent" />}
            title="Aún no hay habilidades auto-aprendidas"
            description="Weaver extrae procedimientos reutilizables de tareas exitosas. Cuando completes una tarea compleja (ej: 'abre gedit y escribe Hola'), Weaver guardará los pasos para reutilizarlos en objetivos similares."
            actionLabel="Empezar una tarea"
            onAction={() => {
              useWeaver.getState().setView('chat');
              useWeaver.getState().newConversation();
            }}
          />
        ) : (
          <div className="space-y-2">
            {skills.map((s) => (
              <div key={s.name} className="codex-card p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium">{s.name}</h3>
                  <Badge color="accent">aprendida</Badge>
                </div>
                <p className="text-sm text-text-secondary">{s.description}</p>
                <pre className="mt-2 text-xs font-mono text-text-muted whitespace-pre-wrap">{s.body}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// EmptyStateCard — estado vacío descriptivo con CTA
// ============================================================================

function EmptyStateCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="codex-card p-8 text-center">
      <div className="flex justify-center mb-4">{icon}</div>
      <h3 className="text-base font-medium text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-muted max-w-md mx-auto mb-4">{description}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          <Plus size={12} /> {actionLabel}
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// AutomatizacionesView — recopilación de episodios recientes
// ============================================================================

export function AutomatizacionesView() {
  const [episodes, setEpisodes] = useState<
    { id: string; objective: string; outcome: string; startedAt: number }[]
  >([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('weaver:episodes');
      setEpisodes(raw ? JSON.parse(raw) : []);
    } catch {
      setEpisodes([]);
    }
  }, []);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-medium mb-2">Automatizaciones</h1>
        <p className="text-text-secondary text-sm mb-8">
          Historial de tareas ejecutadas por el agente. Cada episodio queda
          registrado en la memoria episódica.
        </p>
        {episodes.length === 0 ? (
          <EmptyStateCard
            icon={<Sparkles size={32} className="text-accent" />}
            title="Sin automatizaciones aún"
            description="Aquí verás el historial de tareas que Weaver ha ejecutado. Cada episodio queda registrado en la memoria episódica con su plan, pasos y resultado."
            actionLabel="Probar con un comando"
            onAction={() => {
              useWeaver.getState().setView('chat');
              useWeaver.getState().newConversation();
            }}
          />
        ) : (
          <div className="space-y-2">
            {episodes.map((e) => (
              <div key={e.id} className="codex-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{e.objective}</span>
                  <Badge
                    color={
                      e.outcome === 'success'
                        ? 'success'
                        : e.outcome === 'partial'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {e.outcome}
                  </Badge>
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {new Date(e.startedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ConfiguracionView
// ============================================================================

export function ConfiguracionView() {
  const { themeId, setTheme } = useWeaver();
  const [tavilyKey, setTavilyKey] = useState('');
  const [tavilyStatus, setTavilyStatus] = useState<string | null>(null);
  const [tavilyHas, setTavilyHas] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importedMemories, setImportedMemories] = useState<
    { source: MemorySource; category: ImportedCategory; text: string }[]
  >([]);

  useEffect(() => {
    getTavilyApiKey().then((k) => {
      setTavilyHas(!!k);
      if (k) setTavilyKey(k);
    });
    listImportedMemories().then(setImportedMemories);
  }, []);

  async function saveTavily() {
    if (!tavilyKey || tavilyKey.length < 10) {
      setTavilyStatus('API key demasiado corta');
      return;
    }
    await setTavilyApiKey(tavilyKey);
    setTavilyHas(true);
    setTavilyStatus('✓ Guardada');
    setTimeout(() => setTavilyStatus(null), 2000);
  }

  async function deleteTavily() {
    await deleteTavilyApiKey();
    setTavilyKey('');
    setTavilyHas(false);
    setTavilyStatus('Eliminada');
    setTimeout(() => setTavilyStatus(null), 2000);
  }

  function copyImportPrompt() {
    navigator.clipboard.writeText(IMPORT_PROMPT).then(() => {
      setImportStatus('Prompt copiado al portapapeles. Pégalo en la otra IA y trae su respuesta aquí.');
      setTimeout(() => setImportStatus(null), 4000);
    });
  }

  async function doImport() {
    if (!importText.trim()) return;
    try {
      const result = await importMemory(importText);
      setImportStatus(`✓ Importadas ${result.saved} entradas desde ${result.source}.`);
      setImportText('');
      listImportedMemories().then(setImportedMemories);
    } catch (e) {
      setImportStatus(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setTimeout(() => setImportStatus(null), 5000);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-medium mb-2">Configuración</h1>
          <p className="text-text-secondary text-sm">
            Ajustes globales de Weaver. Las API keys se gestionan desde el icono del
            modelo en el composer.
          </p>
        </div>

        {/* Modo de ejecución */}
        <SettingCard
          title="Modo de ejecución"
          desc="Determina qué capacidades están disponibles."
        >
          <div className="flex items-center gap-2">
            <Badge color={runtime.isTauri ? 'success' : 'warning'}>
              {runtime.isTauri ? 'Tauri webview' : 'Navegador (dev)'}
            </Badge>
            <span className="text-xs text-text-muted">{runtime.describe()}</span>
          </div>
          {runtime.isBrowser && (
            <div className="mt-3 p-3 rounded-codex bg-warning/10 border border-warning/30 text-xs text-text-secondary space-y-2">
              <div className="font-medium text-warning">Estás en modo navegador</div>
              <div>
                En este modo las API keys se guardan en <code>localStorage</code> (no es seguro, sólo para desarrollo) y las tareas agénticas AT-SPI no están disponibles. Sin embargo, las tools web (search/fetch) y el chat con tools SÍ funcionan.
              </div>
              <div>
                Para acceso completo ejecuta:{' '}
                <code className="px-1 py-0.5 rounded bg-app-bg">npm run tauri:dev</code>
              </div>
            </div>
          )}
        </SettingCard>

        {/* Tema */}
        <SettingCard
          title="Tema"
          desc="Elige la paleta de colores. Los cambios se aplican al instante."
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`text-left p-2 rounded-codex border transition-colors ${
                  themeId === t.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-border-accent'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-4 h-4 rounded-full border border-border-accent"
                    style={{ background: t.swatch }}
                  />
                  <span className="text-sm font-medium">{t.label}</span>
                </div>
                <div className="text-[10px] text-text-muted">{t.desc}</div>
              </button>
            ))}
          </div>
        </SettingCard>

        {/* Tavily API key */}
        <SettingCard
          title="Búsqueda web (Tavily)"
          desc="API key para que el agente busque en internet. Obtén una gratis en tavily.com"
        >
          <div className="flex gap-2">
            <input
              type="password"
              value={tavilyKey}
              onChange={(e) => setTavilyKey(e.target.value)}
              placeholder="tvly-..."
              className="codex-input flex-1 px-3 py-2 text-sm"
            />
            <Button variant="primary" onClick={saveTavily}>
              Guardar
            </Button>
            {tavilyHas && (
              <Button variant="danger" onClick={deleteTavily}>
                <Trash2 size={12} />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <a
              href="https://tavily.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline inline-flex items-center gap-1"
            >
              Obtener API key <ExternalLink size={10} />
            </a>
            {tavilyHas && <Badge color="success">Configurada</Badge>}
          </div>
          {tavilyStatus && (
            <div className="mt-2 text-xs text-accent">{tavilyStatus}</div>
          )}
        </SettingCard>

        {/* Importar memoria */}
        <SettingCard
          title="Importar memoria de otra IA"
          desc="Trae el contexto que ChatGPT/Claude/Gemini/Grok aprendieron sobre ti."
        >
          <p className="text-xs text-text-secondary mb-2">
            1. Copia el prompt y pégalo en la otra IA. 2. Pega aquí su respuesta. Weaver categorizará las entradas y las guardará como facts.
          </p>
          <div className="flex gap-2 mb-3">
            <Button onClick={copyImportPrompt}>
              <FileText size={12} /> Copiar prompt
            </Button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Pega aquí la respuesta de la otra IA…"
            className="codex-input w-full px-3 py-2 text-xs font-mono min-h-[160px] resize-y"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted">{importText.length} caracteres</span>
            <Button variant="primary" onClick={doImport} disabled={!importText.trim()}>
              <Brain size={12} /> Importar memoria
            </Button>
          </div>
          {importStatus && (
            <div className="mt-2 text-xs text-accent whitespace-pre-wrap">{importStatus}</div>
          )}

          {/* Memorias importadas */}
          {importedMemories.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="text-xs font-medium text-text-secondary mb-2">
                Memorias importadas ({importedMemories.length})
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {importedMemories.map((m, i) => (
                  <div
                    key={i}
                    className="text-xs p-2 rounded bg-app-bg border border-border"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge color="accent">{m.source}</Badge>
                      <span className="text-text-muted text-[10px]">
                        {CATEGORY_LABELS[m.category]}
                      </span>
                    </div>
                    <div className="text-text-secondary">{m.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SettingCard>

        {/* Tools disponibles */}
        <SettingCard
          title="Herramientas del agente"
          desc="What Weaver can do via tools. Algunas requieren modo Tauri."
        >
          <ul className="text-xs space-y-1.5">
            <li className="flex items-start gap-2">
              <Search size={11} className="text-accent mt-0.5" />
              <div>
                <strong className="text-text-primary">web_search</strong> — Búsqueda en internet (Tavily). Funciona en navegador y Tauri.
              </div>
            </li>
            <li className="flex items-start gap-2">
              <Search size={11} className="text-accent mt-0.5" />
              <div>
                <strong className="text-text-primary">web_fetch</strong> — Descarga una URL y devuelve texto/markdown. Funciona en ambos modos.
              </div>
            </li>
            <li className="flex items-start gap-2">
              <Terminal size={11} className={runtime.isTauri ? 'text-accent' : 'text-text-muted'} />
              <div>
                <strong className="text-text-primary">shell_exec</strong> — Ejecuta comandos en bash. {runtime.isTauri ? '✓ Disponible' : '⚠ Sólo Tauri'}
              </div>
            </li>
            <li className="flex items-start gap-2">
              <FileText size={11} className={runtime.isTauri ? 'text-accent' : 'text-text-muted'} />
              <div>
                <strong className="text-text-primary">file_read / file_write / file_list</strong> — Operaciones de filesystem. {runtime.isTauri ? '✓ Disponible' : '⚠ Sólo Tauri'}
              </div>
            </li>
            <li className="flex items-start gap-2">
              <SettingsIcon size={11} className={runtime.isTauri ? 'text-accent' : 'text-text-muted'} />
              <div>
                <strong className="text-text-primary">atspi_* / auto_*</strong> — Control de apps vía accesibilidad AT-SPI. {runtime.isTauri ? '✓ Disponible' : '⚠ Sólo Tauri'}
              </div>
            </li>
          </ul>
          <div className="mt-3 p-2 rounded bg-app-bg border border-border text-[11px] text-text-muted">
            💡 En modo navegador, si escribes "busca en internet X" o "lee el archivo /etc/hosts", Weaver usará web_search/web_fetch automáticamente. Para shell_exec y AT-SPI necesitas <code>npm run tauri:dev</code>.
          </div>
        </SettingCard>

        <SettingCard title="Accesibilidad AT-SPI" desc="Requerido para que el agente opere otras apps (sólo en modo Tauri).">
          <code className="text-xs">gsettings set org.gnome.desktop.interface toolkit-accessibility true</code>
        </SettingCard>

        <SettingCard title="Dependencias Linux" desc="Herramientas que Weaver usa internamente.">
          <ul className="text-xs space-y-1 font-mono text-text-secondary">
            <li>• xdotool (X11 input) — {has('xdotool') ? '✓' : '✗'}</li>
            <li>• wtype (Wayland input) — {has('wtype') ? '✓' : '✗'}</li>
            <li>• xclip / wl-clipboard — {has('xclip') || has('wl-copy') ? '✓' : '✗'}</li>
            <li>• wmctrl (windows) — {has('wmctrl') ? '✓' : '✗'}</li>
            <li>• Ollama (local models) — {has('ollama') ? '✓' : '✗ (opcional)'}</li>
          </ul>
        </SettingCard>

        <SettingCard title="Memoria" desc="Episodios y hechos persistidos localmente.">
          <div className="flex gap-2 items-center justify-between">
            <p className="text-xs text-text-muted flex-1">
              La memoria incluye episodios pasados, hechos semánticos y memoria
              importada de otras IAs. Esta acción no se puede deshacer.
            </p>
            <button
              onClick={() => {
                if (confirm('¿Borrar TODA la memoria episódica y semántica (incluida la importada)?')) {
                  memory.clearAll().then(() => {
                    localStorage.removeItem('weaver:episodes');
                    localStorage.removeItem('weaver:facts');
                    listImportedMemories().then(setImportedMemories);
                    alert('Memoria borrada.');
                  });
                }
              }}
              className="codex-btn border border-danger/30 text-danger hover:bg-danger/10 px-3 py-1.5 rounded-codex text-sm"
              title="Acción destructiva — borra toda la memoria"
            >
              <Trash2 size={12} /> Borrar memoria
            </button>
          </div>
        </SettingCard>

        <SettingCard title="Acerca de" desc="">
          <div className="text-xs text-text-muted space-y-1">
            <div>Weaver v0.1.0</div>
            <div>Linux build · Tauri v2 · AT-SPI2</div>
            <a
              href="https://github.com/andreslpxz/Weaver"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              github.com/andreslpxz/Weaver <ExternalLink size={10} />
            </a>
          </div>
        </SettingCard>
      </div>
    </div>
  );
}

function SettingCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="codex-card p-4">
      <div className="font-medium text-sm flex items-center gap-2">
        {title === 'Tema' && <Palette size={12} className="text-accent" />}
        {title === 'Importar memoria de otra IA' && <Brain size={12} className="text-accent" />}
        {title === 'Búsqueda web (Tavily)' && <Search size={12} className="text-accent" />}
        {title === 'Herramientas del agente' && <SettingsIcon size={12} className="text-accent" />}
        {title}
      </div>
      {desc && <p className="text-xs text-text-muted mt-0.5 mb-3">{desc}</p>}
      {children}
    </div>
  );
}

function has(bin: string): boolean {
  return true;
}
