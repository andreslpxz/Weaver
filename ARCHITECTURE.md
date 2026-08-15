# Weaver — Arquitectura

## 1. Visión general

```
┌─────────────────────────────────────────────────────────────────┐
│                       Weaver (Tauri v2)                         │
│                                                                 │
│  ┌───────────────────────────────┐  ┌────────────────────────┐ │
│  │     Frontend (WebView)        │  │   Backend (Rust)       │ │
│  │     React + TS + Vite         │  │   Tokio + Tauri        │ │
│  │                               │  │                        │ │
│  │  ┌─────────┐  ┌────────────┐  │  │  ┌──────────────────┐  │ │
│  │  │ Sidebar │  │  Composer  │  │  │  │  atspi module    │  │ │
│  │  └─────────┘  └────────────┘  │  │  │  (D-Bus client)  │  │ │
│  │  ┌─────────────────────────┐  │  │  └──────────────────┘  │ │
│  │  │   Chat / Agent views    │  │  │  ┌──────────────────┐  │ │
│  │  └─────────────────────────┘  │  │  │  automation      │  │ │
│  │  ┌─────────────────────────┐  │  │  │  (X11/wayland)   │  │ │
│  │  │   Model picker popup    │  │  │  └──────────────────┘  │ │
│  │  └─────────────────────────┘  │  │  ┌──────────────────┐  │ │
│  │                               │  │  │  keyring store   │  │ │
│  │  Agent loop (TS)              │◄─┼──┤  (API keys)      │  │ │
│  │  planner/memory/executor/     │  │  └──────────────────┘  │ │
│  │  critic/reflection            │  │  ┌──────────────────┐  │ │
│  │                               │  │  │  IPC commands    │  │ │
│  │  providers/ (22 adapters)     │  │  │  #[tauri::cmd]   │  │ │
│  │  mcp/ + skills/               │  │  └──────────────────┘  │ │
│  └───────────────────────────────┘  └────────────────────────┘ │
│                                                                 │
│  Persistencia:                                                  │
│    - SQLite (episodios, hechos, skills)                         │
│    - Filesystem (~/.weaver/skills/*.md, ~/.weaver/config.json)  │
│    - OS keychain (API keys)                                     │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Capas

### 2.1 Frontend (TypeScript)

**Responsable de:**
- Renderizar la UI (Codex-style).
- Mantener el estado de la conversación y de la UI.
- Orquestar el bucle agéntico (llama al LLM vía `providers/`).
- Llamar al backend Rust vía `invoke('command_name', args)` para acciones del OS.

**Estructura de carpetas propuesta:**

```
src/
├── app/                    # Bootstrap, providers de contexto
├── components/
│   ├── sidebar/            # Sidebar, secciones (NuevoChat, Proyectos, ...)
│   ├── chat/               # Mensajes, markdown renderer, code blocks
│   ├── composer/           # Input box + model picker + send button
│   ├── model-picker/       # Popup de selección de modelo + API key
│   └── common/             # Botones, íconos, diálogos
├── views/
│   ├── ChatView.tsx
│   ├── ComplementosView.tsx
│   ├── HabilidadesView.tsx
│   ├── ConfiguracionView.tsx
│   └── AutomatizacionesView.tsx
├── agent/
│   ├── planner.ts
│   ├── memory.ts
│   ├── executor.ts
│   ├── critic.ts
│   ├── reflection.ts
│   ├── search-tree.ts
│   └── types.ts
├── providers/
│   ├── registry.ts         # Lista de 22 proveedores
│   ├── adapters/           # Implementaciones por familia
│   ├── store.ts            # Wrapper sobre IPC keyring
│   └── types.ts
├── mcp/
│   └── client.ts
├── skills/
│   ├── registry.ts         # Parsea SKILL.md
│   └── installer.ts        # npx skills add
├── lib/
│   ├── tauri.ts            # Wrappers tipados sobre invoke()
│   ├── stream.ts           # utilidades para streaming de LLM
│   └── chain.ts            # Encadenamiento >8k tokens
└── styles/
    └── tokens.css          # Variables CSS (paleta Codex-like)
