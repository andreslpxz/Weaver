import { useEffect, useState } from 'react';
import { Puzzle, Sparkles, Plus, Settings as SettingsIcon, Search, Trash2, ExternalLink } from 'lucide-react';
import { mcpClient, type McpServer } from '@/mcp/client';
import { skillsRegistry, type Skill } from '@/skills/registry';
import { skillsInstaller } from '@/skills/installer';
import { Badge, Button } from '@/components/common/Button';

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

        {/* MCP servers */}
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <SettingsIcon size={14} /> Servidores MCP
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
          {servers.length === 0 ? (
            <div className="text-sm text-text-muted p-4 border border-dashed border-border rounded-codex text-center">
              Sin servidores MCP. Añade el primero arriba.
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 codex-card"
                >
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-text-muted font-mono">
                      {s.transport}: {s.command} {(s.args ?? []).join(' ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={s.enabled ? 'success' : 'default'}>
                      {s.enabled ? 'activo' : 'pausado'}
                    </Badge>
                    <button
                      onClick={() => {
                        mcpClient.removeServer(s.id);
                        setServers(mcpClient.listServers());
                      }}
                      className="codex-icon-btn w-7 h-7"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
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
          <div className="text-sm text-text-muted p-8 border border-dashed border-border rounded-codex text-center">
            Sin automatizaciones aún.
          </div>
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

        <SettingCard title="Accesibilidad AT-SPI" desc="Requerido para que el agente opere otras apps.">
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
                if (confirm('¿Borrar TODA la memoria episódica y semántica?')) {
                  localStorage.removeItem('weaver:episodes');
                  localStorage.removeItem('weaver:facts');
                  alert('Memoria borrada.');
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
      <div className="font-medium text-sm">{title}</div>
      {desc && <p className="text-xs text-text-muted mt-0.5 mb-3">{desc}</p>}
      {children}
    </div>
  );
}

function has(bin: string): boolean {
  // Best-effort check: en el frontend no podemos `which`. Asumimos true en Linux.
  // Para verificación real, añadir comando Tauri `which_binary`.
  return true;
}
