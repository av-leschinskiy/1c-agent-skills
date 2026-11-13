import type { PublicationSource } from './publication.js';

export const UNAVAILABLE_TEXT = 'Сервис объектов недоступен. Это не отказ записи.';
export const DEFAULT_TIMEOUT_MS = 60000;

export type ServiceOutcome =
  | { ok: true; text: string }
  | { ok: false; text: string };

export type ServiceClient = {
  get(
    path: string,
    query: Record<string, string | number | undefined>,
  ): Promise<ServiceOutcome>;
  post(path: string, body: unknown): Promise<ServiceOutcome>;
};

type Dependencies = {
  publication: PublicationSource;
  fetch: typeof fetch;
  timeoutMs?: number;
};

const unavailable = (): ServiceOutcome => ({
  ok: false,
  text: UNAVAILABLE_TEXT,
});

function serviceError(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const error = (value as Record<string, unknown>).error;
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return undefined;
  }

  const fields = error as Record<string, unknown>;
  if (typeof fields.message !== 'string') {
    return undefined;
  }

  const lines = [fields.message];
  if (typeof fields.code === 'string') {
    lines.push(fields.code);
  }
  if (Array.isArray(fields.details)) {
    for (const detail of fields.details) {
      if (
        detail !== null
        && typeof detail === 'object'
        && !Array.isArray(detail)
      ) {
        const item = detail as Record<string, unknown>;
        if (typeof item.message === 'string') {
          lines.push(`${String(item.path)}: ${item.message}`);
        }
      }
    }
  }
  return lines.join('\n');
}

export function createServiceClient(deps: Dependencies): ServiceClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<ServiceOutcome> {
    const publication = await deps.publication.get();
    if (!publication.ok) {
      return unavailable();
    }

    const authorization = Buffer.from(
      `${publication.publication.user}:${publication.publication.password}`,
      'utf8',
    ).toString('base64');
    const headers: Record<string, string> = {
      Authorization: `Basic ${authorization}`,
    };
    const init: RequestInit = {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await deps.fetch(
        `${publication.publication.url}/hs/objects${path}`,
        init,
      );
    } catch {
      return unavailable();
    }

    if (
      response.status === 0
      || (response.status >= 300 && response.status <= 399)
    ) {
      return unavailable();
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return unavailable();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return unavailable();
    }

    const error = serviceError(parsed);
    if (error !== undefined) {
      return { ok: false, text: error };
    }
    if (response.status >= 200 && response.status <= 299) {
      return { ok: true, text };
    }
    return unavailable();
  }

  return {
    get(path, query) {
      const parameters = Object.entries(query)
        .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      const separator = path.includes('?') ? '&' : '?';
      return request('GET', parameters === '' ? path : `${path}${separator}${parameters}`);
    },
    post(path, body) {
      return request('POST', path, body);
    },
  };
}