```

### 2.2 Backend (Rust)

**Responsable de:**
- Exponer comandos IPC al frontend.
- Hablar con AT-SPI2 (D-Bus) para leer/manipular el árbol de accesibilidad.
- Emular teclado/ratón y manejar portapapeles.
- Almacenar API keys en el llavero del OS.

**Estructura:**

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
└── src/
    ├── main.rs
    ├── lib.rs
    ├── atspi/
    │   ├── mod.rs
    │   ├── client.rs        # Conexión D-Bus → org.a11y.atspi.Registry
    │   ├── tree.rs          # query_tree, navegación jerárquica
    │   ├── actions.rs       # click, type, press_key, scroll
    │   └── types.rs         # Node, Role, State, Rect
    ├── automation/
    │   ├── mod.rs
    │   ├── keyboard.rs      # X11 keysym + Wayland fallback
    │   ├── mouse.rs         # moveto, click, drag, scroll
    │   ├── clipboard.rs     # wl-copy / xclip
    │   └── windows.rs       # _NET_ACTIVE_WINDOW, list_windows
    ├── keyring/
    │   └── mod.rs           # get/set/delete API key por proveedor
    └── commands.rs          # #[tauri::command]s expuestos al frontend
```

### 2.3 Persistencia

| Tipo | Tecnología | Ubicación |
|------|-----------|-----------|
| Episodios (tarea → pasos → resultado) | SQLite (sqlx o rusqlite) | `~/.weaver/memory.db` |
| Hechos semánticos | SQLite tabla `facts` | `~/.weaver/memory.db` |
| Skills aprendidas | Markdown con frontmatter | `~/.weaver/skills/learned/*.md` |
| Skills importadas (skills.sh) | Markdown | `~/.weaver/skills/installed/*.md` |
| Config global (proveedor por defecto, tema) | JSON | `~/.weaver/config.json` |
| API keys | OS keychain (libsecret) | vía crate `keyring` |
| Logs | Archivo rotativo | `~/.weaver/logs/weaver.log` |

## 3. Flujo agéntico

```
Usuario escribe objetivo
        │
        ▼
┌──────────────────┐
│  Planner         │  LLM call #1: "Descompón este objetivo en subtareas verificables"
│  (HTN-lite)      │  → JSON: [{ id, description, success_criteria, depends_on }]
└──────────────────┘
        │
        ▼
Para cada subtarea (respetando dependencias):
        │
        ▼
┌──────────────────┐    contexto: subtarea + árbol AT-SPI actual + hechos relevantes
│  Executor        │  LLM call #2: "¿Qué tool call hago ahora?"
│  (ReAct loop)    │  → tool_call(name, args)
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Tool runtime    │  invoke('atspi_click', { path: [...] })
│  (Tauri IPC)     │  invoke('atspi_type', { path: [...], text: "..." })
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Critic          │  LLM call #3: "Dado el árbol AT-SPI después de la acción,
│                  │   ¿se cumplió el success_criteria?"
└──────────────────┘
   │           │
   │ Sí        │ No (≤ 3 intentos)
   ▼           ▼
 próximo    replanificar
 paso       (realimentar error al planner)
        │
        ▼ (al finalizar la tarea padre)
┌──────────────────┐
│  Reflection      │  LLM call #N: "Resume qué funcionó y qué no.
│                  │   Extrae una skill reutilizable si la tarea fue exitosa."
└──────────────────┘
        │
        ▼
   memory.db: nuevo episodio
   ~/.weaver/skills/learned/*.md: nueva skill (si aplica)
```

### 3.1 Encadenamiento de respuestas (>8,192 tokens)

Para evitar que el límite de output del LLM trunque respuestas largas (planes con muchas subtareas, código largo, reflexiones extensas):

1. Cada llamada al LLM incluye en el system prompt: *"Si tu respuesta se acerca al límite, termina con la línea `<<CONTINUE>>` y un resumen de 1 línea de lo que falta."*
2. El frontend detecta `<<CONTINUE>>` y reenvía con un mensaje usuario: *"Continúa desde: {última línea producida}. Mantén coherencia con el contexto previo."*
3. Esto se repite hasta que el LLM emita `<<END>>` o no haya más contenido.
4. El frontend concatena los fragmentos y los presenta al usuario como una sola respuesta.

