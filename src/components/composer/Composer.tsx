import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  Square,
  ChevronDown,
  UploadCloud,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Folder,
  Link as LinkIcon,
  Globe,
  Brain,
  Target,
  Map,
  Puzzle,
  Monitor,
  Network,
  X,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { getProvider, PROVIDERS } from '@/providers/registry';
import { IconButton, Button } from '@/components/common/Button';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';
import { AttachmentChips } from '@/components/composer/AttachmentChips';
import { AppPicker, type PickedApp } from '@/components/composer/AppPicker';
import { createProvider } from '@/providers';
import { runAgent } from '@/agent/loop';
import { streamChat, streamUntilDone } from '@/lib/chain';
import {
  fileToAttachment,
  buildMessageWithAttachments,
  getFilesFromDrop,
} from '@/lib/attachments';
import { runtime } from '@/lib/tauri';
import type { Message, ImageContent } from '@/providers/types';
import type { Attachment } from '@/lib/attachments';
import { skillsRegistry } from '@/skills/registry';
import type { Skill } from '@/skills/registry';

const newMsgId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function Composer() {
  const [value, setValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const [attachedApp, setAttachedApp] = useState<PickedApp | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  const {
    providerId,
    modelId,
    setModelPickerOpen,
    modelPickerOpen,
    appendMessage,
    updateLastAssistantMessage,
    setAgentState,
    handleAgentEvent,
    activeConversationId,
    newConversation,
    draftAttachments,
    addDraftAttachments,
    removeDraftAttachment,
    clearDraftAttachments,
    planMode,
    pursueObjective,
    cognitiveMode,
    setPlanMode,
    setPursueObjective,
    setCognitiveMode,
    projects,
    setView,
  } = useWeaver();

  // Cargar skills para el menú @
  useEffect(() => {
    skillsRegistry.loadAll().then(setSkills).catch(() => setSkills([]));
  }, []);

  // Autosize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  // Escuchar sugerencias de la UI
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setValue(text);
      taRef.current?.focus();
    };
    window.addEventListener('weaver:set-composer', handler as EventListener);
    return () => window.removeEventListener('weaver:set-composer', handler as EventListener);
  }, []);

  // Cerrar popup + al hacer click fuera
  useEffect(() => {
    if (!plusOpen) return;
    const handler = (e: MouseEvent) => {
      if (plusBtnRef.current && !plusBtnRef.current.contains(e.target as Node)) {
        // Verificar también si el click fue dentro del popup
        const popup = document.getElementById('plus-popup');
        if (popup && popup.contains(e.target as Node)) return;
        setPlusOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [plusOpen]);

  const provider = getProvider(providerId);
  const modelLabel = provider?.models.find((m) => m.id === modelId)?.label ?? modelId;

  // --- Detección de @ en el texto -------------------------------------------
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const atMatch = before.match(/(?:^|\s)@([\w\-/]*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
      const q = atMatch[1].toLowerCase();
      const items: MentionItem[] = [];
      // Skills
      for (const s of skills) {
        if (!q || s.name.toLowerCase().includes(q)) {
          items.push({
            type: 'skill',
            label: s.name,
            desc: s.description,
            icon: 'brain',
            insert: `@skill:${s.name}`,
          });
        }
      }
      // Proyectos
      for (const p of projects) {
        if (!q || p.name.toLowerCase().includes(q)) {
          items.push({
            type: 'project',
            label: p.name,
            desc: `Proyecto · ${p.id.slice(0, 8)}`,
            icon: 'file',
            insert: `@project:${p.name}`,
          });
        }
      }
      // Proveedores
      for (const p of PROVIDERS) {
        if (!q || p.label.toLowerCase().includes(q) || p.id.includes(q)) {
          items.push({
            type: 'provider',
            label: p.label,
            desc: p.desc,
            icon: 'globe',
            insert: `@provider:${p.id}`,
          });
        }
      }
      // Adjuntos recientes
      for (const a of draftAttachments) {
        if (!q || a.name.toLowerCase().includes(q)) {
          items.push({
            type: 'file',
            label: a.name,
            desc: `${a.kind} · ${a.size} B`,
            icon: a.kind === 'image' ? 'image' : 'file',
            insert: `@file:${a.name}`,
          });
        }
      }
      // Comandos rápidos
      if (!q || 'web'.includes(q)) {
        items.push({ type: 'command', label: 'Buscar en internet', desc: 'web_search (Tavily)', icon: 'globe', insert: 'busca en internet ' });
      }
      if (!q || 'shell'.includes(q) || 'terminal'.includes(q)) {
        items.push({ type: 'command', label: 'Ejecutar comando shell', desc: 'shell_exec (Tauri)', icon: 'file', insert: 'ejecuta en la terminal: ' });
      }
      if (!q || 'plan'.includes(q)) {
        items.push({ type: 'command', label: 'Modo plan', desc: 'Proponer plan antes de ejecutar', icon: 'brain', insert: 'planea esto paso a paso: ' });
      }
      setMentionItems(items.slice(0, 12));
    } else {
      setMentionOpen(false);
    }
  }, [value, skills, draftAttachments, projects]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAttachmentError(null);
      const newAtts: Attachment[] = [];
      const errors: string[] = [];
      for (const f of files) {
        try {
          const att = await fileToAttachment(f);
          newAtts.push(att);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (newAtts.length > 0) addDraftAttachments(newAtts);
      if (errors.length > 0) setAttachmentError(errors.join('\n'));
    },
    [addDraftAttachments],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    e.target.value = '';
    setPlusOpen(false);
  };

  // --- Drag & Drop ----------------------------------------------------------
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounterRef.current += 1;
      setIsDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = getFilesFromDrop(e);
    addFiles(files);
  };

  // --- Envío ---------------------------------------------------------------
  async function handleSend() {
    if ((!value.trim() && draftAttachments.length === 0) || isRunning) return;
    let convId = activeConversationId;
    if (!convId) convId = newConversation();

    const built = buildMessageWithAttachments(value, draftAttachments);
    const images: ImageContent[] = draftAttachments
      .filter((a) => a.kind === 'image' && a.content)
      .map((a) => ({
        dataUrl: a.content!,
        mime: a.mime.startsWith('image/') ? a.mime : 'image/png',
        name: a.name,
      }));

    const userMsg: Message = {
      id: newMsgId(),
      ts: Date.now(),
      role: 'user',
      content: built.toUI,
      attachments: draftAttachments.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        size: a.size,
        mime: a.mime,
        truncated: a.truncated,
      })),
      images: images.length > 0 ? images : undefined,
    };
    appendMessage(userMsg);

    // Construir prompt: si planMode, añadir instrucción de proponer plan primero.
    let objectiveText = built.toLLM;
    if (planMode) {
      objectiveText =
        'IMPORTANTE: Estás en MODO PLAN. Antes de ejecutar nada, propón un plan paso a paso y espera mi confirmación antes de proceder.\n\n' +
        objectiveText;
    }
    if (pursueObjective) {
      objectiveText =
        'IMPORTANTE: Debes PERSEGUIR EL OBJETIVO hasta completarlo. Si algo falla, replanifica e inténtalo de nuevo (máximo 3 intentos por subtarea). No te rindas al primer error.\n\n' +
        objectiveText;
    }
    if (cognitiveMode) {
      objectiveText =
        'IMPORTANTE: Estás en MODO COGNITIVO. Te vuelves HIPER-ESPECIALIZADO en el proyecto activo.\n' +
        'Antes de proponer cualquier cambio al código, DEBES seguir este protocolo de 3 fases:\n' +
        '   1) INTUICIÓN (Telaraña): Llama a cognitive_query para buscar nodos relacionados con\n' +
        '      lo que pide el usuario. Identifica posibles restricciones previas (Performance_Budget,\n' +
        '      dependencias circulares, conflictos conocidos). Asocia el pedido con el historial del grafo.\n' +
        '   2) LÓGICA (Construcción del Grafo): Traza los pasos como una cadena de nodos A → B → C.\n' +
        '      Verifica si algún nodo prohíbe la lógica (usa cognitive_query path/neighbors).\n' +
        '   3) JUICIO (Emisión): Responde con: (a) resumen de lo que encontraste en el grafo,\n' +
        '      (b) nodos afectados y riesgos detectados, (c) propuesta concreta, (d) pregunta de\n' +
        '      confirmación al usuario. Ej: "Para implementar X sin romper el nodo Y (Z), propongo\n' +
        '      usar W. ¿Estás de acuerdo?"\n' +
        'Si no existe un Grafo Cognitivo construido, primero llama a cognitive_graphify con la\n' +
        'ruta del proyecto (si no la sabes, pídela al usuario). NUNCA proposes cambios sin antes\n' +
        'consultar el grafo.\n\n' +
        objectiveText;
    }

    setValue('');
    clearDraftAttachments();
    setIsRunning(true);
    setAgentState('planning');

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const llm = await createProvider(providerId);

      // Detección de tipo de tarea:
      // 1. desktopAgentive: tareas que requieren operar apps de escritorio
      //    vía AT-SPI (abrir gedit, escribir en una ventana, clickear botones).
      //    → Usa runAgent (bucle planner → executor → critic con tools AT-SPI).
      //
      // 2. Cualquier otra cosa (búsqueda web, ejecutar comandos shell, leer
      //    archivos, preguntas generales) → Usa runChatWithTools que tiene
      //    web_search, shell_exec, file_read, etc.
      const desktopAgentive = /\b(abre|abrir|escribe en|escribir en|copia|copiar|pega|pegar|transfiere|transferir|envía|enviar|completa|completar|rellena|rellenar|click|clic|presiona|pulsa)\b/i.test(
        objectiveText,
      );

      if (desktopAgentive && runtime.isTauri) {
        // Nota: NO hacemos appendMessage vacío aquí — handleAgentEvent
        // ya agrega sus propios mensajes (planificando, plan, episodio, etc.).
        // Un append vacío dejaría un mensaje fantasma al inicio del chat.
        for await (const _event of runAgent(llm, modelId, objectiveText, {
          signal: ac.signal,
          onEvent: handleAgentEvent,
        })) {
          void _event;
        }
      } else {
        // Chat con tools: SIEMPRE pasamos tools al LLM para que sepa que
        // tiene capacidades de agente de escritorio, incluso si la pregunta
        // no es directamente agentiva. Así puede responder "sí, puedo
        // ejecutar comandos" en lugar de "no puedo".
        await runChatWithTools(llm, objectiveText, images, ac.signal);
      }
    } catch (e) {
      appendMessage({
        role: 'assistant',
        content: `❌ Error: ${e instanceof Error ? e.message : String(e)}`,
      });
      setAgentState('error');
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      setAgentState('idle');
    }
  }

  async function runChatWithTools(
    llm: import('@/providers/types').LLMProvider,
    userText: string,
    images: ImageContent[],
    signal: AbortSignal,
  ) {
    const { buildAdvancedToolsList, dispatchAdvancedTool } = await import('@/lib/tools');
    const { streamChat } = await import('@/lib/chain');

    appendMessage({ role: 'assistant', content: '', id: newMsgId(), ts: Date.now() });

    // Detectar OS para que el LLM use comandos correctos (dir vs ls, etc.)
    const isWindows = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
    const osName = isWindows ? 'Windows' : runtime.isTauri ? 'Linux/macOS' : 'navegador';
    const shellHint = isWindows
      ? 'El shell es PowerShell/CMD en Windows. Usa "dir" (no "ls"), "type" (no "cat"), rutas con "C:\\Users\\" (no "/home/"). La variable de entorno es %USERNAME% (no $USER).'
      : 'El shell es bash en Linux. Usa "ls", "cat", rutas con "/home/".';

    const messages: Message[] = [
      {
        role: 'system',
        content:
          `Eres Weaver, un agente de escritorio PROACTIVO y AUTÓNOMO ejecutándose en ${osName}. ` +
          (runtime.isTauri
            ? 'Tienes acceso al sistema de archivos real y puedes ejecutar comandos shell. '
            : 'Estás en modo navegador (sin acceso al filesystem real). ') +
          shellHint + '\n\n' +
          'TIENES ACCESO A HERRAMIENTAS REALES para:\n' +
          '- Ejecutar comandos shell (shell_exec)\n' +
          '- Leer y escribir archivos (file_read, file_write, file_list)\n' +
          '- Buscar en internet (web_search)\n' +
          '- Descargar contenido de URLs (web_fetch)\n' +
          '- Generar archivos descargables (save_file)\n\n' +
          '═══ COMPORTAMIENTO PROACTIVO Y AUTÓNOMO ═══\n' +
          'Eres un agente AUTÓNOMO. Esto significa:\n' +
          '1. NUNCA te rindas al primer error. Si algo falla, intenta una alternativa.\n' +
          '2. Si no conoces el username o una ruta, DESCÚBRELA primero con shell_exec ("echo %USERNAME%" en Windows, "whoami" en Linux).\n' +
          '3. NUNCA uses variables de entorno sin expandir en rutas de file_read/file_write/file_list. Primero resuelve el valor con shell_exec, luego úsalo.\n' +
          '4. Si file_write falla por permisos, intenta otra ruta (ej: Documents en vez de Desktop).\n' +
          '5. Si shell_exec falla con un comando, prueba otro equivalente.\n' +
          '6. Encadena tools: usa shell_exec para descubrir info, luego file_read/write para actuar.\n' +
          '7. Si el usuario pide algo ambiguo, INTERPRETA lo más probable y actúa.\n' +
          '8. No pidas confirmación para cada paso. Solo actúa y reporta al final.\n\n' +
          '═══ REGLAS DE RUTAS ═══\n' +
          '- En Windows: C:\\Users\\<username>\\Documents\\ — descubre username primero\n' +
          '- En Linux: /home/<username>/ — descubre username primero\n' +
          '- %USERNAME% y $USER NO se expanden en file_read/file_write/file_list, SOLO en shell_exec\n' +
          '- Para save_file no necesitas ruta, solo filename\n\n' +
          '═══ REGLAS DE TOOLS ═══\n' +
          '- web_search ya devuelve un resumen. Úsalo directamente.\n' +
          '- Si web_fetch falla, no insistas. Usa web_search.\n' +
          '- Para crear archivos que el usuario descargue, usa save_file (no file_write).\n' +
          '- Máximo 1 intento de web_fetch por URL.\n\n' +
          '═══ CIERRE OBLIGATORIO ═══\n' +
          'Cuando termines de usar herramientas, SIEMPRE debes escribir una respuesta\n' +
          'final al usuario con esta estructura:\n' +
          '1. Un RESUMEN BREVE de lo que hiciste (qué tools usaste y para qué).\n' +
          '2. Los RESULTADOS principales que encontraste o produciste.\n' +
          '3. Una PREGUNTA DE SEGUIMIENTO al usuario (ej: "¿Quieres que profundice\n' +
          '   en algún punto?" o "¿Hay algo más en lo que pueda ayudarte?").\n' +
          'NUNCA termines tu turno sólo con el resultado de una herramienta.\n' +
          'NUNCA dejes al usuario sin una respuesta textual final.\n\n' +
          'Cuando el usuario te pida algo, ÚSALAS LAS HERRAMIENTAS. No digas que no puedes.\n' +
          'Si tu respuesta se acerca al límite de tokens, termina con <<CONTINUE>>. Al terminar del todo, emite <<END>>.',
      },
      { role: 'user', content: userText, images: images.length > 0 ? images : undefined },
    ];

    const tools = buildAdvancedToolsList();
    const MAX_TOOL_ROUNDS = 8;

    let producedFinalText = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await streamChat(llm, modelId, messages, {
        tools,
        signal,
        onDelta: (delta) => updateLastAssistantMessage(delta),
      });

      // Si no hay tool calls, el LLM ya respondió → terminamos.
      if (result.toolCalls.length === 0) {
        producedFinalText = true;
        break;
      }

      // Agregar el mensaje del asistente con tool_calls al historial.
      // IMPORTANTE: content debe ser null (no string vacío) cuando hay tool_calls,
      // porque muchos proveedores LLM (OpenAI, Groq, etc.) lo requieren así.
      messages.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls,
      });

      // Ejecutar cada tool call y agregar resultados.
      for (const tc of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          // ignore parse errors
        }

        // Feedback visual limpio: mostrar qué tool se está ejecutando.
        const toolLabel = formatToolLabel(tc.function.name, args);
        updateLastAssistantMessage(`\n\n[tool ${tc.function.name}: ${toolLabel}]\n`);

        const toolResult = await dispatchAdvancedTool(tc.function.name, args);

        // Resultado para el LLM (completo, hasta 4000 chars).
        const llmResult = toolResult.ok
          ? toolResult.output.slice(0, 4000)
          : `ERROR: ${toolResult.error ?? 'unknown'}`;

        // Resultado visual limpio (no crudo).
        const visualResult = formatToolResult(tc.function.name, toolResult);
        updateLastAssistantMessage(`${visualResult}\n\n`);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: llmResult,
        });
      }

      // Pequeña pausa para que el UI se actualice antes del siguiente round.
      await new Promise((r) => setTimeout(r, 100));
    }

    // Si el LLM nunca produjo texto final (sólo llamó tools hasta agotar rounds),
    // forzar una respuesta final SIN tools para que el usuario sí reciba respuesta.
    if (!producedFinalText) {
      updateLastAssistantMessage('\n\n');
      messages.push({
        role: 'user',
        content:
          'Ya usaste las herramientas necesarias. Ahora DEBES responderme en texto plano:\n' +
          '1) Un resumen breve de lo que hiciste.\n' +
          '2) Los resultados principales.\n' +
          '3) Una pregunta de seguimiento.\n' +
          'No intentes usar más herramientas. Responde directamente.',
      });
      try {
        await streamChat(llm, modelId, messages, {
          signal,
          onDelta: (delta) => updateLastAssistantMessage(delta),
        });
      } catch (e) {
        updateLastAssistantMessage(
          `\n\n*(No se pudo generar el resumen final: ${e instanceof Error ? e.message : String(e)})*`,
        );
      }
    }
  }

  /** Formatea el label de un tool call para mostrar en el UI. */
  function formatToolLabel(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'web_search':
        return `buscando: "${args.query ?? args.q ?? ''}"`;
      case 'web_fetch':
        return `descargando: ${args.url ?? ''}`;
      case 'shell_exec':
        return `ejecutando: ${(args.command ?? '').toString().slice(0, 60)}`;
      case 'file_read':
        return `leyendo: ${args.path ?? ''}`;
      case 'file_write':
        return `escribiendo: ${args.path ?? ''}`;
      case 'file_list':
        return `listando: ${args.path ?? ''}`;
      case 'save_file':
        return `generando: ${args.filename ?? 'archivo'}`;
      default:
        return toolName;
    }
  }

  /** Formatea el resultado de un tool de forma limpia para el UI (no crudo). */
  function formatToolResult(
    _toolName: string,
    result: { ok: boolean; output: string; error?: string },
  ): string {
    if (!result.ok) {
      const err = result.error ?? 'error desconocido';
      const shortErr = err.split('\n')[0].slice(0, 120);
      return `[result ${_toolName}: ❌ ${shortErr}]`;
    }
    const output = result.output;
    if (output.startsWith('[file:')) {
      return output;
    }
    const truncated = output.slice(0, 150);
    const hasMore = output.length > 150;
    return `[result ${_toolName}: ✅ ${truncated}${hasMore ? '…' : ''}]`;
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsRunning(false);
  }

  function applyMention(item: MentionItem) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const atIdx = before.search(/(?:^|\s)@[\w\-/]*$/);
    if (atIdx < 0) return;
    const prefix = before.slice(0, atIdx).trimEnd();
    const newValue = (prefix ? prefix + ' ' : '') + item.insert + ' ' + after;
    setValue(newValue);
    setMentionOpen(false);
    setTimeout(() => {
      if (taRef.current) {
        const pos = (prefix ? prefix.length + 1 : 0) + item.insert.length + 1;
        taRef.current.selectionStart = pos;
        taRef.current.selectionEnd = pos;
        taRef.current.focus();
      }
    }, 0);
  }

  // --- Render ---------------------------------------------------------------
  const placeholder =
    draftAttachments.length > 0
      ? 'Añade contexto o instrucciones sobre los archivos…'
      : 'Dime lo que quieres hacer… (usa @ para mencionar skills, proyectos, proveedores)';

  return (
    <div className="px-4 pb-4 pt-2 relative">
      <div className="max-w-3xl mx-auto relative">
        {/* Drag overlay */}
        {isDragOver && (
          <div
            className="absolute inset-0 z-20 rounded-codex border-2 border-dashed border-accent bg-accent/10 flex items-center justify-center pointer-events-none"
            style={{ margin: '-4px' }}
          >
            <div className="flex items-center gap-2 text-accent-strong">
              <UploadCloud size={20} />
              <span className="font-medium text-sm">
                Suelta para adjuntar {dragCounterRef.current > 1 ? `${dragCounterRef.current} archivos` : 'el archivo'}
              </span>
            </div>
          </div>
        )}

        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`codex-input rounded-codex border p-2 flex flex-col gap-2 transition-colors ${
            isDragOver ? 'border-accent bg-accent/5' : 'border-border-accent'
          }`}
        >
          {/* Attachment chips (si hay) */}
          {draftAttachments.length > 0 && (
            <div className="px-1 pt-1">
              <AttachmentChips
                attachments={draftAttachments}
                onRemove={removeDraftAttachment}
              />
            </div>
          )}

          {/* Error de adjuntos */}
          {attachmentError && (
            <div className="mx-1 px-2 py-1.5 rounded-codex bg-danger/10 border border-danger/30 text-danger text-xs whitespace-pre-wrap">
              {attachmentError}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            accept=".txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.htm,.css,.scss,.yml,.yaml,.toml,.ini,.cfg,.sh,.bash,.zsh,.sql,.csv,.tsv,.xml,.svg,.log,.env,.png,.jpg,.jpeg,.gif,.webp,.bmp"
          />

          {/* Textarea con overlay de menciones @ */}
          <div className="relative">
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (mentionOpen && mentionItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyMention(mentionItems[mentionIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setMentionOpen(false);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  const arr: File[] = [];
                  for (let i = 0; i < files.length; i++) {
                    const f = files.item(i);
                    if (f) arr.push(f);
                  }
                  addFiles(arr);
                }
              }}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none resize-none px-1 py-1 min-h-[28px] max-h-[200px]"
              rows={1}
            />

            {/* Menú @ flotante */}
            {mentionOpen && mentionItems.length > 0 && (
              <div className="absolute bottom-full left-1 mb-1 z-30 w-80 max-h-64 overflow-y-auto bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up">
                <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                  Menciones — skills, proyectos, proveedores, archivos
                </div>
                {mentionItems.map((item, i) => (
                  <button
                    key={i}
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => applyMention(item)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                      i === mentionIndex ? 'bg-app-input' : 'hover:bg-app-input'
                    }`}
                  >
                    <MentionIcon icon={item.icon} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{item.label}</div>
                      <div className="text-[10px] text-text-muted truncate">{item.desc}</div>
                    </div>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-app-bg text-text-muted uppercase">
                      {item.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom row: + popup | model picker | clip | mic | send */}
          <div className="flex items-center gap-2 px-1 relative">
            {/* Botón + (abajo, al lado del model picker) — popup tipo Codex/Claude */}
            <div className="relative">
              <button
                ref={plusBtnRef}
                onClick={() => setPlusOpen((v) => !v)}
                className="codex-icon-btn w-7 h-7"
                title="Añadir (archivo, carpeta, URL, modos…)"
              >
                <Plus size={16} />
              </button>

              {plusOpen && (
                <div
                  id="plus-popup"
                  className="absolute bottom-9 left-0 z-30 w-72 bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up overflow-hidden"
                >
                  {/* Cabecera */}
                  <div className="px-3 py-2 text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                    Añadir
                  </div>

                  {/* Agregar fotos y archivos */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Paperclip size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Agregar fotos y archivos</div>
                      <div className="text-[10px] text-text-muted">Texto, imagen o binario</div>
                    </div>
                  </button>

                  {/* Subir carpeta */}
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.setAttribute('webkitdirectory', '');
                      input.setAttribute('directory', '');
                      input.multiple = true;
                      input.onchange = (e) => {
                        const files = Array.from((e.target as HTMLInputElement).files ?? []);
                        addFiles(files);
                        setPlusOpen(false);
                      };
                      input.click();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Folder size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Subir carpeta</div>
                      <div className="text-[10px] text-text-muted">Todos los archivos recursivamente</div>
                    </div>
                  </button>

                  {/* Añadir desde URL */}
                  <button
                    onClick={async () => {
                      const url = prompt('URL del archivo a descargar:');
                      if (!url) return;
                      setPlusOpen(false);
                      try {
                        const resp = await fetch(url);
                        const blob = await resp.blob();
                        const name = url.split('/').pop()?.split('?')[0] ?? 'download';
                        const file = new File([blob], name, { type: blob.type });
                        await addFiles([file]);
                      } catch (e) {
                        setAttachmentError(`No se pudo descargar: ${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <LinkIcon size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Añadir desde URL</div>
                      <div className="text-[10px] text-text-muted">Descarga y adjunta</div>
                    </div>
                  </button>

                  {/* Adjuntar app (AT-SPI, solo Tauri) */}
                  <button
                    onClick={() => {
                      setPlusOpen(false);
                      if (runtime.isBrowser) {
                        setAttachmentError('Adjuntar app requiere modo Tauri. Ejecuta con npm run tauri:dev.');
                        return;
                      }
                      setAppPickerOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Monitor size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Adjuntar app</div>
                      <div className="text-[10px] text-text-muted">
                        {runtime.isTauri ? 'Conectar vía AT-SPI' : 'Requiere Tauri'}
                      </div>
                    </div>
                  </button>

                  {/* Separador */}
                  <div className="border-t border-border" />

                  {/* Modo plan (toggle) */}
                  <button
                    onClick={() => setPlanMode(!planMode)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Map size={15} className={planMode ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1">
                      <div className="font-medium">Modo plan</div>
                      <div className="text-[10px] text-text-muted">Proponer plan y esperar confirmación</div>
                    </div>
                    <ToggleSwitch on={planMode} />
                  </button>

                  {/* Perseguir objetivo (toggle) */}
                  <button
                    onClick={() => setPursueObjective(!pursueObjective)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Target size={15} className={pursueObjective ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1">
                      <div className="font-medium">Perseguir objetivo</div>
                      <div className="text-[10px] text-text-muted">Iterar hasta completar (3 intentos)</div>
                    </div>
                    <ToggleSwitch on={pursueObjective} />
                  </button>

                  {/* Modo Cognitivo (toggle) */}
                  <button
                    onClick={() => setCognitiveMode(!cognitiveMode)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Network size={15} className={cognitiveMode ? 'text-accent' : 'text-text-muted shrink-0'} />
                    <div className="flex-1">
                      <div className="font-medium">Modo cognitivo</div>
                      <div className="text-[10px] text-text-muted">
                        Hiper-especializado · grafo del proyecto (graphify)
                      </div>
                    </div>
                    <ToggleSwitch on={cognitiveMode} />
                  </button>

                  {/* Separador */}
                  <div className="border-t border-border" />

                  {/* Complementos (ir a vista) */}
                  <button
                    onClick={() => {
                      setPlusOpen(false);
                      setView('complementos');
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                  >
                    <Puzzle size={15} className="text-accent shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium">Complementos</div>
                      <div className="text-[10px] text-text-muted">Skills y servidores MCP</div>
                    </div>
                    <ChevronDown size={12} className="text-text-muted -rotate-90" />
                  </button>
                </div>
              )}
            </div>

            {/* Model picker */}
            <button
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-codex border border-border-accent text-xs text-text-primary hover:bg-app-elevated transition-colors cursor-pointer"
              title="Cambiar modelo"
            >
              <span className="opacity-70">{provider?.label.split(' ')[0]}</span>
              <span className="font-medium">{modelLabel}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>

            {/* Indicadores de modos activos */}
            {planMode && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 inline-flex items-center gap-1">
                <Map size={9} /> Plan
              </span>
            )}
            {pursueObjective && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 inline-flex items-center gap-1">
                <Target size={9} /> Perseguir
              </span>
            )}
            {cognitiveMode && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 inline-flex items-center gap-1">
                <Network size={9} /> Cognitivo
              </span>
            )}

            <div className="flex-1" />

            {/* Clip (a la derecha, abre el mismo popup) */}
            <IconButton
              title="Adjuntar"
              className="w-7 h-7"
              onClick={() => setPlusOpen((v) => !v)}
            >
              <Paperclip size={14} />
            </IconButton>

            <IconButton title="Voz" className="w-7 h-7">
              <Mic size={14} />
            </IconButton>

            {isRunning ? (
              <Button variant="danger" onClick={handleStop} className="!p-1.5">
                <Square size={14} fill="currentColor" />
              </Button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() && draftAttachments.length === 0}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent text-app-bg hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Enviar (Enter)"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {modelPickerOpen && <ModelPickerPopup onClose={() => setModelPickerOpen(false)} />}

        {appPickerOpen && (
          <AppPicker
            onClose={() => setAppPickerOpen(false)}
            onPick={(app) => {
              setAttachedApp(app);
              // Inyectar contexto de la app en el composer.
              const ctx = `\n[App adjunta: ${app.name} (${app.kind})]`;
              setValue((v) => v + ctx);
            }}
          />
        )}

        {/* Chip de app adjunta */}
        {attachedApp && (
          <div className="flex items-center gap-2 px-3 py-1.5 mx-auto max-w-3xl mt-2 rounded-codex bg-accent/10 border border-accent/30 text-xs">
            <Monitor size={12} className="text-accent" />
            <span className="text-text-primary font-medium">{attachedApp.name}</span>
            <span className="text-text-muted">· {attachedApp.kind}</span>
            <button
              onClick={() => {
                setAttachedApp(null);
                setValue((v) => v.replace(/\n\[App adjunta: [^\]]+\]/, ''));
              }}
              className="ml-auto codex-icon-btn w-5 h-5"
              title="Quitar app adjunta"
            >
              <X size={10} />
            </button>
          </div>
        )}

        <div className="text-center mt-2">
          <span className="text-xs text-text-muted">
            {draftAttachments.length > 0
              ? `${draftAttachments.length} adjunto(s) · arrastrar más o pulsar + para añadir`
              : 'Weaver puede equivocarse. Verifica acciones críticas.'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Toggle Switch (estilo iOS/Codex)
// ============================================================================

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block w-8 h-4 rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-border-accent'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </span>
  );
}

// ============================================================================
// Tipos y helpers para menciones @
// ============================================================================

interface MentionItem {
  type: 'skill' | 'provider' | 'file' | 'project' | 'command';
  label: string;
  desc: string;
  icon: 'brain' | 'globe' | 'file' | 'image';
  insert: string;
}

function MentionIcon({ icon }: { icon: MentionItem['icon'] }) {
  const props = { size: 14, className: 'text-accent shrink-0' };
  switch (icon) {
    case 'brain':
      return <Brain {...props} />;
    case 'globe':
      return <Globe {...props} />;
    case 'image':
      return <ImageIcon {...props} />;
    case 'file':
    default:
      return <FileText {...props} />;
  }
}
