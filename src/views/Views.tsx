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
  Clock,
  MessageSquare,
  Code2,
} from 'lucide-react';
import { mcpClient, listPresets, type McpServer, type ToolApproval } from '@/mcp/client';
import { type McpPreset } from '@/mcp/presets';
import { skillsRegistry, type Skill } from '@/skills/registry';
import { skillsInstaller } from '@/skills/installer';
import { Badge, Button, cn } from '@/components/common/Button';
import { runtime } from '@/lib/tauri';
import { THEMES, type ThemeId } from '@/lib/themes';
import { useWeaver } from '@/store/weaver';
import { useT, useLang } from '@/lib/i18n';
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
            <div className="text-sm text-text-muted p-4 border border-dashed border-border rounded-codex text-center">
              Aún no hay skills instaladas.
            </div>
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

        {/* Integraciones nativas (no MCP) — separadas por diseño */}
        <NativeIntegrationsSection />
      </div>
    </div>
  );
}

// ============================================================================
// NativeIntegrationsSection — integraciones directas (IMAP/SMTP, Calendarios PC,
// Nube, Tareas externas, Notas externas, Mensajería, Clima, Mapas, Smart Home)
// Estas NO son MCP: son conexiones nativas gestionadas por ME.
// ============================================================================

interface NativeIntegrationDef {
  id: string;
  kind: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  fields: Array<{ key: string; label: string; type?: 'text' | 'password'; placeholder?: string }>;
  docsUrl?: string;
}

