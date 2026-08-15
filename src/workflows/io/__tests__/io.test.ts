/**
 * FASE 21 — Tests de Import / Export.
 */

import { describe, it, expect } from 'vitest';
import { exportWorkflow, importWorkflow, duplicateWorkflow } from '../index';
import type { Workflow } from '../../types/definition';

function makeWf(): Workflow {
  return {
    id: 'wf-1',
    name: 'Test workflow',
    nodes: [
      {
        id: 'n1',
        type: 'webhook',
        label: 'Webhook',
        position: { x: 0, y: 0 },
        config: { path: '/order', method: 'POST' },
      },
      {
        id: 'n2',
        type: 'http_request',
        label: 'HTTP',
        position: { x: 100, y: 0 },
        config: {
          url: 'https://api.example.com',
          method: 'POST',
          credentialId: 'cred-secret-123',
        },
      },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    chat: [],
    createdAt: 1000,
    updatedAt: 2000,
    enabled: true,
  };
}

describe('Import/Export', () => {
  it('exports workflow with correct format', () => {
    const exported = exportWorkflow(makeWf());
    expect(exported.format).toBe('weaver-workflow');
    expect(exported.version).toBe(1);
    expect(exported.workflow.nodes.length).toBe(2);
    expect(exported.workflow.edges.length).toBe(1);
  });

  it('exportedAt is a valid ISO string', () => {
    const exported = exportWorkflow(makeWf());
    expect(() => new Date(exported.exportedAt)).not.toThrow();
  });

  it('export strips secrets but keeps credentialId', () => {
    const wf = makeWf();
    wf.nodes[1].config.apiKey = 'super-secret';
    wf.nodes[1].config.password = 'hush';
    const exported = exportWorkflow(wf);
    const httpNode = exported.workflow.nodes.find((n) => n.type === 'http_request');
    expect(httpNode?.config.credentialId).toBe('cred-secret-123');
    expect(httpNode?.config.apiKey).toBeUndefined();
    expect(httpNode?.config.password).toBeUndefined();
  });

  it('export does NOT include chat history', () => {
    const wf = makeWf();
    wf.chat = [{ id: 'm1', role: 'user', content: 'secret info', ts: Date.now() }];
    const exported = exportWorkflow(wf);
    expect((exported as { workflow: { chat?: unknown } }).workflow.chat).toBeUndefined();
  });

  it('import accepts valid export', () => {
    const exported = exportWorkflow(makeWf());
    const imported = importWorkflow(exported);
    expect(imported).not.toBeNull();
    expect(imported?.nodes.length).toBe(2);
    expect(imported?.edges.length).toBe(1);
  });

  it('import rejects invalid format', () => {
    expect(importWorkflow(null)).toBeNull();
    expect(importWorkflow({})).toBeNull();
    expect(importWorkflow({ format: 'something-else' })).toBeNull();
  });

  it('import rejects missing nodes', () => {
    expect(importWorkflow({ format: 'weaver-workflow', version: 1, workflow: { name: 'x' } })).toBeNull();
  });

  it('import generates new ID', () => {
    const wf = makeWf();
    const exported = exportWorkflow(wf);
    const imported = importWorkflow(exported);
    expect(imported?.id).not.toBe(wf.id);
  });

  it('duplicate creates copy with new ID', () => {
    const wf = makeWf();
    const dup = duplicateWorkflow(wf, 'Copy name');
    expect(dup.id).not.toBe(wf.id);
    expect(dup.name).toBe('Copy name');
    expect(dup.nodes.length).toBe(wf.nodes.length);
  });

  it('round-trip: export → import preserves structure', () => {
    const wf = makeWf();
    const exported = exportWorkflow(wf);
    const imported = importWorkflow(exported);
    expect(imported?.nodes.length).toBe(wf.nodes.length);
    expect(imported?.edges.length).toBe(wf.edges.length);
    expect(imported?.nodes[0].type).toBe(wf.nodes[0].type);
    expect(imported?.nodes[0].config).toEqual(wf.nodes[0].config);
  });
});
