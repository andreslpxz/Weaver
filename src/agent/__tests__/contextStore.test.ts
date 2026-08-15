/**
 * RLM-1 / RLM-5 — Tests del ContextStore.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextStore, createContextStore, forkCleanContextStore, summarizeTraceForPrompt } from '../rlm/contextStore';
import type { TraceStep } from '../types';

describe('ContextStore', () => {
  let store: ContextStore;

  beforeEach(() => {
    store = createContextStore();
  });

  it('starts empty', () => {
    expect(store.count()).toBe(0);
    expect(store.totalSize()).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('set + get a fragment', () => {
    store.set('user file:1-10', 'hello world', 'file_view_lines', { file: '/tmp/test.ts', startLine: 1, endLine: 10 });
    expect(store.count()).toBe(1);
    const fragment = store.get('user file:1-10');
    expect(fragment).toBeDefined();
    expect(fragment?.content).toBe('hello world');
    expect(fragment?.source).toBe('file_view_lines');
    expect(fragment?.metadata?.file).toBe('/tmp/test.ts');
    expect(fragment?.size).toBe(11);
  });

  it('overwrites on duplicate key', () => {
    store.set('key1', 'content1', 'manual');
    store.set('key1', 'content2', 'manual');
    expect(store.count()).toBe(1);
    expect(store.get('key1')?.content).toBe('content2');
  });

  it('list returns metadata without content', () => {
    store.set('key1', 'hello', 'manual');
    const list = store.list();
    expect(list.length).toBe(1);
    expect(list[0].key).toBe('key1');
    expect(list[0].size).toBe(5);
    expect((list[0] as { content?: unknown }).content).toBeUndefined();
  });

  it('delete removes a fragment', () => {
    store.set('key1', 'hello', 'manual');
    expect(store.delete('key1')).toBe(true);
    expect(store.count()).toBe(0);
    expect(store.get('key1')).toBeUndefined();
  });

  it('delete returns false for unknown key', () => {
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('clear removes all fragments', () => {
    store.set('key1', 'a', 'manual');
    store.set('key2', 'b', 'manual');
    store.set('key3', 'c', 'manual');
    store.clear();
    expect(store.count()).toBe(0);
  });

  it('totalSize sums fragment sizes', () => {
    store.set('a', '12345', 'manual');
    store.set('b', '123', 'manual');
    expect(store.totalSize()).toBe(8);
  });

  it('snapshot captures current state', () => {
    store.set('key1', 'hello', 'manual');
    const snap = store.snapshot();
    expect(snap.fragmentCount).toBe(1);
    expect(snap.totalSize).toBe(5);
    expect(snap.fragments[0].key).toBe('key1');
  });

  it('restore reverts to a snapshot', () => {
    store.set('key1', 'original', 'manual');
    const snap = store.snapshot();
    store.set('key1', 'modified', 'manual');
    store.set('key2', 'new', 'manual');
    store.restore(snap);
    expect(store.count()).toBe(1);
    expect(store.get('key1')?.content).toBe('original');
    expect(store.get('key2')).toBeUndefined();
  });

  it('toPromptSummary lists fragments without content', () => {
    store.set('key1', 'hello world this is content', 'file_view_lines', { file: '/tmp/test.ts' });
    store.set('key2', 'another fragment', 'manual');
    const summary = store.toPromptSummary();
    expect(summary).toContain('key1');
    expect(summary).toContain('key2');
    expect(summary).toContain('file_view_lines');
    expect(summary).not.toContain('hello world');
  });

  it('toPromptSummary shows empty message when no fragments', () => {
    const summary = store.toPromptSummary();
    expect(summary).toContain('vacío');
  });

  it('tracks history of actions', () => {
    store.set('key1', 'hello', 'manual');
    store.delete('key1');
    store.clear();
    const history = store.getHistory();
    expect(history.length).toBe(3);
    expect(history[0].action).toBe('set');
    expect(history[1].action).toBe('delete');
    expect(history[2].action).toBe('clear');
  });
});

describe('forkCleanContextStore', () => {
  it('creates a child store without parent fragments', () => {
    const parent = createContextStore();
    parent.set('parent-key', 'parent content', 'manual');
    const child = forkCleanContextStore(parent);
    expect(child.count()).toBe(0);
    expect(child.get('parent-key')).toBeUndefined();
  });
});

describe('summarizeTraceForPrompt', () => {
  it('formats trace steps compactly', () => {
    const trace: TraceStep[] = [
      { ts: 1, kind: 'thought', content: 'I should read the file' },
      { ts: 2, kind: 'tool_call', content: 'file_view_lines' },
      { ts: 3, kind: 'tool_result', content: 'line 1: hello\nline 2: world' },
    ];
    const summary = summarizeTraceForPrompt(trace);
    expect(summary).toContain('thought');
    expect(summary).toContain('tool_call');
    expect(summary).toContain('file_view_lines');
  });

  it('truncates long content', () => {
    const longContent = 'x'.repeat(500);
    const trace: TraceStep[] = [{ ts: 1, kind: 'observation', content: longContent }];
    const summary = summarizeTraceForPrompt(trace);
    expect(summary.length).toBeLessThan(longContent.length + 50);
    expect(summary).toContain('...');
  });

  it('limits to last N steps', () => {
    const trace: TraceStep[] = Array.from({ length: 20 }, (_, i) => ({
      ts: i,
      kind: 'thought' as const,
      content: `step ${i}`,
    }));
    const summary = summarizeTraceForPrompt(trace, 5);
    expect(summary).toContain('step 19');
    expect(summary).not.toContain('step 5');
  });
});
