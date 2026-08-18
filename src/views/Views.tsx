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
  Cloud,
  RefreshCw,
  Database,
  Eye,
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
import {
  getSupabaseToken,
  setSupabaseToken,
  clearSupabaseToken,
  listSupabaseProjects,
  listOrganizations,
  createSupabaseProject,
  verifyToken,
  linkLocalToSupabase,
  type SupabaseProject,
  type SupabaseOrganization,
} from '@/lib/supabaseSync';
import {
  getVisionPrefs,
  setVisionPrefs,
  type VisionPrefs,
} from '@/agent/vision';

// ============================================================================
// ComplementosView — tabs: Skills / MCP Servers / Integraciones nativas
// Estado de formularios aislado (skillUrl/skillName vs mcpName/mcpPkg)
// ============================================================================

type ComplementosTab = 'skills' | 'mcp' | 'nativas';

export function ComplementosView() {
  const [tab, setTab] = useState<ComplementosTab>('mcp');
  const [servers, setServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  // Skills form (aislado)
  const [skillUrl, setSkillUrl] = useState('');
  const [skillName, setSkillName] = useState('');

  // MCP custom form (aislado)
  const [mcpName, setMcpName] = useState('');
  const [mcpPkg, setMcpPkg] = useState('');

  useEffect(() => {
    setServers(mcpClient.listServers());
    skillsRegistry.loadAll().then(setSkills);
  }, []);

  function addServer() {
    if (!mcpName.trim()) return;
    const server: McpServer = {
      id: crypto.randomUUID(),
      name: mcpName.trim(),
      transport: 'stdio',
      command: 'npx',
      args: ['-y', mcpPkg.trim() || mcpName.trim()],
      enabled: true,
      status: 'installed',
    };
    mcpClient.saveServer(server);
    setServers(mcpClient.listServers());
    setMcpName('');
    setMcpPkg('');
  }

  async function installSkill() {
    if (!skillUrl.trim()) return;
    const result = await skillsInstaller.install(skillUrl.trim(), skillName.trim() || undefined);
    if (result.ok) {
      setSkillUrl('');
      setSkillName('');
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

  const tabs: { id: ComplementosTab; label: string; icon: React.ReactNode }[] = [
    { id: 'mcp', label: 'MCP Servers', icon: <Sparkles size={14} /> },
    { id: 'skills', label: 'Skills', icon: <Puzzle size={14} /> },
    { id: 'nativas', label: 'Integraciones nativas', icon: <span className="text-sm">⚡</span> },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-medium mb-2">Complementos</h1>
        <p className="text-text-secondary text-sm mb-6">
          Haz que Weaver se adapte a tu estilo. Conecta servidores MCP, instala skills de{' '}
          <code className="text-accent">skills.sh</code> e integraciones nativas.
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 p-1 rounded-codex bg-app-elevated border border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-codex transition-colors',
                tab === t.id
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-app-input/50',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Skills ── */}
        {tab === 'skills' && (
          <div className="space-y-6">
            <div className="codex-card p-4 bg-gradient-to-br from-accent/10 to-transparent">
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

            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Puzzle size={14} /> Instalar skill desde URL
              </h2>
              <div className="flex gap-2">
                <input
                  value={skillUrl}
                  onChange={(e) => setSkillUrl(e.target.value)}
                  placeholder="https://github.com/vercel-labs/skills"
                  className="codex-input flex-1 px-3 py-2 text-sm"
                />
                <input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="nombre (opcional)"
                  className="codex-input w-44 px-3 py-2 text-sm"
                />
                <Button variant="primary" onClick={installSkill}>
                  Instalar
                </Button>
              </div>
              <p className="text-xs text-text-muted mt-1">
                Equivale a: <code>npx skills add <url> --skill <name></code>
              </p>
            </section>

            <section>
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
          </div>
        )}

        {/* ── MCP ── */}
        {tab === 'mcp' && (
          <div className="space-y-8">
            <McpSection servers={servers} setServers={setServers} />

            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Plus size={14} /> Añadir servidor MCP personalizado
              </h2>
              <div className="flex gap-2 mb-3">
                <input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="nombre del servidor"
                  className="codex-input flex-1 px-3 py-2 text-sm"
                />
                <input
                  value={mcpPkg}
                  onChange={(e) => setMcpPkg(e.target.value)}
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
        )}

        {/* ── Nativas ── */}
        {tab === 'nativas' && <NativeIntegrationsSection />}
      </div>
    </div>
  );
}

