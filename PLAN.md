# Weaver — Plan de Desarrollo

> Asistente de escritorio agéntico multiplataforma. La IA "ve" las aplicaciones a través de las APIs de Accesibilidad del sistema operativo (sin visión por computadora), razona con un LLM y actúa sobre cualquier programa: clics, teclado, portapapeles, transferencia entre apps.
>
> **Stack:** Tauri v2 + React + TypeScript + Rust. **Primera plataforma:** Linux (AT-SPI2 / D-Bus).

---

## 0. Visión

Weaver es un agente de escritorio que se comporta como un "Copilot del sistema operativo". No toma screenshots ni usa visión — en su lugar consultas el **árbol de accesibilidad** del OS (`AT-SPI` en Linux, `UIAutomation` en Windows, `Accessibility API` en macOS), lo que permite interacciones precisas, deterministas y rápidas con cualquier aplicación nativa que exponga controles.

El agente sigue el ciclo **Objetivo → Planificador → Subtareas → Memoria → Ejecutor → Crítico → Reflexión → Replanificar**, con encadenamiento de respuestas para superar el límite de 8,192 tokens por inferencia.

## 1. Objetivos funcionales

| # | Objetivo | Prioridad |
|---|----------|-----------|
| F1 | UI estilo Codex/Claude (dark, sidebar + main + input con model picker) | Alta |
| F2 | 22 proveedores IA configurables con su API key | Alta |
| F3 | Modelo picker en el input (popup con bordes redondeados) | Alta |
| F4 | Chat con streaming y encadenamiento automático >8,192 tokens | Alta |
| F5 | Agente: Planner + Memory + Tool Executor + Critic + Reflection | Alta |
| F6 | Accesibilidad Linux vía AT-SPI (query, click, type, get_text, list_windows) | Alta |
| F7 | MCP (Model Context Protocol) cliente | Media |
| F8 | skills.sh: `npx skills add ...` + parser de `SKILL.md` | Media |
| F9 | Memoria episódica + semántica persistente (SQLite local) | Media |
| F10 | Skills reutilizables auto-aprendidas tras tareas exitosas | Baja |

## 2. Plan de fases (Linux primero)

### Fase 1 — Fundación (Sesión actual)
- [x] Clonar repo `andreslpxz/Weaver`
- [x] Instalar Rust toolchain
- [x] Analizar imágenes de referencia visual
- [x] Crear `PLAN.md`, `ARCHITECTURE.md`, `PROGRESS.md`
- [ ] Scaffold Tauri v2 + React + TS + Vite
- [ ] Declarar dependencias Rust y TS
- [ ] Worklog inicial

### Fase 2 — Núcleo Linux (Rust)
- [ ] Módulo `acpi/atspi`: cliente D-Bus → AT-SPI Registry
  - `list_applications()` → `Vec<Application>`
  - `query_tree(app_id)` → `Node` jerárquico (role, name, states, bbox, actions)
  - `click(node_path)`, `double_click(...)`, `hover(...)`
  - `type_text(node_path, text)`, `press_key(keysym)`
  - `get_text(node_path)`, `set_text(...)`
  - `scroll(...)`, `focus(...)`
- [ ] Módulo `acpi/automation`:
  - Emulación de teclado/ratón (X11 via `x11rb`, Wayland via `wl-copy`/portal)
  - Portapapeles (`wl-clipboard` / `xclip`)
  - Gestión de ventanas (EWMH `_NET_ACTIVE_WINDOW`, listar ventanas, switch)
- [ ] Comandos Tauri `#[tauri::command]` que exponen todo lo anterior al frontend

### Fase 3 — Sistema de proveedores IA (TS)
- [ ] `providers/registry.ts` con los 22 proveedores definidos
- [ ] `providers/adapters/` por proveedor (o agrupados por familia)
  - **Familia OpenAI-compat:** OpenAI, Azure, Together, Cerebras, Groq, NVIDIA, Lightning, DeepSeek, OpenRouter, Perplexity, Mistral, Ollama, HuggingFace
  - **Familia Anthropic:** Anthropic, Bedrock, VertexAI
  - **Familia Google:** Gemini, VertexAI
  - **Familia Cohere:** Cohere
  - **Familia xAI:** Grok
  - **Familia Alibaba:** Qwen
  - **Familia Zhipu:** GLM
  - **Familia Meta:** Llama (vía Together/Ollama)