const NATIVE_INTEGRATIONS: NativeIntegrationDef[] = [
  // Correo
  {
    id: 'email-imap',
    kind: 'email',
    label: 'Correo (IMAP/SMTP)',
    description: 'Conecta tu cuenta de correo para enviar y recibir mensajes directamente desde Weaver.',
    icon: <span style={{ background: '#0a61b8', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>@</span>,
    color: '#0a61b8',
    fields: [
      { key: 'host', label: 'Servidor IMAP', placeholder: 'imap.gmail.com' },
      { key: 'smtp_host', label: 'Servidor SMTP', placeholder: 'smtp.gmail.com' },
      { key: 'username', label: 'Usuario', placeholder: 'tu@correo.com' },
      { key: 'password', label: 'Contraseña / App password', type: 'password' },
    ],
    docsUrl: 'https://support.google.com/mail/answer/185833',
  },
  // Calendarios PC
  {
    id: 'google-calendar',
    kind: 'calendar-pc',
    label: 'Google Calendar',
    description: 'Sincroniza eventos con tu Google Calendar. El agente puede preguntar "¿PC o aquí?" y editar el de tu PC.',
    icon: <span style={{ background: '#4285F4', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Cal</span>,
    color: '#4285F4',
    fields: [
      { key: 'client_id', label: 'OAuth Client ID', placeholder: 'xxxxx.apps.googleusercontent.com' },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'password' },
      { key: 'calendar_id', label: 'Calendar ID', placeholder: 'primary' },
    ],
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
  },
  {
    id: 'outlook-calendar',
    kind: 'calendar-pc',
    label: 'Outlook Calendar',
    description: 'Sincroniza con tu calendario de Outlook/Microsoft 365.',
    icon: <span style={{ background: '#0078D4', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Out</span>,
    color: '#0078D4',
    fields: [
      { key: 'client_id', label: 'Application (client) ID' },
      { key: 'client_secret', label: 'Client secret', type: 'password' },
      { key: 'tenant_id', label: 'Directory (tenant) ID' },
    ],
    docsUrl: 'https://learn.microsoft.com/graph/outlook-calendar-concept-overview',
  },
  {
    id: 'apple-calendar',
    kind: 'calendar-pc',
    label: 'Apple Calendar',
    description: 'Calendario de macOS via EventKit (solo en macOS).',
    icon: <span style={{ background: '#FF3B30', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}></span>,
    color: '#FF3B30',
    fields: [],
    docsUrl: 'https://developer.apple.com/documentation/eventkit',
  },
  // Nube
  {
    id: 'google-drive',
    kind: 'cloud',
    label: 'Google Drive',
    description: 'Acceso a tus archivos de Drive.',
    icon: <span style={{ background: '#0F9D58', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>D</span>,
    color: '#0F9D58',
    fields: [
      { key: 'client_id', label: 'OAuth Client ID' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    id: 'onedrive',
    kind: 'cloud',
    label: 'OneDrive',
    description: 'Acceso a tus archivos de OneDrive.',
    icon: <span style={{ background: '#0078D4', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>OD</span>,
    color: '#0078D4',
    fields: [{ key: 'client_id', label: 'Application ID' }, { key: 'client_secret', label: 'Client secret', type: 'password' }],
  },
  {
    id: 'dropbox',
    kind: 'cloud',
    label: 'Dropbox',
    description: 'Acceso a tus archivos de Dropbox.',
    icon: <span style={{ background: '#0061FF', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Db</span>,
    color: '#0061FF',
    fields: [{ key: 'access_token', label: 'Access token', type: 'password' }],
  },
  // Tareas externas
  {
    id: 'todoist',
    kind: 'tasks',
    label: 'Todoist',
    description: 'Sincroniza tareas con tu cuenta Todoist.',
    icon: <span style={{ background: '#E44332', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>T</span>,
    color: '#E44332',
    fields: [{ key: 'api_token', label: 'API token', type: 'password' }],
  },
  {
    id: 'ticktick',
    kind: 'tasks',
    label: 'TickTick',
    description: 'Sincroniza tareas con TickTick.',
    icon: <span style={{ background: '#4772FA', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Tt</span>,
    color: '#4772FA',
    fields: [{ key: 'access_token', label: 'Access token', type: 'password' }],
  },
  // Notas externas
  {
    id: 'notion',
    kind: 'notes',
    label: 'Notion',
    description: 'Acceso a tus bases de datos y páginas de Notion.',
    icon: <span style={{ background: '#000', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>N</span>,
    color: '#000',
    fields: [{ key: 'token', label: 'Integration token', type: 'password' }],
  },
  {
    id: 'obsidian',
    kind: 'notes',
    label: 'Obsidian',
    description: 'Lee y escribe notas en tu bóveda de Obsidian (vía ruta local).',
    icon: <span style={{ background: '#7C3AED', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Ob</span>,
    color: '#7C3AED',
    fields: [{ key: 'vault_path', label: 'Ruta a la bóveda', placeholder: '/home/user/Documents/MiVault' }],
  },
  // Mensajería
  {
    id: 'telegram',
    kind: 'messaging',
    label: 'Telegram',
    description: 'Envía mensajes vía Telegram Bot API.',
    icon: <span style={{ background: '#0088CC', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Tg</span>,
    color: '#0088CC',
    fields: [
      { key: 'bot_token', label: 'Bot token', type: 'password' },
      { key: 'chat_id', label: 'Chat ID destino' },
    ],
  },
  {
    id: 'whatsapp',
    kind: 'messaging',
    label: 'WhatsApp (Twilio)',
    description: 'Envía mensajes por WhatsApp Business API vía Twilio.',
    icon: <span style={{ background: '#25D366', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Wa</span>,
    color: '#25D366',
    fields: [
      { key: 'account_sid', label: 'Account SID' },
      { key: 'auth_token', label: 'Auth token', type: 'password' },
      { key: 'from', label: 'Número remitente (Twilio)' },
    ],
  },
  {
    id: 'slack',
    kind: 'messaging',
    label: 'Slack',
    description: 'Publica mensajes en canales de Slack.',
    icon: <span style={{ background: '#4A154B', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>Sl</span>,
    color: '#4A154B',
    fields: [
      { key: 'bot_token', label: 'Bot User OAuth token (xoxb-)', type: 'password' },
      { key: 'channel', label: 'Canal (#general)' },
    ],
  },
  // Clima (no MCP)
  {
    id: 'openweather',
    kind: 'weather',
    label: 'OpenWeather',
    description: 'Datos meteorológicos extendidos (ya integrado en ME > Clima con Open-Meteo; esta opción permite usar OpenWeather si prefieres esa API).',
    icon: <span style={{ background: '#30A4E6', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>W</span>,
    color: '#30A4E6',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  // Mapas
  {
    id: 'google-maps',
    kind: 'maps',
    label: 'Google Maps',
    description: 'Rutas, lugares y direcciones.',
    icon: <span style={{ background: '#34A853', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>M</span>,
    color: '#34A853',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    id: 'openstreetmap',
    kind: 'maps',
    label: 'OpenStreetMap',
    description: 'Geocoding y rutas vía OSRM / Nominatim (gratis, sin API key).',
    icon: <span style={{ background: '#7EBC6F', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>OSM</span>,
    color: '#7EBC6F',
    fields: [],
  },
  // Smart home
  {
    id: 'home-assistant',
    kind: 'smart-home',
    label: 'Home Assistant',
    description: 'Controla luces, sensores y dispositivos de tu casa.',
    icon: <span style={{ background: '#18BCF2', color: '#fff', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>HA</span>,
    color: '#18BCF2',
    fields: [
      { key: 'base_url', label: 'URL base', placeholder: 'http://homeassistant.local:8123' },
      { key: 'token', label: 'Long-Lived Access Token', type: 'password' },
    ],
  },
  {
    id: 'philips-hue',
    kind: 'smart-home',
    label: 'Philips Hue',
    description: 'Controla tus bombillas Hue.',
    icon: <span style={{ background: '#FFC65A', color: '#000', width: 20, height: 20, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>H</span>,
    color: '#FFC65A',
    fields: [
      { key: 'bridge_ip', label: 'IP del bridge' },
      { key: 'username', label: 'Username (Hue API)', type: 'password' },
    ],
  },
];

const NATIVE_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'email', label: 'Correo' },
  { id: 'calendar-pc', label: 'Calendarios PC' },
  { id: 'cloud', label: 'Nube' },
  { id: 'tasks', label: 'Tareas externas' },
  { id: 'notes', label: 'Notas externas' },
  { id: 'messaging', label: 'Mensajería' },
  { id: 'weather', label: 'Clima' },
  { id: 'maps', label: 'Mapas' },
  { id: 'smart-home', label: 'Smart Home' },
];

function NativeIntegrationsSection() {
  const { meIntegrations, upsertMeIntegration, deleteMeIntegration, loadMeIntegrations } = useWeaver();
  const [openConfig, setOpenConfig] = useState<string | null>(null);

  useEffect(() => {
    loadMeIntegrations();
  }, [loadMeIntegrations]);

  function isEnabled(defId: string): boolean {
    return meIntegrations.some((i) => i.id === defId && i.enabled);
  }
  function getConfig(defId: string): Record<string, string> {
    const it = meIntegrations.find((i) => i.id === defId);
    if (!it) return {};
    try { return JSON.parse(it.config_json); } catch { return {}; }
  }
  async function toggle(def: NativeIntegrationDef) {
    const existing = meIntegrations.find((i) => i.id === def.id);
    if (existing && existing.enabled) {
      await upsertMeIntegration({ ...existing, enabled: false });
    } else {
      await upsertMeIntegration({
        id: def.id,
        kind: def.kind,
        label: def.label,
        config_json: existing?.config_json ?? '{}',
        enabled: true,
        created_at: existing?.created_at ?? Date.now(),
      });
    }
  }
  async function saveConfig(def: NativeIntegrationDef, config: Record<string, string>) {
    const existing = meIntegrations.find((i) => i.id === def.id);
    await upsertMeIntegration({
      id: def.id,
      kind: def.kind,
      label: def.label,
      config_json: JSON.stringify(config),
      enabled: existing?.enabled ?? false,
      created_at: existing?.created_at ?? Date.now(),
    });
    setOpenConfig(null);
  }

  return (
    <section className="mt-10 border-t border-border pt-6">
      <div className="mb-4">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <span className="text-accent">⚡</span> Integraciones nativas
        </h2>
        <p className="text-xs text-text-muted">
          Conexiones directas (no MCP) con servicios externos. El agente puede usar estas integraciones
          cuando le pidas cosas como "envía un correo", "enciende las luces", "¿cómo llego a…?" o "organiza mi calendario de la PC".
        </p>
      </div>

      {NATIVE_CATEGORIES.map((cat) => {
        const defs = NATIVE_INTEGRATIONS.filter((d) => d.kind === cat.id);
        if (defs.length === 0) return null;
        return (
          <div key={cat.id} className="mb-5">
            <div className="text-[10px] uppercase text-text-muted mb-1.5 px-1">{cat.label}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {defs.map((def) => {
                const enabled = isEnabled(def.id);
                const config = getConfig(def.id);
                return (
                  <div key={def.id} className={cn('codex-card p-3 flex items-start gap-2.5', enabled && 'border-accent')}>
                    <div className="shrink-0 mt-0.5">{def.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{def.label}</span>
                        {enabled && <Badge color="success">activa</Badge>}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{def.description}</p>
                      {def.fields.length > 0 && (
                        <button
                          onClick={() => setOpenConfig(openConfig === def.id ? null : def.id)}
                          className="text-[10px] text-accent hover:underline mt-1"
                        >
                          {openConfig === def.id ? 'Ocultar' : 'Configurar'}
                        </button>
                      )}
                      {openConfig === def.id && def.fields.length > 0 && (
                        <ConfigForm
                          def={def}
                          initial={config}
                          onSave={saveConfig}
                          onCancel={() => setOpenConfig(null)}
                        />
                      )}
                    </div>
                    <button
                      onClick={() => toggle(def)}
                      className={cn(
                        'shrink-0 text-xs px-2 py-1 rounded-codex border transition-colors',
                        enabled
                          ? 'border-success text-success hover:bg-success/10'
                          : 'border-border text-text-secondary hover:border-accent hover:text-accent',
                      )}
                    >
                      {enabled ? 'Activada' : 'Activar'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ConfigForm({
  def, initial, onSave, onCancel,
}: {
  def: NativeIntegrationDef;
  initial: Record<string, string>;
  onSave: (def: NativeIntegrationDef, config: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  return (
    <div className="mt-2 space-y-1.5 p-2 rounded-codex bg-app-input/40 border border-border">
      {def.fields.map((f) => (
        <div key={f.key}>
          <label className="text-[10px] uppercase text-text-muted">{f.label}</label>
          <input
            type={f.type ?? 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            className="codex-input w-full px-2 py-1 text-xs"
          />
        </div>
      ))}
      <div className="flex gap-1 pt-1">
        <Button variant="primary" onClick={() => onSave(def, values)}>Guardar</Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        {def.docsUrl && (
          <a
            href={def.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-accent hover:underline ml-auto self-center"
          >
            Documentación ↗
          </a>
        )}
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
      // Avisar al Composer que recargue su lista de MCPs para el menú @.
      window.dispatchEvent(new CustomEvent('weaver:mcp-changed'));
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
    window.dispatchEvent(new CustomEvent('weaver:mcp-changed'));
  }

  function toggleEnabled(server: McpServer) {
    mcpClient.saveServer({ ...server, enabled: !server.enabled });
    setServers(mcpClient.listServers());
    window.dispatchEvent(new CustomEvent('weaver:mcp-changed'));
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
          <div className="text-sm text-text-muted p-8 border border-dashed border-border rounded-codex text-center">
            Aún no hay habilidades auto-aprendidas. Ejecuta tareas complejas y Weaver
            extraerá procedimientos reutilizables.
          </div>
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
// AutomatizacionesView — ahora Schedules: tareas programadas
// ============================================================================

export interface ScheduledTask {
  id: string;
  name: string;          // nombre corto, ej: "Organizar correos"
  instruction: string;   // qué debe hacer el agente, ej: "organiza todos mis correos por carpeta"
  time: string;          // HH:MM (24h), ej: "09:00"
  recurrence: 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  weekday?: number;      // 0=Dom..6=Sáb (para weekly)
  monthDay?: number;     // 1..31 (para monthly)
  enabled: boolean;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'partial' | 'failed';
  lastRunMessage?: string;
  createdAt: number;
}

const SCHEDULES_KEY = 'weaver:schedules';

function loadSchedules(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSchedules(tasks: ScheduledTask[]) {
  try {
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

const RECURRENCE_LABELS: Record<ScheduledTask['recurrence'], string> = {
  once: 'schedules.recurrence.once',
  daily: 'schedules.recurrence.daily',
  weekdays: 'schedules.recurrence.weekdays',
  weekly: 'schedules.recurrence.weekly',
  monthly: 'schedules.recurrence.monthly',
};

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
void WEEKDAY_LABELS; // (mantenido por compatibilidad externa; UI usa i18n)

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

function formatSchedule(t: ScheduledTask, tt: TFunc): string {
  const time = t.time;
  switch (t.recurrence) {
    case 'once':
      return `${tt('schedules.todayAt')} ${time}`;
    case 'daily':
      return `${tt('schedules.everyDayAt')} ${time}`;
    case 'weekdays':
      return `${tt('schedules.weekdaysAt')} ${time}`;
    case 'weekly':
      return `${tt('schedules.everyWeekAt')} ${tt(`schedules.weekdays.${t.weekday ?? 1}`)} ${tt('schedules.at')} ${time}`;
    case 'monthly':
      return `${tt('schedules.everyMonthDayAt')} ${t.monthDay ?? 1} ${tt('schedules.ofEveryMonthAt')} ${time}`;
    default:
      return time;
  }
}

function getNextRunLabel(t: ScheduledTask, tt: TFunc): string {
  if (!t.enabled) return tt('schedules.paused');
  const now = new Date();
  const [hh, mm] = t.time.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hh, mm, 0, 0);

  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;

  switch (t.recurrence) {
    case 'once': {
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      break;
    }
    case 'daily': {
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      break;
    }
    case 'weekdays': {
      // Avanzar días hasta llegar a L-V
      while (next.getTime() <= now.getTime() || next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
      void isWeekday;
      break;
    }
    case 'weekly': {
      const wd = t.weekday ?? 1;
      while (next.getTime() <= now.getTime() || next.getDay() !== wd) {
        next.setDate(next.getDate() + 1);
      }
      break;
    }
    case 'monthly': {
      const md = t.monthDay ?? 1;
      next.setDate(md);
      if (next.getTime() <= now.getTime()) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(md);
      }
      break;
    }
  }
  const diff = next.getTime() - now.getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${tt('schedules.nextIn')} ${days}d ${hours % 24}h`;
  if (hours > 0) return `${tt('schedules.nextIn')} ${hours}h`;
  const mins = Math.floor(diff / 60_000);
  return mins > 0 ? `${tt('schedules.nextIn')} ${mins}min` : tt('schedules.now');
}

export function AutomatizacionesView() {
  const tt = useT();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setTasks(loadSchedules());
  }, []);

  // Re-cargar cuando el scheduler marca una tarea como ejecutada.
  useEffect(() => {
    const handler = () => setTasks(loadSchedules());
    window.addEventListener('weaver:schedules-updated', handler);
    return () => window.removeEventListener('weaver:schedules-updated', handler);
  }, []);

  function persist(next: ScheduledTask[]) {
    setTasks(next);
    saveSchedules(next);
    window.dispatchEvent(new CustomEvent('weaver:schedules-updated'));
  }

  function createTask(t: ScheduledTask) {
    persist([t, ...tasks]);
    setShowForm(false);
    setEditing(null);
  }

  function updateTask(t: ScheduledTask) {
    persist(tasks.map((x) => (x.id === t.id ? t : x)));
    setEditing(null);
    setShowForm(false);
  }

  function deleteTask(id: string) {
    if (!confirm(tt('schedules.deleteConfirm'))) return;
    persist(tasks.filter((t) => t.id !== id));
  }

  function toggleEnabled(id: string) {
    persist(tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-medium">{tt('schedules.title')}</h1>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus size={14} className="mr-1" /> {tt('schedules.newTask')}
          </Button>
        </div>
        <p className="text-text-secondary text-sm mb-8">
          {tt('schedules.subtitle')}
          {' '}
          {tt('schedules.noteText').slice(0, 200)}…
        </p>

        {showForm && (
          <ScheduleForm
            initial={editing}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
            onSubmit={(t) => (editing ? updateTask(t) : createTask(t))}
          />
        )}

        {tasks.length === 0 ? (
          <div className="text-sm text-text-muted p-8 border border-dashed border-border rounded-codex text-center">
            {tt('schedules.empty')}
            <br />
            <span className="text-xs">
              {tt('schedules.emptyHint')}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="codex-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{t.name}</span>
                      <Badge color={t.enabled ? 'success' : 'default'}>
                        {t.enabled ? tt('schedules.active') : tt('schedules.paused')}
                      </Badge>
                      {t.lastRunStatus && (
                        <Badge
                          color={
                            t.lastRunStatus === 'success'
                              ? 'success'
                              : t.lastRunStatus === 'partial'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          Última: {t.lastRunStatus}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      <Clock size={10} className="inline mr-1 -mt-0.5" />
                      {formatSchedule(t, tt)} · <span title="próxima ejecución">{getNextRunLabel(t, tt)}</span>
                    </div>
                    <div className="text-xs text-text-secondary mt-1.5 line-clamp-2">
                      <span className="text-text-muted">{tt('schedules.instruction')}:</span>{' '}
                      <code className="text-[11px] bg-app-elevated px-1 rounded">{t.instruction}</code>
                    </div>
                    {t.lastRunMessage && (
                      <div className="text-[11px] text-text-muted mt-1 italic truncate">
                        {t.lastRunMessage}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleEnabled(t.id)}
                      className="codex-icon-btn w-7 h-7"
                      title={t.enabled ? tt('schedules.pause') : tt('schedules.activate')}
                    >
                      <Power size={12} className={t.enabled ? 'text-success' : 'text-text-muted'} />
                    </button>
                    <button
                      onClick={() => {
                        setEditing(t);
                        setShowForm(true);
                      }}
                      className="codex-icon-btn w-7 h-7"
                      title={tt('schedules.edit')}
                    >
                      <SettingsIcon size={12} />
                    </button>
                    <button
                      onClick={() => deleteTask(t.id)}
                      className="codex-icon-btn w-7 h-7"
                      title={tt('schedules.delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 p-3 rounded-codex bg-app-elevated text-xs text-text-secondary leading-relaxed">
          <Shield size={12} className="inline mr-1 -mt-0.5" />
          <strong>{tt('schedules.note')}:</strong> {tt('schedules.noteText')}
        </div>
      </div>
    </div>
  );
}

function ScheduleForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: ScheduledTask | null;
  onCancel: () => void;
  onSubmit: (t: ScheduledTask) => void;
}) {
  const tt = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');
  const [time, setTime] = useState(initial?.time ?? '09:00');
  const [recurrence, setRecurrence] = useState<ScheduledTask['recurrence']>(initial?.recurrence ?? 'daily');
  const [weekday, setWeekday] = useState(initial?.weekday ?? 1);
  const [monthDay, setMonthDay] = useState(initial?.monthDay ?? 1);

  function submit() {
    if (!name.trim() || !instruction.trim()) return;
    const t: ScheduledTask = {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      instruction: instruction.trim(),
      time,
      recurrence,
      weekday: recurrence === 'weekly' ? weekday : undefined,
      monthDay: recurrence === 'monthly' ? monthDay : undefined,
      enabled: initial?.enabled ?? true,
      lastRunAt: initial?.lastRunAt,
      lastRunStatus: initial?.lastRunStatus,
      lastRunMessage: initial?.lastRunMessage,
      createdAt: initial?.createdAt ?? Date.now(),
    };
    onSubmit(t);
  }

  return (
    <div className="codex-card p-4 mb-4 space-y-3">
      <div className="text-sm font-medium">{initial ? tt('schedules.form.edit') : tt('schedules.form.new')}</div>
      <div>
        <label className="text-xs text-text-muted block mb-1">{tt('schedules.form.name')}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tt('schedules.form.namePlaceholder')}
          className="codex-input w-full px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">
          {tt('schedules.form.instruction')}
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={tt('schedules.form.instructionPlaceholder')}
          className="codex-input w-full px-2 py-1.5 text-sm h-20 resize-y"
        />
        <p className="text-[11px] text-text-muted mt-1">
          {tt('schedules.form.instructionHint')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-muted block mb-1">{tt('schedules.form.time')}</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="codex-input w-full px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-1">{tt('schedules.form.recurrence')}</label>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as ScheduledTask['recurrence'])}
            className="codex-input w-full px-2 py-1.5 text-sm"
          >
            {Object.entries(RECURRENCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {tt(v)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {recurrence === 'weekly' && (
        <div>
          <label className="text-xs text-text-muted block mb-1">{tt('schedules.form.weekday')}</label>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <button
                key={i}
                onClick={() => setWeekday(i)}
                className={cn(
                  'codex-btn !px-2 !py-1 text-xs',
                  weekday === i && 'codex-btn-primary',
                )}
              >
                {tt(`schedules.weekdays.${i}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {recurrence === 'monthly' && (
        <div>
          <label className="text-xs text-text-muted block mb-1">{tt('schedules.form.monthDay')}</label>
          <input
            type="number"
            min={1}
            max={31}
            value={monthDay}
            onChange={(e) => setMonthDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
            className="codex-input w-24 px-2 py-1.5 text-sm"
          />
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel}>{tt('schedules.form.cancel')}</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!name.trim() || !instruction.trim()}
        >
          {initial ? tt('schedules.form.save') : tt('schedules.form.create')}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// ConfiguracionView
// ============================================================================

export function ConfiguracionView() {
  const tt = useT();
  const [lang, setLang] = useLang();
  const { themeId, setTheme, appMode, setAppMode } = useWeaver();
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
          <h1 className="text-3xl font-medium mb-2">{tt('config.title')}</h1>
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

        {/* Idioma */}
        <SettingCard
          title={tt('config.language')}
          desc={tt('config.language.hint')}
        >
          <div className="flex gap-2">
            {(['es', 'en'] as const).map((lng) => (
              <button
                key={lng}
                onClick={() => setLang(lng)}
                className={`text-left px-3 py-2 rounded-codex border transition-colors flex-1 ${
                  lang === lng
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-border hover:border-border-accent text-text-secondary'
                }`}
              >
                <div className="text-sm font-medium">{tt(`config.language.${lng}`)}</div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {lng === 'es' ? 'Español (por defecto)' : 'English'}
                </div>
              </button>
            ))}
          </div>
        </SettingCard>

        {/* Tema */}
        <SettingCard
          title={tt('config.theme')}
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

        {/* Modo de interfaz */}
        <SettingCard
          title="Modo de interfaz"
          desc="Cambia la apariencia completa de Weaver. Normal = chat clásico. IDE = editor de archivos + agente lateral."
        >
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAppMode('normal')}
              className={`text-left p-3 rounded-codex border transition-colors ${
                appMode === 'normal'
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-border-accent'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare size={14} className={appMode === 'normal' ? 'text-accent' : 'text-text-muted'} />
                <span className="text-sm font-medium">Normal</span>
                {appMode === 'normal' && (
                  <span className="ml-auto text-[9px] uppercase tracking-wider text-accent">Activo</span>
                )}
              </div>
              <div className="text-[10px] text-text-muted">
                Chat con sidebar de conversaciones y proyectos. Todo lo que llevas actualmente.
              </div>
            </button>

            <button
              onClick={() => setAppMode('ide')}
              className={`text-left p-3 rounded-codex border transition-colors ${
                appMode === 'ide'
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-border-accent'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Code2 size={14} className={appMode === 'ide' ? 'text-accent' : 'text-text-muted'} />
                <span className="text-sm font-medium">IDE</span>
                {appMode === 'ide' && (
                  <span className="ml-auto text-[9px] uppercase tracking-wider text-accent">Activo</span>
                )}
              </div>
              <div className="text-[10px] text-text-muted">
                Estilo VSCode/OpenCode: explorador de archivos, editor con tabs, agente a la derecha y cambios del agente abajo.
              </div>
            </button>
          </div>

          {appMode === 'ide' && (
            <div className="mt-3 p-2.5 rounded-codex bg-accent/5 border border-accent/20 text-[11px] text-text-secondary">
              <div className="font-medium text-accent mb-1">Modo IDE activado</div>
              Al volver al chat (vista Chat), verás el editor. Los accesos MCP, Schedules, Me y Configuración siguen disponibles en el ActivityBar izquierdo. Cambia entre modos en cualquier momento desde aquí.
            </div>
          )}
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
          <div className="flex gap-2">
            <Button
              variant="danger"
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
            >
              <Trash2 size={12} /> Borrar memoria
            </Button>
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
