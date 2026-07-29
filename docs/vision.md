# Visión del agente

Weaver usa una **jerarquía explícita de visión** para que el agente
pueda "ver" lo que pasa en la pantalla, en archivos o en apps, sin
romper la promesa de privacidad del usuario.

## 1. Jerarquía de decisión

El orden **NO es "el agente decide libremente cuándo usar visión"**.
Es explícito y jerárquico:

1. **AT-SPI / UIA / AX** — siempre primero.
   - Rápido, determinista, gratis.
   - Devuelve el árbol de accesibilidad de la app enfocada.
   - Suficiente para tareas tipo "lee el contenido de esta ventana",
     "haz clic en el botón Guardar", "qué hay en este menú".
2. **OCR local (Tesseract)** — si AT-SPI no da suficiente info.
   - Casos: canvas, nodos vacíos, apps sin soporte a11y.
   - Corre 100% en tu máquina. Sin enviar imágenes a ningún servidor.
   - Requiere `tesseract-ocr` instalado.
3. **VLM (Vision Language Model)** — sólo si la tarea requiere entender
   contenido visual **no textual**.
   - Casos: diseño de una página, layout, modelo 3D, gráfico, imagen.
   - **OPT-IN EXPLÍCITO**: el usuario debe consentir. Configurable en
     Ajustes → Visión del agente.

## 2. Configuración (Ajustes → Visión del agente)

### Consentimiento VLM

| Opción       | Comportamiento                                            |
| ------------ | --------------------------------------------------------- |
| `Preguntar`  | Antes de cada envío, pide confirmación. **Default.**     |
| `Permitir`   | Envía sin preguntar (sólo si confías en el proveedor).   |
| `Nunca`      | Bloquea VLM. Sólo AT-SPI + OCR.                          |

### Proveedor VLM preferido

- Google Gemini (`gemini-1.5-pro`) — default.
- OpenAI (`gpt-4o`).
- OpenRouter (`gpt-4o` vía OpenRouter).
- Anthropic (`claude-3-5-sonnet`).

Requiere API key del proveedor configurada (icono del modelo en el
composer).

### OCR local

Toggle on/off. Idiomas configurables (códigos Tesseract separados por
`+`, ej. `spa+eng`). Verifica con `tesseract --list-langs`.

## 3. API interna

```typescript
import { see, getVisionPrefs } from '@/agent/vision';

const result = await see({
  target: 'focused_app',           // o 'window:Firefox' o 'screen'
  maxDepth: 4,
  allowOcr: true,
  allowVlm: true,
  vlmProviderId: 'google',
  vlmPrompt: 'Describe el layout de esta página',
}, {
  onVlmConsent: async () => {
    // Mostrar prompt al usuario. true = consentir.
    return confirm('¿Enviar captura al VLM?');
  },
});

// result.source: 'atspi' | 'ocr' | 'vlm'
// result.text: texto extraído
// result.tree: árbol serializado (si source='atspi')
// result.imagePath: ruta al snapshot (si source='ocr' o 'vlm')
// result.elapsedMs: tiempo total
```

## 4. Privacidad

- Las capturas se guardan en `/tmp/weaver_vision_<ts>.png` (temporales).
- Las imágenes base64 se envían **sólo** al proveedor VLM seleccionado.
- El OCR local (Tesseract) **no** envía nada fuera de tu máquina.
- AT-SPI no envía nada — lee directamente el árbol de accesibilidad del
  proceso.

## 5. Dependencias Linux

```bash
# Tesseract para OCR local
sudo apt install tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng

# Captura de pantalla
sudo apt install grim scrot   # grim para Wayland, scrot para X11
```

Verifica:

```bash
tesseract --version
tesseract --list-langs
```

## 6. Cuándo usar cada nivel

| Tarea                                            | Nivel     |
| ------------------------------------------------ | --------- |
| "Lee qué dice el botón activo"                   | AT-SPI    |
| "Haz clic en Guardar"                            | AT-SPI    |
| "¿Qué opciones tiene el menú Archivo?"           | AT-SPI    |
| "Lee el texto de este canvas"                    | OCR       |
| "¿Qué dice esta notificación de Chrome?" (canvas)| OCR       |
| "Describe el layout de esta web"                 | VLM       |
| "¿Este diseño de UI se ve bien balanceado?"      | VLM       |
| "Interpreta este modelo 3D / gráfico"            | VLM       |
| "Compara estos dos diseños visualmente"          | VLM       |

## 7. Limitaciones actuales

- El flujo `see()` no está expuesto como tool del agente todavía — es
  una API interna. Falta el cableado para que el LLM la invoque cuando
  identifique que necesita "ver" algo.
- OCR no soporta lectura de PDFs directamente (sólo capturas de
  pantalla). Para PDFs, usar `web_fetch` o `file_read` + parser.
- VLM no soporta video, sólo imágenes estáticas.
