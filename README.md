# Weaver

> Agente de escritorio Linux que opera **cualquier aplicación** a través de las APIs de Accesibilidad del sistema (AT-SPI2 sobre D-Bus), sin necesidad de visión por computadora. Un LLM planifica, ejecuta, verifica y reflexiona para cumplir objetivos del usuario.

[![Status](https://img.shields.io/badge/status-MVP%20Linux-yellow)](PROGRESS.md)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Por qué Weaver es diferente

La mayoría de agentes de escritorio toman screenshots y los procesan con visión. Weaver no: consulta el **árbol de accesibilidad** del sistema operativo (AT-SPI en Linux), lo que permite:

- **Determinismo**: el agente llama a `click(element_id)`, no a `click(x=412, y=308)`. Si la ventana se mueve, la acción sigue funcionando.
- **Velocidad**: leer un sub-árbol AT-SPI es ~10× más rápido que un capture+VLM.
- **Privacidad**: no se envían imágenes al modelo, solo texto estructurado.
- **Robustez**: el agente sabe el rol, estado y acciones disponibles de cada elemento.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Rust + Tauri v2 + Tokio |
| Accesibilidad | AT-SPI2 sobre D-Bus (crate `zbus`) |
| Persistencia | SQLite (memoria) + libsecret (API keys) |
| LLM | 22 proveedores vía familias de adaptadores |

## Proveedores IA (22)

OpenAI · Azure · Anthropic · Google Gemini · Google Vertex AI · Amazon Bedrock ·
Cohere · xAI (Grok) · Perplexity · Together AI · Cerebras · Groq · NVIDIA NIM ·
Lightning AI · DeepSeek · Mistral · Meta (Llama) · Qwen (Alibaba) · Zhipu (GLM) ·
OpenRouter · Ollama (local) · HuggingFace.

Configurables desde el **model picker** en el composer (rectángulo con bordes
redondeados, popup con buscador, lista de modelos y gestión de API keys).

## Bucle agéntico

```
Objetivo → Planner jerárquico → Subtareas →
  Executor (ReAct loop, tools AT-SPI) →
  Crítico (verifica contra criterio) →
  ¿OK? → siguiente subtarea
  ¿No? → replanificar (≤3 intentos)
→ Reflexión → Memoria episódica + skill auto-aprendida
```

Las respuestas largas (>8,192 tokens) se **encadenan automáticamente** mediante
los marcadores `<<CONTINUE>>` / `<<END>>`, transparentes para el usuario.

## Instalación (Linux)

### 1. Dependencias del sistema (Debian/Ubuntu)

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

### 2. Build

```bash
git clone https://github.com/andreslpxz/Weaver.git
cd Weaver
npm install
npm run tauri:dev    # desarrollo
# o
npm run tauri:build  # produce .deb / .AppImage / .rpm en src-tauri/target/release/bundle/
```

## Uso

1. Abre Weaver.
2. Click en el model picker (esquina inferior izquierda del composer).
3. Selecciona proveedor → modelo. Si requiere API key, pégala en la pestaña "API Keys".
4. Pide cosas como:
   - *"Abre gedit y escribe 'Hola desde Weaver', luego guárdalo en ~/weaver-test.txt"*
   - *"Copia el contenido de la ventana activa y pégalo en un correo nuevo"*
   - *"Lee los títulos de las pestañas abiertas en Firefox"*
5. Observa cómo el agente planifica, ejecuta cada paso vía AT-SPI, verifica con el Crítico y reflexiona al final.

## Documentación

- [`PLAN.md`](PLAN.md) — visión, fases, MVP, riesgos.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — capas, flujo agéntico, paleta, decisiones técnicas.
- [`PROGRESS.md`](PROGRESS.md) — estado sesión por sesión.

## Estado actual

Ver [`PROGRESS.md`](PROGRESS.md). En resumen:

- ✅ Fundación + scaffold Tauri v2 + React + TS + Rust.
- ✅ Backend Rust: AT-SPI client (D-Bus via zbus) + automation (xdotool/wtype/wmctrl) + keyring.
- ✅ Frontend: 22 proveedores con 4 familias de adaptadores (OpenAI-compat, Anthropic, Gemini, Ollama).
- ✅ UI Codex-style: sidebar, composer con model picker popup, chat con markdown+code, 4 vistas.
- ✅ Bucle agéntico: planner + executor + critic + reflection + memory.
- ✅ Skills: parser de SKILL.md + installer (`npx skills add`) + esqueleto MCP.
- ⚠️ Pendiente: vertexai/bedrock adapters, persistencia SQLite real (hoy es localStorage), soporte Wayland vía portales.

## Licencia

Apache-2.0. Ver [LICENSE](LICENSE).
