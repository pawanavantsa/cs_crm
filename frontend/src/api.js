// API client. Two modes:
//   live — talks to the Django backend (VITE_API_URL, or the URL saved in Settings → Data)
//   demo — runs the same API in the browser (src/demo/server.js) with seeded data
import { useCallback, useEffect, useRef, useState } from 'react';

const LS_API = 'xcrm.api_url';
const LS_TOKEN = 'xcrm.token';

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } }

const envUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
export const apiConfig = {
  url: (safeGet(LS_API) ?? envUrl ?? '').replace(/\/$/, ''),
  token: safeGet(LS_TOKEN),
};
export const isDemo = () => !apiConfig.url;

let demo = null;
async function demoServer() {
  if (!demo) {
    const { DemoServer } = await import('./demo/server.js');
    demo = new DemoServer();
    demo.listeners.add(() => emit());
  }
  return demo;
}

const subs = new Set();
function emit() { subs.forEach((fn) => fn()); }
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, path, body) {
  if (isDemo()) {
    const s = await demoServer();
    try {
      // small delay keeps optimistic UI honest
      return await s.handle(method, path, body);
    } catch (e) {
      throw new ApiError(e.status || 500, e.message);
    }
  }
  const res = await fetch(`${apiConfig.url}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiConfig.token ? { Authorization: `Token ${apiConfig.token}` } : {}),
    },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('xcrm:unauthorized'));
    throw new ApiError(401, 'Please sign in again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || data?.detail || `Request failed (${res.status})`);
  if (method !== 'GET') emit();
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b || {});
export const patch = (p, b) => api('PATCH', p, b || {});
export const del = (p) => api('DELETE', p);

export async function login(url, username, password) {
  const base = url.replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Sign in failed');
  apiConfig.url = base; apiConfig.token = data.token;
  safeSet(LS_API, base); safeSet(LS_TOKEN, data.token);
  return data;
}

export function switchToDemo() {
  apiConfig.url = '';
  apiConfig.token = null;
  safeSet(LS_API, '');
  safeSet(LS_TOKEN, null);
}

export function logout() {
  apiConfig.token = null;
  safeSet(LS_TOKEN, null);
}

/** Fetch + auto-refresh. Demo mode refreshes on every change; live mode polls. */
export function useApi(path, { poll = 6000 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    if (!pathRef.current) return;
    const p = pathRef.current;
    try {
      const d = await get(p);
      if (pathRef.current === p) { setData(d); setError(null); }
    } catch (e) {
      if (pathRef.current === p) setError(e);
    }
  }, []);

  useEffect(() => { setData(null); load(); }, [path, load]);
  useEffect(() => onChange(load), [load]);
  useEffect(() => {
    if (isDemo() || !poll) return undefined;
    const t = setInterval(load, poll);
    return () => clearInterval(t);
  }, [load, poll]);
  // demo: tick so durations ("waiting 12 min") stay fresh
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return { data, error, reload: load, setData };
}
