import { describe, it, expect, vi } from 'vitest';
import { dispatchAdvancedTool, ADVANCED_TOOLS } from '@/lib/tools';

vi.mock('@/lib/tauri', () => ({
  runtime: { isTauri: true, isBrowser: false },
  keyring: { getApiKeyRaw: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn() },
  sqlite: {
    shellExec: vi.fn(async (cmd: string) => {
      if (cmd.includes('invalid_app')) {
        return { code: 127, stdout: '', stderr: 'command not found' };
      }
      return { code: 0, stdout: 'app launched', stderr: '' };
    }),
  },
  atspi: {
    doubleClick: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
  },
}));

describe('PC Interaction & Launch Tools', () => {
  it('includes launch_app in ADVANCED_TOOLS', () => {
    const launchTool = ADVANCED_TOOLS.find((t) => t.name === 'launch_app');
    expect(launchTool).toBeDefined();
    expect(launchTool?.parameters).toHaveProperty('app_name');
    expect(launchTool?.parameters).toHaveProperty('background');
  });

  it('dispatches launch_app tool in background by default', async () => {
    const res = await dispatchAdvancedTool('launch_app', { app_name: 'gedit' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('gedit');
    expect(res.output).toContain('segundo plano');
  });

  it('dispatches launch_app tool in foreground when background=false', async () => {
    const res = await dispatchAdvancedTool('launch_app', { app_name: 'gedit', background: false });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('gedit');
  });

  it('handles shell_exec tool execution', async () => {
    const res = await dispatchAdvancedTool('shell_exec', { command: 'echo hello' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('app launched');
  });
});