- [ ] `providers/index.ts` con `createClient(provider, model, apiKey)` → interfaz unificada `{ stream, tools }`
- [ ] Storage de API keys: `tauri-plugin-stronghold` o `keyring` crate

### Fase 4 — UI Codex-style (React)
- [ ] Layout: `<Sidebar/>` + `<MainArea/>` + `<Composer/>`
- [ ] Sidebar secciones:
  - Nuevo chat (botón prominente)
  - Buscar (input)
  - Complementos (MCP servers + skills instaladas)
  - Automatizaciones (skills auto-aprendidas)
  - Proyectos (carpetas de conversaciones)
  - Configuración (engranaje al final)
- [ ] Main area:
  - Histórico de mensajes (markdown + code highlighting)
  - Pestañas superiores: `Chat | Complementos | Habilidades`
- [ ] Composer (input box bottom-center estilo Codex):
  - Botón `+` adjuntar
  - **Model picker**: rectángulo con bordes redondeados, al click abre popup con:
    - Buscador de proveedor
    - Lista de modelos del proveedor seleccionado
    - Input para API key (si aplica)
    - Botón "Probar conexión"
  - Botón enviar (circular, flecha negra)
- [ ] Tema dark con paleta de referencia (ver `ARCHITECTURE.md`)

### Fase 5 — Bucle agéntico
- [ ] `agent/planner.ts`: descomposición jerárquica (HTN-lite)
- [ ] `agent/memory.ts`:
  - Episódica: SQLite tabla `episodes` (tarea, pasos, resultado, timestamp)
  - Semántica: tabla `facts` (clave-valor con embeddings opcional)
- [ ] `agent/executor.ts`: ejecuta tools (AT-SPI bridge, file, shell, web_fetch, mcp)
- [ ] `agent/critic.ts`: valida resultado contra criterios de éxito
- [ ] `agent/reflection.ts`: tras cada episodio, extrae lección → guarda en `skills_learned`
- [ ] `agent/search_tree.ts`: árbol de búsqueda para decisiones complejas (best-first con heurística del LLM)

### Fase 6 — Integraciones
- [ ] `mcp/client.ts`: cliente MCP sobre stdio/SSE
- [ ] `skills/registry.ts`: parsea `SKILL.md` locales (frontmatter + body)
- [ ] `skills/installer.ts`: wrapper sobre `npx skills add <url> --skill <name>`
- [ ] `skills/vercel-labs/find-skills`: import automático al iniciar

### Fase 7 — Pulido Linux
- [ ] Soporte Wayland (portales xdg-desktop)
- [ ] Empaquetado `.deb`, `.AppImage`, `.rpm`
- [ ] Tests de accesibilidad con apps de referencia (gedit, firefox, nautilus, code)

## 3. Criterios de "MVP Linux"

El MVP se considera listo cuando el usuario puede:
1. Abrir Weaver en Linux.
2. Configurar API key de al menos un proveedor (OpenAI, Anthropic, Ollama).
3. Pedir "Abre gedit, escribe 'Hola desde Weaver' y guarda el archivo en ~/weaver-test.txt".
4. Ver al agente planificar, ejecutar cada paso via AT-SPI, verificar y reportar.
5. Revisar el log episódico y la skill auto-aprendida.

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Wayland bloquea eventos sintéticos de ratón | Documentar requerimiento de X11 para algunas operaciones; usar portales cuando sea posible |
| Apps no exponen árbol AT-SPI (Canvas/WebGL) | Detectar y degradar a "visión" como fallback futuro; nunca fallar silenciosamente |
| Latencia al leer árbol completo | Cache + lectura incremental (sólo sub-árbol con foco) |
| Límite 8k tokens | Encadenamiento automático: extraer summary → continuar en nueva inferencia |
| API keys en claro | Usar OS keychain (libsecret en Linux) vía `keyring` crate |
| 22 proveedores heterogéneos | Familias de adaptadores + interfaz mínima `{ stream, tools }` |

## 5. Estado actual

Ver `PROGRESS.md` para el estado detallado sesión-por-sesión.
