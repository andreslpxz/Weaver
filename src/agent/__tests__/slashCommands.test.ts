/**
 * Tests del parser de slash commands.
 */

import { describe, it, expect } from 'vitest';
import { parseSlashCommand, validateCommand, getHelpMessage } from '../rlm/slashCommands';

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('  ')).toBeNull();
  });

  it('parses /refine without subcommand', () => {
    const result = parseSlashCommand('/refine');
    expect(result).not.toBeNull();
    expect(result?.command).toBe('refine');
    expect(result?.subcommand).toBeUndefined();
    expect(result?.args).toEqual([]);
  });

  it('parses /refine auto', () => {
    const result = parseSlashCommand('/refine auto');
    expect(result?.command).toBe('refine');
    expect(result?.subcommand).toBe('auto');
    expect(result?.args).toEqual([]);
  });

  it('parses /refine status', () => {
    const result = parseSlashCommand('/refine status');
    expect(result?.command).toBe('refine');
    expect(result?.subcommand).toBe('status');
  });

  it('parses /refine revert', () => {
    const result = parseSlashCommand('/refine revert');
    expect(result?.command).toBe('refine');
    expect(result?.subcommand).toBe('revert');
  });

  it('parses /rlm on/off/status', () => {
    expect(parseSlashCommand('/rlm on')?.subcommand).toBe('on');
    expect(parseSlashCommand('/rlm off')?.subcommand).toBe('off');
    expect(parseSlashCommand('/rlm status')?.subcommand).toBe('status');
  });

  it('parses /ctx list', () => {
    const result = parseSlashCommand('/ctx list');
    expect(result?.command).toBe('ctx');
    expect(result?.subcommand).toBe('list');
  });

  it('parses /ctx get with key arg', () => {
    const result = parseSlashCommand('/ctx get my-key');
    expect(result?.command).toBe('ctx');
    expect(result?.subcommand).toBe('get');
    expect(result?.args).toEqual(['my-key']);
  });

  it('parses /ctx get with quoted key', () => {
    const result = parseSlashCommand('/ctx get "my key with spaces"');
    expect(result?.command).toBe('ctx');
    expect(result?.subcommand).toBe('get');
    expect(result?.args).toEqual(['my key with spaces']);
  });

  it('parses /help', () => {
    const result = parseSlashCommand('/help');
    expect(result?.command).toBe('help');
  });

  it('returns unknown for unrecognized commands', () => {
    const result = parseSlashCommand('/foobar baz');
    expect(result?.command).toBe('unknown');
  });

  it('is case-insensitive for command and subcommand', () => {
    const result = parseSlashCommand('/REFINE AUTO');
    expect(result?.command).toBe('refine');
    expect(result?.subcommand).toBe('auto');
  });

  it('preserves raw input', () => {
    const result = parseSlashCommand('/refine auto extra-arg');
    expect(result?.raw).toBe('/refine auto extra-arg');
    expect(result?.args).toEqual(['extra-arg']);
  });

  it('handles extra whitespace', () => {
    const result = parseSlashCommand('  /rlm   on  ');
    expect(result?.command).toBe('rlm');
    expect(result?.subcommand).toBe('on');
  });
});

describe('validateCommand', () => {
  it('validates /refine without subcommand', () => {
    const result = validateCommand(parseSlashCommand('/refine')!);
    expect(result.valid).toBe(true);
  });

  it('validates /refine auto', () => {
    expect(validateCommand(parseSlashCommand('/refine auto')!).valid).toBe(true);
    expect(validateCommand(parseSlashCommand('/refine status')!).valid).toBe(true);
    expect(validateCommand(parseSlashCommand('/refine revert')!).valid).toBe(true);
  });

  it('rejects /refine with unknown subcommand', () => {
    const result = validateCommand(parseSlashCommand('/refine foobar')!);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('auto, status, revert');
  });

  it('validates /rlm on/off/status', () => {
    expect(validateCommand(parseSlashCommand('/rlm on')!).valid).toBe(true);
    expect(validateCommand(parseSlashCommand('/rlm off')!).valid).toBe(true);
    expect(validateCommand(parseSlashCommand('/rlm status')!).valid).toBe(true);
  });

  it('rejects /rlm with unknown subcommand', () => {
    const result = validateCommand(parseSlashCommand('/rlm foobar')!);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('on, off, status');
  });

  it('rejects /ctx without subcommand', () => {
    const result = validateCommand(parseSlashCommand('/ctx')!);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('list, clear, get');
  });

  it('rejects /ctx with unknown subcommand', () => {
    const result = validateCommand(parseSlashCommand('/ctx foobar')!);
    expect(result.valid).toBe(false);
  });

  it('rejects /ctx get without key', () => {
    const result = validateCommand(parseSlashCommand('/ctx get')!);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('key');
  });

  it('validates /ctx get with key', () => {
    const result = validateCommand(parseSlashCommand('/ctx get mykey')!);
    expect(result.valid).toBe(true);
  });

  it('validates /help', () => {
    expect(validateCommand(parseSlashCommand('/help')!).valid).toBe(true);
  });

  it('rejects unknown commands', () => {
    const result = validateCommand(parseSlashCommand('/foobar')!);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Comando desconocido');
  });
});

describe('getHelpMessage', () => {
  it('includes all command categories', () => {
    const help = getHelpMessage();
    expect(help).toContain('RLM');
    expect(help).toContain('/rlm on');
    expect(help).toContain('/refine');
    expect(help).toContain('/refine auto');
    expect(help).toContain('/ctx list');
    expect(help).toContain('/ctx clear');
    expect(help).toContain('/ctx get');
    expect(help).toContain('/help');
  });

  it('explains RLM concept', () => {
    const help = getHelpMessage();
    expect(help).toContain('contexto como variable');
    expect(help).toContain('file_view_lines');
  });
});
