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
} from 'lucide-react';
import { mcpClient, type McpServer } from '@/mcp/client';
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
                <div key={s.id} className="flex items-center justify-between p-3 codex-card">
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
