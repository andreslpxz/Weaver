/**
 * Motor de ejecución de Workflows.
 *
 * FASE 7 — Delegación a engine v2.
 *
 * El engine v0 (BFS con visited Set) está deprecated. Esta función
 * mantiene la API pública (runWorkflow → WorkflowRun) pero internamente
 * usa el engine v2 (basado en ExecutionItem[] + NodeRegistry).
 *
 * Para acceder a la API completa de v2, importar directamente:
 *   import { runWorkflowV2 } from './engine/v2/engine';
 */

import type {
  Workflow,
  WorkflowRun,
  WorkflowRunLogEntry,
} from './types';
import { runWorkflowV2 } from './engine/v2/engine';

export type ExecContext = Record<string, unknown>;

export interface RunOptions {
  /** Nodo desde el que arrancar (ejecución manual de un solo nodo hacia adelante). Si se omite, corre desde todos los triggers. */
  startNodeId?: string;
  onLog?: (entry: WorkflowRunLogEntry) => void;
}

/**
 * Ejecuta un workflow y devuelve un WorkflowRun (compatibilidad v0).
 * Internamente usa el engine v2 (Execution / ExecutionItem[]).
 */
export async function runWorkflow(wf: Workflow, opts: RunOptions = {}): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    status: 'running',
    log: [],
  };

  try {
    const execution = await runWorkflowV2(wf, {
      mode: 'manual',
      startNodeId: opts.startNodeId,
      onLog: (entry) => {
        const logEntry: WorkflowRunLogEntry = {
          ts: entry.ts,
          nodeId: entry.nodeId,
          nodeLabel: entry.nodeLabel,
          status: entry.status,
          output: entry.output,
          error: entry.error,
        };
        run.log.push(logEntry);
        opts.onLog?.(logEntry);
      },
    });

    run.status =
      execution.status === 'success' ? 'success' :
      execution.status === 'cancelled' || execution.status === 'timeout' ? 'error' :
      execution.status === 'failed' ? 'error' : 'success';
    run.finishedAt = Date.now();

    if (execution.error && run.status === 'error') {
      run.log.push({
        ts: Date.now(),
        nodeId: '',
        nodeLabel: '(engine)',
        status: 'error',
        error: execution.error.message,
      });
    }
  } catch (e) {
    run.status = 'error';
    run.finishedAt = Date.now();
    run.log.push({
      ts: Date.now(),
      nodeId: '',
      nodeLabel: '(engine)',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return run;
}
