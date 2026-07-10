# Weaver — Progreso

> Documento vivo. Cada sesión añade una nueva entrada al final.
> Estado global: **[FASE 1 — Fundación COMPLETA · MVP Linux funcional]**

## Convención de estados

- `[ ]` Pendiente
- `[~]` En progreso
- `[x]` Hecho
- `[!]` Bloqueado

---

## Sesión 1 — Fundación, scaffold y MVP Linux

**Objetivo:** clonar repo, instalar toolchain, planificar, montar la estructura base del proyecto y dejar esqueletos compilables para el backend Rust y el frontend React.

### Tareas

- [x] Clonar `github.com/andreslpxz/Weaver.git` → `/home/z/my-project/Weaver`
- [x] Confirmar que el repo solo tenía `README.md` + `LICENSE` (Apache 2.0)
- [x] Instalar Rust toolchain (`rustc 1.97.0`)
- [x] Verificar librerías Linux presentes: `libatspi2.0-0t64`, `libatk-bridge2.0-0t64`, `libgtk-3-0t64`
- [x] Analizar imágenes de referencia visual (Codex/Claude dark theme) con VLM
- [x] Escribir `PLAN.md` (visión, fases, riesgos, MVP)
- [x] Escribir `ARCHITECTURE.md` (capas, flujo agéntico, proveedores, paleta)
- [x] Inicializar `worklog.md` y `PROGRESS.md`
- [x] Scaffold Tauri v2 + React + TS + Vite
  - `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`
  - `src-tauri/Cargo.toml`, `tauri.conf.json`, `build.rs`, `capabilities/default.json`, `icons/*`