## 4. Sistema de proveedores IA

### 4.1 Interfaz unificada

```typescript
interface LLMProvider {
  id: ProviderId;
  label: string;
  desc: string;
  requiresApiKey: boolean;
  docsUrl: string;
  listModels(): Promise<ModelInfo[]>;
  createChatStream(opts: {
    model: string;
    messages: Message[];
    tools?: Tool[];
    temperature?: number;
  }): AsyncIterable<StreamChunk>;
}
```

### 4.2 Familias de adaptadores

| Familia | Proveedores | Base URL / SDK |
|---------|------------|----------------|
| OpenAI-compat | openai, azure, together, cerebras, groq, nvidia, lightning, deepseek, openrouter, perplexity, mistral, ollama, huggingface | `POST /v1/chat/completions` (formato OpenAI) |
| Anthropic | anthropic, bedrock, vertexai | `POST /v1/messages` (formato Messages API) |
| Google | google (Gemini), vertexai | `POST /v1/models/{model}:streamGenerateContent` |
| Cohere | cohere | `POST /v2/chat` |
| xAI | grok | OpenAI-compat en `https://api.x.ai/v1` |
| Alibaba | qwen | OpenAI-compat en DashScope |
| Zhipu | glm | OpenAI-compat en `https://open.bigmodel.cn/api/paas/v4` |
| Meta | meta | Vía Together / Ollama (no API propia) |

### 4.3 Lista canónica (22 proveedores)

```ts
export const PROVIDERS = [
  { id: 'google',      label: 'Google Gemini',   desc: 'Gemini 1.5 Pro / Flash' },
  { id: 'cohere',      label: 'Cohere',          desc: 'Command R+, Command A (v2 API)' },
  { id: 'grok',        label: 'xAI (Grok)',      desc: 'Grok-1, Grok-2' },
  { id: 'perplexity',  label: 'Perplexity',      desc: 'Sonar models with search' },
  { id: 'together',    label: 'Together AI',     desc: 'Llama, Qwen, Mistral gateway' },
  { id: 'cerebras',    label: 'Cerebras',        desc: 'Fastest Llama-3 inference' },
  { id: 'qwen',        label: 'Qwen (Alibaba)',  desc: 'Qwen-2.5-72B, Qwen-VL' },
  { id: 'glm',         label: 'Zhipu (GLM)',     desc: 'GLM-4' },
  { id: 'groq',        label: 'Groq',            desc: 'Ultra-fast inference (LPU)' },
  { id: 'openai',      label: 'OpenAI',          desc: 'GPT-4o, o1, o3…' },
  { id: 'azure',       label: 'Azure OpenAI',    desc: 'GPT-4o, o1, o3 via Azure deployment' },
  { id: 'anthropic',   label: 'Anthropic',       desc: 'Claude Sonnet / Opus' },
  { id: 'openrouter',  label: 'OpenRouter',      desc: 'Multi-model gateway' },
  { id: 'lightning',   label: 'Lightning AI',    desc: 'OpenAI-compatible gateway' },
  { id: 'nvidia',      label: 'NVIDIA NIM',      desc: 'NVIDIA hosted models' },
  { id: 'deepseek',    label: 'DeepSeek',        desc: 'DeepSeek-V3 / R1' },
  { id: 'mistral',     label: 'Mistral AI',      desc: 'Mixtral, Mistral-Large' },
  { id: 'meta',        label: 'Meta (Llama)',    desc: 'Llama 3.x via API' },
  { id: 'vertexai',    label: 'Google Vertex AI',desc: 'Claude / Gemini / Llama via Vertex (Bearer token)' },
  { id: 'bedrock',     label: 'Amazon Bedrock',  desc: 'Claude / Llama / Titan via AWS Bedrock' },
  { id: 'ollama',      label: 'Ollama (local)',  desc: 'Local models, no API key' },
  { id: 'huggingface', label: 'HuggingFace',     desc: 'Download & run HF models via Ollama' },
] as const;
```

