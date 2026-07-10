# Weaver — Progreso

> Documento vivo. Cada sesión añade una nueva entrada al final.
> Estado global: **[MVP Linux funcional · Multimodal + SQLite + Proyectos + Popup Codex]**

## Convención de estados

- `[ ]` Pendiente
- `[~]` En progreso
- `[x]` Hecho
- `[!]` Bloqueado

---

## Sesión 1 — Fundación y MVP Linux (PR #1)

**Objetivo:** clonar repo, instalar toolchain, planificar, montar estructura base y dejar esqueletos compilables.

### Tareas

- [x] Clonar `github.com/andreslpxz/Weaver.git`
- [x] Instalar Rust toolchain (`rustc 1.97.0`)
- [x] Verificar librerías Linux: `libatspi2.0-0t64`, `libatk-bridge2.0-0t64`, `libgtk-3-0t64`
- [x] Analizar imágenes de referencia visual (Codex/Claude dark theme) con VLM
- [x] Escribir `PLAN.md`, `ARCHITECTURE.md`, `PROGRESS.md`
- [x] Scaffold Tauri v2 + React + TS + Vite
- [x] Declarar dependencias Rust (tauri 2, zbus 4, keyring 3, rusqlite, tokio, x11rb)
- [x] Declarar dependencias TS (react 18, tailwind, zustand, react-markdown, lucide-react)
- [x] Módulo Rust `atspi/`: cliente D-Bus AT-SPI2 con `query_tree`, `click`, `type_text`, `press_key`, `get_text`, `get_extents`, `focus`, `get_focused_subtree`
- [x] Módulo Rust `automation/`: keyboard (wtype/xdotool), mouse, clipboard (wl-clipboard/xclip), windows (wmctrl)
- [x] Módulo Rust `keyring/`: API keys vía libsecret
- [x] 20 comandos Tauri IPC registrados
- [x] Frontend: 22 proveedores IA en 4 familias de adaptadores (OpenAI-compat, Anthropic, Gemini, Ollama)
- [x] Model picker popup con gestión de API keys
- [x] Bucle agéntico: planner + executor + critic + reflection + memory
- [x] Encadenamiento automático >8,192 tokens (`<<CONTINUE>>`/`<<END>>`)
- [x] UI Codex-style: sidebar, composer, chat con markdown+code, 4 vistas
- [x] Skills.sh installer + parser SKILL.md + esqueleto MCP
- [x] TypeScript sin errores, Vite build OK, Rust core compila

---

## Sesión 2 — Browser fallback + Drag-and-drop (PR #2)

### Tareas

- [x] Fix bug `Cannot read properties of undefined (reading 'invoke')` cuando se ejecuta en navegador plano
- [x] `lib/tauri.ts` detecta `window.__TAURI_INTERNALS__` y proporciona fallbacks:
  - keyring → localStorage (prefijo `weaver:key:`)
  - clipboard → `navigator.clipboard` API
  - atspi/automation → error claro pidiendo ejecutar en Tauri
- [x] Sistema de adjuntos: `lib/attachments.ts` con `fileToAttachment()`, `buildMessageWithAttachments()`, `getFilesFromDrop()`, `formatSize()`
- [x] Detección de tipo: texto / imagen / binario por extensión + MIME
- [x] Lectura de texto inline (200KB límite, 50k chars truncado)
- [x] Imágenes: data URL base64 + thumbnail 64px
- [x] `AttachmentChips` con thumbnail, nombre, badge truncado, botón quitar
- [x] Drag-and-drop overlay en el composer
- [x] Botón `+` funcional (file picker nativo multi-selección)
- [x] Paste de imágenes con Ctrl+V
- [x] `draftAttachments[]` en el store Zustand
- [x] Badge de modo runtime (Tauri/Navegador) en el composer

---

## Sesión 3 — Temas, memoria importada, tools avanzadas (PR #3)

### Tareas

- [x] **Fix bug `<<CONTINUE>>` leak**: `streamChat()` ahora bufferiza marcadores parciales y los descarta antes de llegar al UI
- [x] **Fix adjuntos como code block gigante**: `buildMessageWithAttachments()` devuelve `{toLLM, toUI}` — el UI muestra solo resumen, el LLM recibe contenido completo
- [x] **Sistema de temas** (6 paletas) con CSS variables dinámicas:
  - Sage Dark (default), Pure Black OLED, Soft Gray (claro), Midnight Blue, Warm Paper, Cobalt
  - Aplicación instantánea vía `data-theme` attr
- [x] **Importar memoria de otras IAs** (ChatGPT/Claude/Gemini/Grok):
  - Prompt canónico con 5 categorías (demográfica, intereses, relaciones, eventos, instrucciones)
  - Parser detecta `Importado de: <name>` al final
  - Categoriza bullets y guarda como facts con key `imported:<source>:<category>:<n>`