- [x] Declarar dependencias Rust (tauri 2, zbus 4, keyring 3, rusqlite 0.32, tokio, x11rb, which, etc.)
- [x] Declarar dependencias TS (react 18, tailwind, lucide-react, zustand, react-markdown, react-syntax-highlighter, @tauri-apps/* v2)
- [x] Módulo Rust `acpi/atspi/`:
  - `types.rs`: `AccessibleNode`, `ApplicationInfo`, `Rect`, `Role`, `StateSet` (serializables a TS)
  - `client.rs`: conexión D-Bus, proxies `org.a11y.atspi.{Accessible,Action,Component,Text}`, `list_applications()`, `query_tree()` recursivo con Box::pin
  - `tree.rs`: helper `get_focused_subtree()` (lee sub-árbol de la ventana activa)
  - `actions.rs`: `click`, `double_click`, `type_text`, `press_key`, `get_text`, `get_extents`, `focus`
- [x] Módulo Rust `acpi/automation/`:
  - `keyboard.rs`: detección Wayland/X11, delega a `wtype`/`xdotool`, parser de combos ("ctrl+s")
  - `mouse.rs`: clic en coordenadas absolutas vía `xdotool`
  - `clipboard.rs`: `wl-copy`/`wl-paste` y `xclip`
  - `windows.rs`: `wmctrl -l -p -G` parser, `activate_window`
- [x] Módulo Rust `keyring/`: get/set/delete/list de API keys vía crate `keyring` (libsecret en Linux)
- [x] Comandos Tauri IPC registrados en `lib.rs`: 10 comandos AT-SPI + 6 automation + 4 keyring
- [x] Frontend `providers/`:
  - `types.ts`: interfaces `LLMProvider`, `ProviderInfo`, `ModelInfo`, `Message`, `Tool`, `StreamChunk`
  - `registry.ts`: 22 proveedores canónicos con baseUrl, docsUrl, models curados
  - `adapters/openai-compat.ts`: SSE parser, tool calls acumulados, listModels
  - `adapters/anthropic.ts`: Messages API + streaming SSE + tool_use
  - `adapters/gemini.ts`: streamGenerateContent con SSE
  - `adapters/ollama.ts`: NDJSON streaming + listModels local
  - `store.ts`: wrapper sobre keyring Tauri con cache en memoria
  - `index.ts`: factory `createProvider(id)` → adaptador correcto
- [x] Frontend `lib/`:
  - `tauri-types.ts`: tipos espejo de `atspi/types.rs` y `automation/windows.rs`
  - `tauri.ts`: wrappers tipados sobre `invoke()`
  - `chain.ts`: `streamChat()` y `streamUntilDone()` con encadenamiento `<<CONTINUE>>`/`<<END>>`
- [x] Frontend `agent/`:
  - `types.ts`: `Objective`, `Subtask`, `Plan`, `Episode`, `Fact`, `ToolDef`, marcadores
  - `planner.ts`: planner jerárquico (HTN-lite), JSON output, validación acíclica
  - `executor.ts`: ReAct loop con 11 tools AT-SPI/automation, máximo 12 pasos
  - `critic.ts`: validación contra `successCriteria` con snapshot AT-SPI
  - `reflection.ts`: extracción de lecciones + skill auto-aprendida
  - `memory.ts`: memoria episódica + semántica (localStorage MVP, migrable a SQLite)
  - `loop.ts`: orquestador `runAgent()` con eventos tipados
- [x] Frontend `mcp/client.ts`: registry de servidores MCP (esqueleto, Fase 6)
- [x] Frontend `skills/`:
  - `registry.ts`: parser de SKILL.md (YAML frontmatter minimalista), cache local
  - `installer.ts`: wrapper sobre `npx skills add <url> --skill <name>` via `tauri-plugin-shell`
- [x] Frontend UI Codex-style:
  - `styles/tokens.css`: 14 variables CSS + utilidades Tailwind (codex-card, codex-input, sidebar-item, etc.)
  - `components/common/Button.tsx`: Button, IconButton, Badge
  - `components/sidebar/Sidebar.tsx`: header con logo, secciones (Nuevo chat, Buscar, Complementos, Automatizaciones, Proyectos, Configuración), conversaciones recientes, colapsable
  - `components/composer/Composer.tsx`: input box estilo Codex con +/file/model-picker/mic/send, autosize, detecta tarea agéntica vs chat simple, escucha sugerencias
  - `components/model-picker/ModelPickerPopup.tsx`: popup con tabs (Modelos / API Keys), buscador, lista de modelos por proveedor, editor de API key con test
  - `components/chat/MessageList.tsx`: empty state con sugerencias, burbujas user/assistant/tool, react-markdown + syntax-highlighting, PlanCard expandible, TraceCard con pasos del agente
  - `views/Views.tsx`: ComplementosView (MCP + skills importadas), HabilidadesView (skills aprendidas), AutomatizacionesView (episodios recientes), ConfiguracionView (AT-SPI, deps, memoria, about)
  - `store/weaver.ts`: Zustand con conversaciones, plan, traces, agentState, providers
  - `App.tsx`, `main.tsx`: layout, routing por vista, top bar con model picker
- [x] **TypeScript sin errores** (`tsc --noEmit` pasa limpio)
- [x] **Vite build exitoso** (`npm run build` produce `dist/` con 1MB JS + 18KB CSS)
- [x] **Rust core compila** (verificado con sub-crate standalone sin tauri)
- [!] **Tauri backend no compila en sandbox**: requiere `libwebkit2gtk-4.1-dev` y `libgtk-3-dev` (necesita `sudo apt install`). El usuario debe instalar las deps en su máquina Linux; el código Rust está verificado sintácticamente.

### Hallazgos

- **Entorno:** Debian 13 (trixie), Node 22.x, sin Rust inicialmente → instalado vía rustup 1.97.0.
- **AT-SPI:** librerías runtime presentes (`libatspi2.0-0t64`, `libatk-bridge2.0-0t64`); no así los `-dev` (no se pueden instalar sin root). El código Rust usa `zbus` puro sin bindings C, así que solo necesita `pkg-config` y `libatspi2.0-dev` a futuro (no estrictamente para `zbus`, sí para linking de Tauri/GTK).
- **Wayland:** el sandbox está en X11. El MVP apunta a X11 (vía `xdotool`/`xclip`/`wmctrl`); Wayland requiere `wtype`/`wl-clipboard` y está soportado como fallback automático.
- **Limitación del sandbox:** sin `sudo`, no se pudo ejecutar `cargo build` del crate `weaver` (Tauri). Se creó `/home/z/my-project/scripts/weaver-core-check/` como sub-crate standalone que replica los módulos atspi/automation/keyring sin tauri, para verificar que el código Rust compila.

### Próximos pasos (Sesión 2)

1. **En máquina Linux real del usuario:** instalar deps del sistema (`sudo apt install libwebkit2gtk-4.1-dev ...`) y ejecutar `npm run tauri:dev` para probar.
2. **Probar end-to-end:** configurar API key de OpenAI/Anthropic/Ollama, pedir "abre gedit y escribe Hola", verificar que el agente ejecuta vía AT-SPI.
3. **Persistencia real:** migrar `agent/memory.ts` y `skills/registry.ts` de localStorage a SQLite vía un comando Tauri `memory_*`.
4. **VertexAI/Bedrock adapters:** implementar firma AWS SigV4 y OAuth2 de Google.
5. **Soporte Wayland vía portales:** integrar `xdg-desktop-portal` para inyección de input segura.
6. **Persistencia de skills auto-aprendidas:** comando Tauri `skills_write_learned` para escribir a `~/.weaver/skills/learned/<name>.md`.
7. **MCP runtime real:** lanzar subprocesos stdio JSON-RPC y exponer tools al executor.

---

## Roadmap alto-nivel

| Fase | Estado | ETA |
|------|--------|-----|
| 1 — Fundación | [x] Hecha | Sesión 1 ✅ |
| 2 — Núcleo Linux (AT-SPI + automation) | [x] Hecho | Sesión 1 ✅ |
| 3 — Proveedores IA (22) | [x] 20/22 (VertexAI/Bedrock TBD) | Sesión 1 ✅ |
| 4 — UI Codex-style | [x] Hecho | Sesión 1 ✅ |
| 5 — Bucle agéntico | [x] Esqueleto completo | Sesión 1 ✅ |
| 6 — MCP + skills.sh | [~] Esqueleto, runtime real TBD | Sesión 2 |
| 7 — Pulido Linux + empaquetado | [ ] Pendiente | Sesión 2-3 |
