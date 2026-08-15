/**
 * FASE 23 — Tests de SSRF protection.
 */

import { describe, it, expect } from 'vitest';
import { isSsrfBlocked, sanitizeUrlForLog } from '../ssrf';

describe('SSRF Protection', () => {
  it('blocks loopback IPv4', () => {
    expect(isSsrfBlocked('http://127.0.0.1/admin')).toBe(true);
    expect(isSsrfBlocked('http://127.0.0.1:8080/admin')).toBe(true);
  });

  it('blocks localhost', () => {
    expect(isSsrfBlocked('http://localhost/admin')).toBe(true);
  });

  it('blocks private 10/8', () => {
    expect(isSsrfBlocked('http://10.0.0.1/internal')).toBe(true);
  });

  it('blocks private 192.168/16', () => {
    expect(isSsrfBlocked('http://192.168.1.1/router')).toBe(true);
  });

  it('blocks private 172.16/12', () => {
    expect(isSsrfBlocked('http://172.16.0.1/router')).toBe(true);
    expect(isSsrfBlocked('http://172.31.255.255/router')).toBe(true);
  });

  it('does NOT block public 172.32/16', () => {
    expect(isSsrfBlocked('http://172.32.0.1/api')).toBe(false);
  });

  it('blocks AWS metadata', () => {
    expect(isSsrfBlocked('http://169.254.169.254/latest/meta-data/')).toBe(true);
  });

  it('blocks link-local', () => {
    expect(isSsrfBlocked('http://169.254.1.1/test')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isSsrfBlocked('http://0.0.0.0/')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isSsrfBlocked('https://api.github.com/users/octocat')).toBe(false);
    expect(isSsrfBlocked('https://example.com/')).toBe(false);
  });

  it('respects allowList', () => {
    expect(isSsrfBlocked('http://localhost/admin', { allowList: ['localhost'] })).toBe(false);
  });

  it('respects allowPrivate flag', () => {
    expect(isSsrfBlocked('http://127.0.0.1/', { allowPrivate: true })).toBe(false);
  });

  it('blocks invalid URL', () => {
    expect(isSsrfBlocked('not-a-url')).toBe(true);
  });

  it('sanitizes URL with credentials for logging', () => {
    const url = 'https://user:password@example.com/path';
    const sanitized = sanitizeUrlForLog(url);
    expect(sanitized).not.toContain('password');
    expect(sanitized).toContain('***');
  });

  it('sanitizes invalid URL', () => {
    expect(sanitizeUrlForLog('not-a-url')).toBe('<invalid url>');
  });
});