- [x] **Tools avanzadas estilo Codex**:
  - `shell_exec` (bash con timeout)
  - `file_read` / `file_write` / `file_list`
  - `web_search` (Tavily API)
  - `web_fetch` (descarga URL, strip HTML)
  - Detección automática de intención ("busca en internet X", "lee /etc/hosts")
  - ReAct loop con tools en navegador y Tauri
- [x] **Tavily API key** en Configuración con link a tavily.com
- [x] **Botones de mensaje**: copy + regenerate (hover reveal)
- [x] **Icono cerebro** arriba de mensajes: expande razonamiento en gris semi-transparente
- [x] **Indicador "pensando…"** con spinner
- [x] **Referencias de adjuntos** en burbuja de usuario con icono/nombre/tamaño

---

## Sesión 4 — Multimodal real, SQLite, Bedrock/VertexAI, Proyectos (PR #4)

### Tareas

#### Backend Rust
- [x] `src-tauri/src/db/mod.rs`: SQLite en `~/.weaver/memory.db` con 7 tablas:
  - `episodes`, `facts`, `projects`, `conversations`, `conversation_messages`, `skills`
- [x] 24 comandos Tauri para CRUD completo de todas las entidades
- [x] `src-tauri/src/tools/mod.rs`: `shell_exec`, `file_read`, `file_write`, `file_list` con expansión de `~/`
- [x] `lib.rs` registra `DbState` + 28 comandos nuevos

#### Multimodal real
- [x] `Message.images?: ImageContent[]` (dataUrl + mime + name)
- [x] Adapter **OpenAI-compat**: `content` array con `image_url`
- [x] Adapter **Anthropic**: `source.base64` con `media_type`
- [x] Adapter **Gemini**: `inline_data` con `mime_type` + `data`
- [x] Composer extrae imágenes de attachments y las pasa al Message

#### Persistencia SQLite (con fallback localStorage)
- [x] `agent/memory.ts`: async, SQLite-backed en Tauri
- [x] `skills/registry.ts`: async, SQLite-backed
- [x] `store/weaver.ts`: projects CRUD con SQLite
- [x] `lib/tauri.ts`: `sqlite.*` con 24 wrappers tipados

#### Adapters Bedrock y VertexAI
- [x] `bedrock.ts`: proxy URL para navegador, SigV4 nativo pendiente en Tauri
- [x] `vertexai.ts`: OAuth2 Bearer token, soporta Gemini + Claude en Vertex

#### Sistema de Proyectos
- [x] Sidebar reescrito: sección Proyectos con crear/expandir/colapsar/eliminar
- [x] Conversaciones agrupadas: "Sin proyecto" + secciones por proyecto
- [x] Menú (...) en cada conversación para moverla a un proyecto
- [x] Contador de conversaciones por proyecto

#### Composer (versión inicial)
- [x] Eliminado: engranaje ⚙️ junto al model picker
- [x] Eliminado: "Seleccionar archivo" y badge "Navegador" del top row
- [x] Botón `+` con popup (Subir archivo / carpeta / URL)
- [x] Menú `@` con skills, proveedores, archivos recientes, comandos

---

## Sesión 5 — Popup + estilo Codex con toggles + mover + abajo (PR #5)

### Tareas

- [x] **Botón `+` movido al bottom row**, al lado del model picker (antes estaba arriba solo)
- [x] **Top row eliminado** completamente (ya no hay + ni "Seleccionar archivo" ni badge Navegador arriba)
- [x] **Popup `+` reescrito estilo Codex/Claude** (según screenshots del usuario):
  - 📎 Agregar fotos y archivos
  - 📁 Subir carpeta (webkitdirectory, recursivo)
  - 🔗 Añadir desde URL
  - 🖥️ Adjuntar app (AT-SPI, Tauri)
  - 🗺️ **Modo plan** (toggle switch) — proponer plan y esperar confirmación
  - 🎯 **Perseguir objetivo** (toggle switch) — iterar hasta completar
  - 🧩 Complementos (navega a vista)
- [x] **ToggleSwitch** component estilo iOS/Codex (pill con knob blanco)
- [x] **Modos del agente** (`planMode`, `pursueObjective`) en el store:
  - `planMode`: precede el prompt con instrucción de proponer plan y esperar confirmación
  - `pursueObjective`: precede el prompt con instrucción de iterar hasta completar (máx 3 intentos por subtarea)
  - `pursueObjective` ON por defecto, `planMode` OFF por defecto
  - Chips visuales en el composer cuando los modos están ON
