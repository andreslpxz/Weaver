# Reporte de Pruebas E2E con Playwright - Weaver

## Resumen Ejecutivo

- **Modelo probado**: `Groq` / `Llama 3.3 70B` (`llama-3.3-70b-versatile`)
- **Herramienta de Automatización**: Playwright v1.62.1 (Chromium)
- **Resultado Global**: **PASSED (1/1)** - Transcurridos 16.6s de test funcional E2E.

---

## Casos de Prueba Verificados

### 1. Carga de la Aplicación y Selector de Modelos
- Se abrió la aplicación web de Weaver.
- Se configuró con éxito la API Key de Groq en el panel de **API Keys**.
- Se seleccionó el modelo **Llama 3.3 70B (Groq)** en la interfaz del Model Picker.

### 2. Modos Agénticos y Configuración
- Se abrieron los menús desplegables de modos.
- Se activaron los modos agénticos: **Modo RLM**, **Modo Plan**, **Perseguir Objetivo** y **Memoria**.

### 3. Integración de MCPs y Skills
- Se navegó a la sección de **Complementos**, verificando la vista de **Skills** y los **Presets de Servidores MCP** (incluyendo Playwright MCP).

### 4. Chat Normal y Razonamiento
- Se envió un prompt de prueba al modelo Llama 70B:
  > *"Hola Llama 70B en Groq, realiza un razonamiento breve sobre por qué Weaver es útil como agente y responde con 3 puntos clave."*
- El modelo respondió con éxito en vivo a través de Groq, generando el razonamiento y los 3 puntos clave estructurados.

### 5. Panel de Debug, RLM, Métricas y Memoria
- Se inspeccionaron y verificaron las vistas del agente:
  - **RLM Agent Debug View**: Estado de subagentes y fragmentos de contexto.
  - **Métricas**: Registro de tokens de entrada/salida y llamadas al proveedor Groq.
  - **Memoria**: Vista de memoria semántica y hechos guardados del usuario.

---

## Evidencias Visuales (Capturas de Pantalla)

Las capturas de pantalla de la ejecución se han almacenado en `test-results/screenshots/`:

1. `01_app_loaded.png` - Aplicación cargada.
2. `02_groq_key_entered.png` - Ingreso de API key de Groq.
3. `03_groq_key_saved.png` - Confirmación de API key guardada.
4. `04_llama_70b_selected.png` - Selección del modelo Llama 3.3 70B.
5. `05_plus_menu_modes.png` - Menú desplegable de modos agénticos.
6. `06_modes_activated.png` - Modos RLM y Plan activos.
7. `09_chat_prompt_entered.png` - Prompt ingresado en el Composer.
8. `10_chat_response_received.png` - Respuesta y razonamiento recibido de Llama 70B.
9. `11_rlm_debug_view.png` - Panel de inspección RLM / Debug.
10. `12_metrics_view.png` - Panel de Métricas.
11. `13_memoria_view.png` - Panel de Memoria.

---

## Conclusión

El test automatizado con Playwright ha confirmado que el flujo del chat normal, el razonamiento con el modelo **Llama 70B (Groq)**, los modos agénticos (RLM, Planner), la gestión de MCP/Skills y los paneles de Debug operan correctamente.