## 5. Sistema de skills

### 5.1 SKILL.md (formato canónico)

```markdown
---
name: write-prd
description: Escribe un PRD estructurado en Notion o Markdown
triggers:
  - "escribe un PRD"
  - "redacta requisitos"
tools_required:
  - file.write
  - mcp.notion
---

# Cómo escribir un PRD

1. Confirma el dominio del producto con el usuario.
2. Pregunta por la métrica de éxito principal.
3. Genera el PRD con estas secciones: contexto, objetivos, no-objectivos,
   usuarios, requisitos funcionales, requisitos no funcionales, métricas, riesgos.
4. Pide confirmación antes de publicar.
```

### 5.2 Instalación

Weaver envuelve `npx skills add <url> --skill <name>`:
- Descarga el `SKILL.md` al path temporal.
- Lo copia a `~/.weaver/skills/installed/<name>.md`.
- Lo registra en el índice `~/.weaver/skills/index.json`.
- Lo carga en el contexto del planner la próxima vez que un objetivo coincida con un `trigger`.

### 5.3 skills.sh

- `npx skills add https://github.com/vercel-labs/skills --skill find-skills` se ejecuta automáticamente la primera vez.
- Las skills del repo de vercel-labs (incluyendo `find-skills`) se cargan en el planner para que éste sepa descubrir más skills.

## 6. Seguridad

- Las API keys **nunca** se almacenan en texto plano: van al llavero del OS vía `keyring`.
- Las acciones destructivas del agente (borrar archivos, ejecutar `rm`, etc.) requieren confirmación explícita del usuario en la UI.
- El agente nunca envía archivos del usuario a un LLM sin pasar por el filtro de privacidad configurado.
- Las skills importadas son de solo lectura para el LLM; el agente no puede modificarlas sin permiso explícito.
- AT-SPI: Weaver pide al usuario habilitar la accesibilidad globalmente (gsettings `org.gnome.desktop.interface toolkit-accessibility true`) y avisa si no está activa.

## 7. Estética visual (paleta de referencia)

Basado en las capturas de Claude Desktop / Codex:

| Token CSS | Hex | Uso |
|-----------|-----|-----|
| `--bg-app` | `#0E0F0C` | Fondo principal |
| `--bg-sidebar` | `#171915` | Sidebar |
| `--bg-elevated` | `#1E211D` | Cards, input box |
| `--bg-input` | `#232722` | Composer |
| `--border` | `#2C302B` | Bordes sutiles |
| `--border-accent` | `#3A3F38` | Bordes hover |
| `--text-primary` | `#F4F4F0` | Texto principal |
| `--text-secondary` | `#9CA3A0` | Texto secundario |
| `--text-muted` | `#6B736E` | Texto terciario |
| `--accent` | `#8FB89B` | Verde sage (identidad Weaver) |
| `--accent-strong` | `#A8C9B8` | Hover accent |
| `--danger` | `#E07A5F` | Errores |
| `--warning` | `#E8B86A` | Advertencias |
| `--success` | `#7BAE7F` | Éxito |

Tipografía:
- Sans (UI): **Inter** (o system sans).
- Mono (código): **JetBrains Mono** o **Fira Code**.
- Tamaños: 12 / 13 / 14 / 16 / 18 / 24 / 32.

## 8. Decisiones técnicas clave

| Decisión | Alternativa | Razón |
|----------|------------|-------|
| Tauri v2 | Electron | Binario ~10MB vs ~150MB; usa WebKitGTK nativo en Linux |
| React + Vite | SvelteKit / Solid | Madurez, ecosistema shadcn/ui |
| AT-SPI por D-Bus (zbus) | atspi-rs (bindings C) | zbus es puro Rust, sin FFI frágil |
| SQLite (rusqlite) | sled / JSON | SQL familiar, tooling maduro |
| keyring crate | stronghold plugin | Simplicidad; stronghold añade dependencia pesada |
| TS para el agent loop | Rust | Iteración más rápida; el bucle es IO-bound (espera al LLM) |
| Encadenamiento por `<<CONTINUE>>` | Función tools | Simplicidad; funciona con cualquier LLM |