- [x] **Menú `@` mejorado**: añadida sección Proyectos (`@project:nombre`)
- [x] Añadido comando rápido "Modo plan" al menú `@`

---

## Estado actual por módulo

### Backend Rust (src-tauri/)
- [x] `atspi/` — Cliente AT-SPI2 sobre D-Bus (zbus puro)
  - `list_applications()`, `query_tree()` recursivo, `get_focused_subtree()`
  - `click`, `double_click`, `type_text`, `press_key`, `get_text`, `get_extents`, `focus`
- [x] `automation/` — Teclado (wtype/xdotool), ratón, clipboard (wl-clipboard/xclip), ventanas (wmctrl)
- [x] `keyring/` — API keys vía libsecret (Linux), Keychain (macOS), Credential Manager (Windows)
- [x] `db/` — SQLite con 7 tablas + 24 comandos CRUD
- [x] `tools/` — shell_exec + file ops con expansión de `~/`
- [x] `commands.rs` — 20 comandos AT-SPI/automation/keyring
- [x] `lib.rs` — registra 52 comandos Tauri en total

### Frontend TypeScript (src/)
- [x] `providers/` — 22 proveedores en 6 familias:
  - OpenAI-compat (15), Anthropic, Google Gemini, Ollama (2), VertexAI, Bedrock
- [x] `providers/adapters/` — 6 adapters con multimodal real:
  - openai-compat, anthropic, gemini, ollama, bedrock, vertexai
- [x] `agent/` — Bucle agéntico completo:
  - `planner.ts` (HTN-lite), `executor.ts` (ReAct, 11 tools), `critic.ts`, `reflection.ts`, `memory.ts`, `loop.ts`
- [x] `lib/` — Utilidades:
  - `tauri.ts` (wrappers con fallback navegador), `chain.ts` (encadenamiento), `attachments.ts`, `themes.ts` (6 temas), `tools.ts` (shell/web/fs), `memory-import.ts`
- [x] `components/` — UI Codex-style:
  - `sidebar/` (con proyectos), `composer/` (popup + estilo Codex, menú @), `chat/` (copy/regenerate/brain), `model-picker/`, `common/`
- [x] `views/` — 4 vistas: Complementos, Habilidades, Automatizaciones, Configuración
- [x] `store/weaver.ts` — Zustand con conversaciones, proyectos, temas, modos, attachments
- [x] `skills/` — Parser SKILL.md + installer (`npx skills add`)
- [x] `mcp/` — Esqueleto MCP client

### Documentación
- [x] `PLAN.md` — Visión, 7 fases, MVP, riesgos
- [x] `ARCHITECTURE.md` — Capas, flujo agéntico, 22 proveedores, paleta, decisiones técnicas
- [x] `PROGRESS.md` — Este archivo
- [x] `README.md` — Instalación y uso

---

## Estadísticas

- **Líneas de código**: ~5,500 TS/TSX + ~1,500 Rust = ~7,000 LOC
- **Archivos fuente**: 35+ archivos
- **Proveedores IA**: 22 (de 6 familias)
- **Comandos Tauri**: 52
- **Tablas SQLite**: 7
- **Temas**: 6
- **PRs merged**: 4 (#1, #2, #3, #4)
- **PR actual**: #5 (popup Codex + toggles)

---

## Roadmap

| Fase | Estado | PR |
|------|--------|-----|
| 1 — Fundación | [x] Hecha | #1 |
| 2 — Núcleo Linux (AT-SPI + automation) | [x] Hecho | #1 |
| 3 — Proveedores IA (22) | [x] 22/22 | #1, #4 |
| 4 — UI Codex-style | [x] Hecho | #1, #3, #5 |
| 5 — Bucle agéntico | [x] Completo | #1 |
| 6 — MCP + skills.sh | [~] Esqueleto, runtime real TBD | #1 |
| 7 — Pulido Linux + empaquetado | [ ] Pendiente | — |

### Pendiente para próximas iteraciones

- [ ] **Adjuntar app** real: picker AT-SPI que liste ventanas abiertas (estilo Codex "Adjuntar Google Chrome")
- [ ] Persistir conversaciones completas a SQLite al cambiar entre ellas (ahora solo al crearse)
- [ ] Comando Tauri `bedrock_invoke` con SigV4 nativo
- [ ] MCP runtime real (lanzar subprocesos stdio JSON-RPC)
- [ ] Soporte Wayland vía `xdg-desktop-portal`
- [ ] Empaquetado `.deb`, `.AppImage`, `.rpm` y CI
- [ ] Soporte multimodal en Bedrock y VertexAI adapters
- [ ] Skills auto-aprendidas: persistir a `~/.weaver/skills/learned/` tras reflexión exitosa
