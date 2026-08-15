/**
 * RLM-1 — Tests de las tools de contexto (ctx_set/get/list/delete/clear,
 * file_view_lines/structure/symbols, spawn_child_agent).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildContextTools, dispatchContextTool } from '../rlm/contextTools';
import { ContextStore } from '../rlm/contextStore';

// Mock dispatchAdvancedTool para file_view_*
vi.mock('@/lib/tools', () => ({
  dispatchAdvancedTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'file_read') {
      const path = String(args.path);
      if (path === '/fake/empty.ts') return { ok: true, output: '', error: undefined };
      if (path === '/fake/error') return { ok: false, output: '', error: 'File not found' };
      // Simular un archivo con 100 líneas.
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      return { ok: true, output: lines.join('\n'), error: undefined };
    }
    return { ok: false, output: '', error: 'Unknown tool' };
  }),
}));

describe('Context Tools definitions', () => {
  it('builds all context tools', () => {
    const tools = buildContextTools();
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('ctx_set');
    expect(names).toContain('ctx_get');
    expect(names).toContain('ctx_list');
    expect(names).toContain('ctx_delete');
    expect(names).toContain('ctx_clear');
    expect(names).toContain('file_view_lines');
    expect(names).toContain('file_view_structure');
    expect(names).toContain('file_view_symbols');
    expect(names).toContain('spawn_child_agent');
  });
});

describe('ctx_set / ctx_get', () => {
  let store: ContextStore;
  beforeEach(() => { store = new ContextStore(); });

  it('ctx_set saves a fragment', async () => {
    const result = await dispatchContextTool('ctx_set', {
      key: 'test-key',
      content: 'hello',
      source: 'manual',
    }, store);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('test-key');
    expect(store.get('test-key')?.content).toBe('hello');
  });

  it('ctx_set requires key and content', async () => {
    const result = await dispatchContextTool('ctx_set', { key: '', content: '' }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('key y content');
  });

  it('ctx_get returns the fragment content', async () => {
    store.set('mykey', 'my content', 'manual');
    const result = await dispatchContextTool('ctx_get', { key: 'mykey' }, store);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('my content');
  });

  it('ctx_get returns error for unknown key', async () => {
    const result = await dispatchContextTool('ctx_get', { key: 'nonexistent' }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('nonexistent');
  });
});

describe('ctx_list', () => {
  let store: ContextStore;
  beforeEach(() => { store = new ContextStore(); });

  it('lists empty store', async () => {
    const result = await dispatchContextTool('ctx_list', {}, store);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('vacío');
  });

  it('lists fragments without content', async () => {
    store.set('key1', 'content1', 'manual');
    store.set('key2', 'content2', 'file_view_lines', { file: '/tmp/test.ts' });
    const result = await dispatchContextTool('ctx_list', {}, store);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('key1');
    expect(result.output).toContain('key2');
    expect(result.output).not.toContain('content1');
    expect(result.output).toContain('file_view_lines');
  });
});

describe('ctx_delete / ctx_clear', () => {
  let store: ContextStore;
  beforeEach(() => {
    store = new ContextStore();
    store.set('key1', 'a', 'manual');
    store.set('key2', 'b', 'manual');
  });

  it('ctx_delete removes a fragment', async () => {
    const result = await dispatchContextTool('ctx_delete', { key: 'key1' }, store);
    expect(result.ok).toBe(true);
    expect(store.count()).toBe(1);
    expect(store.get('key1')).toBeUndefined();
  });

  it('ctx_delete returns error for unknown key', async () => {
    const result = await dispatchContextTool('ctx_delete', { key: 'unknown' }, store);
    expect(result.ok).toBe(false);
  });

  it('ctx_clear removes all fragments', async () => {
    const result = await dispatchContextTool('ctx_clear', {}, store);
    expect(result.ok).toBe(true);
    expect(store.count()).toBe(0);
    expect(result.output).toContain('2 fragmentos eliminados');
  });
});

describe('file_view_lines', () => {
  let store: ContextStore;
  beforeEach(() => { store = new ContextStore(); });

  it('returns specific lines from a file', async () => {
    const result = await dispatchContextTool('file_view_lines', {
      path: '/fake/test.ts',
      startLine: 5,
      endLine: 8,
    }, store);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('5: line 5');
    expect(result.output).toContain('8: line 8');
    expect(result.output).not.toContain('line 4');
    expect(result.output).not.toContain('line 9');
  });

  it('requires path', async () => {
    const result = await dispatchContextTool('file_view_lines', {
      startLine: 1,
      endLine: 5,
    }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('path');
  });

  it('handles file_read error', async () => {
    const result = await dispatchContextTool('file_view_lines', {
      path: '/fake/error',
      startLine: 1,
      endLine: 5,
    }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('File not found');
  });
});

describe('file_view_structure', () => {
  let store: ContextStore;
  beforeEach(() => { store = new ContextStore(); });

  it('extracts structure from a file', async () => {
    const result = await dispatchContextTool('file_view_structure', {
      path: '/fake/test.ts',
    }, store);
    expect(result.ok).toBe(true);
  });
});

describe('file_view_symbols', () => {
  let store: ContextStore;
  beforeEach(() => { store = new ContextStore(); });

  it('rejects non-TS/JS files', async () => {
    const result = await dispatchContextTool('file_view_symbols', {
      path: '/fake/test.md',
    }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('.ts');
  });

  it('extracts symbols from a TS file', async () => {
    // Override mock to return a file with exports.
    const { dispatchAdvancedTool } = await import('@/lib/tools');
    (dispatchAdvancedTool as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      output: [
        'export function foo() { return 1; }',
        'export class Bar { method() {} }',
        'export const baz = 42;',
        'export interface IBaz { x: number }',
        'function privateFn() {}',
      ].join('\n'),
      error: undefined,
    });

    const result = await dispatchContextTool('file_view_symbols', {
      path: '/fake/test.ts',
    }, store);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('foo');
    expect(result.output).toContain('Bar');
    expect(result.output).toContain('baz');
    expect(result.output).toContain('IBaz');
  });
});

describe('spawn_child_agent', () => {
  let store: ContextStore;
  beforeEach(() => { store = new ContextStore(); });

  it('returns error when spawnChildAgent not provided', async () => {
    const result = await dispatchContextTool('spawn_child_agent', {
      objective: 'test',
    }, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no disponible');
  });

  it('calls spawnChildAgent when provided', async () => {
    const spawnFn = vi.fn(async () => ({
      status: 'succeeded',
      result: 'subagent result',
      usage: { inputTokens: 100, outputTokens: 50, steps: 3, elapsedMs: 1000 },
    }));
    const result = await dispatchContextTool('spawn_child_agent', {
      objective: 'do the thing',
      subagentName: 'Web Researcher',
      context: 'some context',
      maxSteps: 5,
    }, store, spawnFn);
    expect(result.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith('do the thing', 'Web Researcher', 'some context', { maxSteps: 5, maxTokens: 8000, maxTimeMs: 90_000 });
    expect(result.output).toContain('succeeded');
    expect(result.output).toContain('subagent result');
  });

  it('returns error when objective is missing', async () => {
    const spawnFn = vi.fn();
    const result = await dispatchContextTool('spawn_child_agent', {}, store, spawnFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('objective');
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('unknown tool', () => {
  it('returns error for unknown tool name', async () => {
    const store = new ContextStore();
    const result = await dispatchContextTool('unknown_tool', {}, store);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown_tool');
  });
});
