import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Zap,
  Webhook,
  Clock,
  Code2,
  GitBranch,
  Timer,
  ListPlus,
  MessageSquare,
  Globe,
  Repeat,
  SplitSquareHorizontal,
  Filter as FilterIcon,
  ArrowDownUp,
  Crop,
  Layers,
  Merge as MergeIcon,
  Network,
  Brain,
  Bot,
  Braces,
  Database,
  Wrench,
  Hand,
  Shuffle,
} from 'lucide-react';
import type { WorkflowNodeType } from './types';

export const NODE_META: Record<
  WorkflowNodeType,
  { icon: typeof Webhook; color: string; bg: string }
> = {
  webhook: { icon: Webhook, color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  schedule: { icon: Clock, color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  manual: { icon: Hand, color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  code: { icon: Code2, color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  if: { icon: GitBranch, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  switch: { icon: Shuffle, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  filter: { icon: FilterIcon, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  delay: { icon: Timer, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  set: { icon: ListPlus, color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  chat_message: { icon: MessageSquare, color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  http_request: { icon: Globe, color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  loop: { icon: Repeat, color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  split: { icon: SplitSquareHorizontal, color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  merge: { icon: MergeIcon, color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  aggregate: { icon: Layers, color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  sort: { icon: ArrowDownUp, color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  limit: { icon: Crop, color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  execute_workflow: { icon: Network, color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  llm: { icon: Brain, color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  ai_agent: { icon: Bot, color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  structured_output: { icon: Braces, color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  memory: { icon: Database, color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  tool: { icon: Wrench, color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
};

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: WorkflowNodeType;
  configSummary?: string;
  status?: 'idle' | 'ok' | 'error' | 'running';
}

const STATUS_RING: Record<NonNullable<WorkflowNodeData['status']>, string> = {
  idle: 'transparent',
  running: '#facc15',
  ok: '#22c55e',
  error: '#ef4444',
};

/**
 * Tarjeta de nodo estilo n8n+: tile de icono grande con color de categoría,
 * badge "Trigger" flotante sobre el borde, resumen de config, anillo de
 * estado (running/ok/error) y etiquetas true/false fuera del nodo en el IF.
 */
function WorkflowNodeCard({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const meta = NODE_META[d.nodeType];
  const Icon = meta.icon;
  const isTrigger = d.nodeType === 'webhook' || d.nodeType === 'schedule' || d.nodeType === 'manual';
  const isIf = d.nodeType === 'if';
  const status = d.status ?? 'idle';
  const ring = STATUS_RING[status];

  const shadows = [
    ring !== 'transparent' ? `0 0 0 2px ${ring}` : '',
    selected ? `0 0 0 4px ${meta.color}30, 0 10px 28px rgba(0,0,0,0.4)` : '',
  ].filter(Boolean).join(', ');

  return (
    <div
      className={`relative rounded-xl border bg-app-elevated px-3 py-3 min-w-[200px] max-w-[240px] transition-shadow ${status === 'running' ? 'animate-pulse' : ''}`}
      style={{
        borderRadius: 12,
        borderColor: selected ? meta.color : 'var(--border)',
        boxShadow: shadows || undefined,
      }}
    >
      {isTrigger && (
        <span
          className="absolute -top-2.5 left-3 h-[18px] px-1.5 inline-flex items-center gap-1 rounded-full text-[8.5px] font-bold tracking-wider uppercase"
          style={{ background: 'var(--bg-app)', color: meta.color, border: `1px solid ${meta.color}66` }}
        >
          <Zap size={8} strokeWidth={2.5} /> Trigger
        </span>
      )}

      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: meta.color, width: 9, height: 9, border: '2px solid var(--bg-app)' }}
        />
      )}

      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
          style={{ background: meta.bg, color: meta.color, borderColor: `${meta.color}40` }}
        >
          <Icon size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-text-primary leading-tight truncate">{d.label}</div>
          <div className="text-[10.5px] text-text-muted truncate mt-0.5">{d.configSummary || WORKFLOW_TYPE_LABEL[d.nodeType]}</div>
        </div>
      </div>

      {isIf ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ background: '#22c55e', width: 9, height: 9, top: '35%', border: '2px solid var(--bg-app)' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ background: '#ef4444', width: 9, height: 9, top: '65%', border: '2px solid var(--bg-app)' }}
          />
          {/* Etiquetas fuera del nodo, junto a cada handle (estilo n8n). */}
          <span
            className="absolute text-[8px] font-bold uppercase tracking-wide text-success"
            style={{ left: '100%', marginLeft: 6, top: '35%', transform: 'translateY(-50%)' }}
          >
            true
          </span>
          <span
            className="absolute text-[8px] font-bold uppercase tracking-wide text-danger"
            style={{ left: '100%', marginLeft: 6, top: '65%', transform: 'translateY(-50%)' }}
          >
            false
          </span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: meta.color, width: 9, height: 9, border: '2px solid var(--bg-app)' }}
        />
      )}
    </div>
  );
}

const WORKFLOW_TYPE_LABEL: Record<WorkflowNodeType, string> = {
  webhook: 'Trigger',
  schedule: 'Trigger',
  manual: 'Trigger manual',
  code: 'Ejecuta código',
  if: 'Condicional',
  switch: 'Switch multi-rama',
  filter: 'Filtra items',
  delay: 'Espera',
  set: 'Asigna campos',
  chat_message: 'Mensaje',
  http_request: 'Petición HTTP',
  loop: 'Itera items',
  split: 'Divide array',
  merge: 'Combina ramas',
  aggregate: 'Agrega a array',
  sort: 'Ordena items',
  limit: 'Limita items',
  execute_workflow: 'Sub-workflow',
  llm: 'LLM call',
  ai_agent: 'AI Agent',
  structured_output: 'Output estructurado',
  memory: 'Memoria',
  tool: 'Tool call',
};

export const nodeTypes = {
  workflowNode: memo(WorkflowNodeCard),
};

/** Genera un resumen corto de la config para mostrar bajo el label del nodo. */
export function summarizeConfig(nodeType: WorkflowNodeType, config: Record<string, unknown>): string {
  switch (nodeType) {
    case 'webhook':
      return String(config.path ?? '/webhook');
    case 'schedule':
      return config.cronExpr ? String(config.cronExpr) : `${config.time ?? '--:--'} · ${config.recurrence ?? 'once'}`;
    case 'manual':
      return 'Click para ejecutar';
    case 'code':
      return String(config.language ?? 'javascript');
    case 'if':
      return config.expression ? String(config.expression).slice(0, 40) : `${config.field ?? '?'} ${config.operator ?? 'eq'} ${config.value ?? ''}`;
    case 'switch': {
      const cases = (config.cases as Array<{ label: string }>) ?? [];
      return cases.length ? `${cases.length} casos` : 'sin casos';
    }
    case 'filter':
      return String(config.expression ?? '').slice(0, 40) || '(sin expr)';
    case 'delay':
      return `${config.ms ?? 1000}ms`;
    case 'set': {
      const fields = (config.fields as Array<{ key: string }>) ?? [];
      return fields.length ? fields.map((f) => f.key).join(', ') : 'sin campos';
    }
    case 'chat_message':
      return String(config.message ?? '').slice(0, 40) || '(vacío)';
    case 'http_request':
      return `${config.method ?? 'GET'} ${String(config.url ?? '').slice(0, 30)}`;
    case 'loop':
      return config.itemsExpression ? String(config.itemsExpression).slice(0, 30) : 'itera input';
    case 'split':
      return 'divide array';
    case 'merge':
      return String(config.mode ?? 'append');
    case 'aggregate':
      return `→ ${config.field ?? 'items'}`;
    case 'sort':
      return `${config.order ?? 'asc'} ${config.keyExpression ? String(config.keyExpression).slice(0, 20) : ''}`;
    case 'limit':
      return `top ${config.limit ?? 10}`;
    case 'execute_workflow':
      return config.workflowName ? String(config.workflowName) : String(config.workflowId ?? '').slice(0, 12);
    case 'llm':
      return String(config.modelId ?? 'default');
    case 'ai_agent':
      return String(config.modelId ?? 'default');
    case 'structured_output':
      return 'JSON schema';
    case 'memory':
      return String(config.action ?? 'save_fact');
    case 'tool':
      return 'tool call';
    default:
      return '';
  }
}
