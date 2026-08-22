# Weaver

> Agente de escritorio que opera **cualquier aplicación** a través de las APIs de Accesibilidad del sistema operativo — AT-SPI2 en Linux, UIAutomation en Windows, AXUIElement en macOS — sin depender de visión por computadora. Un LLM planifica, ejecuta, verifica y reflexiona para cumplir objetivos del usuario, con memoria, sub-agentes, workflows visuales y un modo IDE completo alrededor.

[![Status](https://img.shields.io/badge/status-MVP%20Linux%20%7C%20Windows%2Fmacos%20en%20CI-yellow)](PROGRESS.md)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-206%20passing-brightgreen)](PROGRESS.md)

## Por qué Weaver es diferente

La mayoría de agentes de escritorio toman screenshots y los procesan con un modelo de visión. Weaver, en cambio, consulta el **árbol de accesibilidad** nativo del sistema operativo, lo que permite:

- **Determinismo**: el agente llama a `click(element_id)`, no a `click(x=412, y=308)`. Si la ventana se mueve o se redimensiona, la acción sigue funcionando.
- **Velocidad**: leer un sub-árbol de accesibilidad es mucho más rápido que un ciclo captura + VLM.
- **Privacidad**: no se envían imágenes al modelo por defecto — solo texto estructurado (rol, estado, acciones disponibles de cada elemento).
- **Robustez**: el agente conoce el rol, estado y acciones disponibles de cada elemento de la interfaz, no solo su apariencia.

Cuando la accesibilidad no basta (canvas, apps sin soporte a11y, contenido puramente visual), Weaver escala a OCR local y, solo con consentimiento explícito del usuario, a un modelo de visión — ver [Jerarquía de visión](#jerarquía-de-visión).

## Qué incluye

Weaver no es solo el bucle agéntico de accesibilidad — es una aplicación de escritorio completa construida alrededor de él:

- **Bucle agéntico** con planificación jerárquica, ejecución vía herramientas AT-SPI/UIA/AX, crítico que verifica el resultado y reflexión que genera skills reutilizables.
- **Modo RLM** (Recursive Language Model) opcional: el agente gestiona su contexto como variables en vez de volcarlo todo al prompt, y puede delegar subtareas en sub-agentes hijos con presupuesto y límites de recursión propios.
- **22 proveedores de IA** configurables por conversación o por miembro del proyecto.
- **Workflows visuales**, un motor de automatización tipo n8n con nodos, expresiones, triggers (webhook/cron/manual) y ejecución con reintentos — pensado para que el propio agente pueda construir y disparar automatizaciones.
- **Notebooks**, inspirado en NotebookLM: cuadernos que agrupan fuentes (PDF, Markdown, texto, URLs, DOCX) y permiten chatear con el modelo usando esas fuentes como contexto, además de generar resúmenes, mapas mentales, flashcards y quizzes.
- **Modo IDE**: editor Monaco con pestañas, explorador de archivos, terminal, diff viewer con marcas verde/rojo de lo que el agente cambió línea a línea, y panel del agente en paralelo.
- **Sub-agentes especializables**, MCP (cliente y runtime), skills instalables vía `SKILL.md`, memoria episódica consultable, métricas de uso/costo por proveedor y colaboración local con miembros, roles y permisos por proyecto.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + Zustand |
| Backend | Rust + Tauri v2 + Tokio |
| Accesibilidad | AT-SPI2/D-Bus (Linux, `zbus`) · UIAutomation (Windows) · AXUIElement (macOS) — tras un trait `Backend` común |
| Editor / documentos | Monaco Editor, `@xyflow/react` (workflows), `pdfjs-dist`, `mammoth` (DOCX) |
| Persistencia | SQLite (episodios, hechos, proyectos, workflows, credenciales) + keyring del OS (API keys) |
| Automatización | Servidor de webhooks (axum), scheduler cron, motor de expresiones propio (sin `eval`) |
| LLM | 22 proveedores vía 6 familias de adaptadores |

## Proveedores de IA (22)

OpenAI · Azure · Anthropic · Google Gemini · Google Vertex AI · Amazon Bedrock ·
Cohere · xAI (Grok) · Perplexity · Together AI · Cerebras · Groq · NVIDIA NIM ·
Lightning AI · DeepSeek · Mistral · Meta (Llama) · Qwen (Alibaba) · Zhipu (GLM) ·
OpenRouter · Ollama (local) · HuggingFace.

Se configuran desde el **model picker** del composer (popup con buscador, lista de modelos y gestión de API keys). Las API keys se guardan en el keyring del sistema operativo — libsecret en Linux, Keychain en macOS, Credential Manager en Windows — y pueden ser globales o específicas por miembro de un proyecto.

## Bucle agéntico

```
Objetivo → Planner jerárquico → Subtareas →
  Executor (ReAct loop, tools AT-SPI/UIA/AX) →
  Crítico (verifica contra criterio de éxito) →
  ¿OK? → siguiente subtarea
  ¿No? → replanificar (≤3 intentos)
→ Reflexión → Memoria episódica + skill auto-aprendida
```

Las respuestas largas (>8 192 tokens) se **encadenan automáticamente** mediante los marcadores `<<CONTINUE>>` / `<<END>>`, de forma transparente para el usuario. Los modelos sin function calling nativo (Mistral, Hermes, Llama vía Ollama) usan un parser de tool calls en formato texto.

### Modo RLM (Recursive Language Model)

Activable con `/rlm on` desde el composer. En vez de un único contexto que crece sin límite, el agente:

- Guarda fragmentos de información en un `ContextStore` por sesión (`ctx_set`/`ctx_get`/`ctx_list`) en lugar de volcarlos al prompt.
- Lee archivos de forma selectiva (`file_view_lines`, `file_view_structure`, `file_view_symbols`) en vez de cargarlos completos.
- Puede delegar subtareas en sub-agentes hijos con `spawn_child_agent`, con límites explícitos: profundidad máxima 3, hasta 50 hijos totales, 5 en paralelo, 10 minutos de presupuesto de tiempo por árbol de recursión.
- Soporta `/refine`, que analiza la traza de un episodio y propone ajustes al scaffolding (prompts, skills, sub-agentes, allowlist de tools), con snapshot previo y reversión automática si el rendimiento empeora.

Un panel dedicado ("RLM Agent" en la barra lateral) visualiza el árbol de recursión en tiempo real y el contenido del `ContextStore`.

### Jerarquía de visión

El agente no decide libremente cuándo "ver" la pantalla — sigue un orden explícito:

1. **AT-SPI / UIA / AX** — siempre primero. Rápido, determinista, gratis.
2. **OCR local (Tesseract)** — si la accesibilidad no da suficiente información (canvas, apps sin soporte a11y). Corre 100% en la máquina del usuario.
3. **VLM** (modelo de visión) — solo si la tarea requiere entender contenido visual no textual (diseño, layout, gráficos). **Opt-in explícito**: por defecto Weaver pregunta antes de enviar cualquier imagen a un proveedor.

## Workflows

Motor de automatización visual comparable a n8n, con el diferenciador de que el propio agente puede leer, validar, ejecutar, exportar e importar workflows como herramientas.

- **19 tipos de nodo**: webhook, schedule, manual, code, if, switch, filter, delay, set, chat_message, http_request, loop, split, merge, aggregate, sort, limit, execute_workflow (subworkflows), llm.
- **Motor de expresiones propio** (lexer + parser + evaluador basado en AST, sin `eval`/`vm`, con allowlist de métodos): `$json`, `$node["Nombre"]`, `$items(...)`, `$env`, `$vars`, `$now`, ternarios, aritmética y métodos de string/array/objeto.
- **Motor de ejecución v2**: branching real (IF/Switch), merge con 3 modos, ramas paralelas, reintentos con backoff exponencial, timeouts por nodo, cancelación, circuit breakers y filtros por expresión en los edges.
- **Validador** con 14 reglas (ciclos, nodos desconectados, credenciales faltantes, expresiones inválidas, tipos de nodo desconocidos, etc.).
- **Seguridad**: protección SSRF (bloquea IPs privadas, loopback, link-local y metadata de AWS por defecto).
- Servidor de webhooks (axum, `127.0.0.1:7878`) y scheduler cron corriendo en el backend Rust.

107 tests cubren expresiones, validador, motor v2, import/export, registro de nodos y protección SSRF.

## Notebooks

Sección independiente del chat principal, inspirada en NotebookLM:

- Cuadernos que agrupan **fuentes**: PDF, Markdown, texto plano, URLs y DOCX.
- Chat con grounding sobre esas fuentes, con tres modos: búsqueda rápida, investigación profunda y agente (bucle observación → razonamiento → acción, acotado a 6 iteraciones, con autocrítica de la respuesta final).
- Pestaña **Studio** que genera artefactos a partir de las fuentes: resúmenes, informes, mapas mentales, flashcards, quizzes, tablas de datos, infografías y guías de estudio.

## Modo IDE

Layout alternativo (persistido por proyecto) pensado para tareas de código:

- **Editor Monaco** con pestañas, indicador de cambios sin guardar, autocompletado, minimapa y un tema que lee las variables CSS de Weaver.
- **Diff viewer** con las líneas que el agente agregó (verde) o modificó (rojo) marcadas en tiempo real sobre el propio editor, con tooltip al pasar el mouse.
- **Explorador de archivos**, terminal integrada (con historial y comandos built-in) y selector nativo de carpeta de trabajo.
- **Panel del agente** en paralelo, para seguir la ejecución mientras se edita código.

## Instalación

### Linux (plataforma primaria)

Dependencias del sistema (Debian/Ubuntu):

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libssl-dev pkg-config \
  libatspi2.0-dev libglib2.0-dev librsvg2-dev \
  xdotool wtype xclip wl-clipboard wmctrl
```

Habilitar accesibilidad AT-SPI:

```bash
gsettings set org.gnome.desktop.interface toolkit-accessibility true
```

(Opcional) Ollama para modelos locales:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.3
```

### Windows y macOS

El backend cross-platform (UIAutomation en Windows, AXUIElement en macOS) está implementado — ambos tienen sus 16 métodos del trait `Backend` completos, incluyendo clipboard, control de ventanas e input de teclado/mouse. Sin embargo, **los builds de CI de Windows y macOS aún no son verdes**: Windows falla en el empaquetado por un `icon.ico` con formato incorrecto, y macOS por diferencias de firma entre versiones de los crates `objc2-core-graphics`/`accessibility`. Ver [`PLAN_WINDOWS.md`](PLAN_WINDOWS.md) y [`PLAN_MACOS.md`](PLAN_MACOS.md) para el detalle y estado fase por fase.

### Build

```bash
git clone https://github.com/andreslpxz/Weaver.git
cd Weaver
npm install
npm run tauri:dev    # desarrollo
# o
npm run tauri:build  # produce .deb / .AppImage / .rpm en src-tauri/target/release/bundle/
```

Otros comandos útiles:

```bash
npm run typecheck      # tsc --noEmit
npm run test           # vitest run (206 tests)
npm run test:coverage  # vitest run --coverage
```

## Uso

1. Abre Weaver.
2. Click en el model picker (esquina inferior izquierda del composer).
3. Selecciona proveedor → modelo. Si requiere API key, pégala en la pestaña "API Keys".
4. Pide cosas como:
   - *"Abre gedit y escribe 'Hola desde Weaver', luego guárdalo en ~/weaver-test.txt"*
   - *"Copia el contenido de la ventana activa y pégalo en un correo nuevo"*
   - *"Lee los títulos de las pestañas abiertas en Firefox"*
5. Observa cómo el agente planifica, ejecuta cada paso vía accesibilidad, verifica con el Crítico y reflexiona al final.
6. Opcional: escribe `/rlm on` para activar el modo de contexto recursivo, o `/help` para ver todos los slash commands disponibles.

## Documentación

- [`PLAN.md`](PLAN.md) — visión, fases, MVP, riesgos.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — capas, flujo agéntico, paleta, decisiones técnicas (documento de diseño original; algunas secciones no reflejan aún los módulos añadidos en sesiones posteriores como RLM, Workflows v2 o Notebooks).
- [`PLAN_WINDOWS.md`](PLAN_WINDOWS.md) / [`PLAN_MACOS.md`](PLAN_MACOS.md) — plan y estado de los puertos a Windows y macOS.
- [`WEAVER_WORKFLOWS_PLAN.md`](WEAVER_WORKFLOWS_PLAN.md) — plan maestro del motor de workflows (28 fases, comparativa con n8n).
- [`PROGRESS.md`](PROGRESS.md) — estado sesión por sesión, la fuente más fiable del avance real del proyecto.
- [`docs/vision.md`](docs/vision.md) — jerarquía de visión y consentimiento VLM.
- [`docs/subagents.md`](docs/subagents.md) — contrato de sub-agentes, presupuestos, tools restringidas.
- [`docs/memory-control.md`](docs/memory-control.md) — panel de memoria episódica.
- [`docs/metrics.md`](docs/metrics.md) — métricas de tokens/costo/éxito por proveedor.
- [`docs/supabase-sync.md`](docs/supabase-sync.md) — sincronización opcional de proyectos vía Supabase.
- [`docs/signing.md`](docs/signing.md) — firma de código para los builds empaquetados.

## Estado actual

Ver [`PROGRESS.md`](PROGRESS.md) para el detalle sesión por sesión (17 sesiones documentadas). En resumen:

**Completo y probado (206 tests, `tsc --noEmit` limpio):**
- Backend Rust cross-platform: AT-SPI2 (Linux), UIAutomation (Windows), AXUIElement (macOS) tras un trait común, todos con sus 16 métodos implementados.
- Automatización de teclado/mouse/clipboard/ventanas por plataforma; keyring nativo por plataforma.
- 22 proveedores de IA en 6 familias de adaptadores, con multimodal real.
- Bucle agéntico: planner + executor (11 tools) + critic + reflection + memoria episódica.
- Modo RLM: gestión de contexto por variables, sub-agentes recursivos con límites, `/refine`.
- Workflows v2: motor de ejecución, expresiones, validador, 19 nodos, protección SSRF.
- Notebooks: fuentes multi-formato, chat con grounding, Studio con 8 tipos de artefacto.
- Modo IDE completo: Monaco + terminal + diff viewer con marcas de línea reales.
- MCP runtime real (Rust) + cliente TS; skills instalables vía `SKILL.md`.
- SQLite con 7+ tablas; colaboración local (miembros, roles, permisos, API keys por miembro).
- CI generando `.deb`/`.AppImage`/`.rpm` en Linux.

**En progreso o pendiente:**
- CI de Windows y macOS aún no pasan en verde (ver sección de instalación arriba).
- `xdg-desktop-portal` RemoteDesktop real para Wayland puro (hoy solo hay detección + guía).
- Persistencia SQLite completa de conversaciones al cambiar entre ellas (hoy solo se persiste al crearse).
- `bedrock_invoke` con SigV4 nativo en Rust (hoy va por proxy en el navegador).
- Skills auto-aprendidas persistidas a disco tras reflexión exitosa.
- Sincronización bidireccional de datos vía Supabase (hoy solo vincula metadatos de proyecto).
- Code-splitting del bundle de producción.

## Licencia

Apache-2.0. Ver [LICENSE](LICENSE).
