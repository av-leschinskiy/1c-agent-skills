import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicationSource } from './publication.js';
import {
  createServiceClient,
  DEFAULT_TIMEOUT_MS,
  UNAVAILABLE_TEXT,
} from './service.js';

const publication: PublicationSource = {
  async get() {
    return {
      ok: true,
      publication: {
        url: 'http://127.0.0.1:9/pub',
        user: 'Администратор',
        password: '',
      },
    };
  },
};

function response(text: string, status: number): Response {
  return new Response(text, { status });
}

test('успех 201 возвращает исходное тело', async () => {
  const body = ' {"number":"0001","posted":false}\n';
  const client = createServiceClient({
    publication,
    fetch: async () => response(body, 201),
  });

  const outcome = await client.post('/object', { type: 'Документ.Счёт' });

  assert.deepEqual(outcome, { ok: true, text: body });
});

test('ошибка в теле 200 — отказ', async () => {
  const body = JSON.stringify({
    error: {
      message: 'Объект не прошёл проверку заполнения',
      code: 'validation_failed',
      details: [
        { path: 'header.Партнер', message: 'Поле не заполнено' },
        { path: null, message: 'Пустой отказ' },
      ],
    },
  });
  const client = createServiceClient({
    publication,
    fetch: async () => response(body, 200),
  });

  const outcome = await client.get('/object', { type: 'Документ.Счёт', id: 'x' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.text, 'Объект не прошёл проверку заполнения\nvalidation_failed\nheader.Партнер: Поле не заполнено\nnull: Пустой отказ');
  assert.equal(outcome.text.includes(UNAVAILABLE_TEXT), false);
});

test('HTTP 422 с JSON-ошибкой — отказ', async () => {
  const body = JSON.stringify({
    error: {
      code: 'validation_failed',
      message: 'Объект не прошёл проверку заполнения',
      details: [{ path: 'header.Партнер', message: 'Поле не заполнено' }],
    },
  });
  const client = createServiceClient({
    publication,
    fetch: async () => response(body, 422),
  });

  const outcome = await client.post('/object', { type: 'Документ.Счёт' });

  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.text,
    'Объект не прошёл проверку заполнения\nvalidation_failed\nheader.Партнер: Поле не заполнено',
  );
  assert.equal(outcome.text.includes('Сервис объектов недоступен. Это не отказ записи.'), false);
});

test('обрыв не раскрывает адрес и не повторяется', async () => {
  let calls = 0;
  const client = createServiceClient({
    publication,
    fetch: async () => {
      calls += 1;
      throw new Error('http://127.0.0.1:9/pub');
    },
  });

  const outcome = await client.get('/types', { q: 'счет' });

  assert.deepEqual(outcome, { ok: false, text: UNAVAILABLE_TEXT });
  assert.equal(calls, 1);
});

test('перенаправление не следуется', async () => {
  let calls = 0;
  let init: RequestInit | undefined;
  const client = createServiceClient({
    publication,
    fetch: async (_input, requestInit) => {
      calls += 1;
      init = requestInit;
      return response('', 302);
    },
  });

  const outcome = await client.get('/types', {});

  assert.equal(init?.redirect, 'manual');
  assert.equal(calls, 1);
  assert.deepEqual(outcome, { ok: false, text: UNAVAILABLE_TEXT });
});

test('таймаут прерывает единственный вызов', async () => {
  let calls = 0;
  const client = createServiceClient({
    publication,
    timeoutMs: 30,
    fetch: async (_input, init) => {
      calls += 1;
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      throw new Error('недостижимо');
    },
  });

  const outcome = await client.get('/types', {});

  assert.deepEqual(outcome, { ok: false, text: UNAVAILABLE_TEXT });
  assert.equal(calls, 1);
  assert.equal(DEFAULT_TIMEOUT_MS, 60000);
});

test('GET кодирует путь и параметры и сохраняет исходное успешное тело', async () => {
  let actualUrl = '';
  let actualInit: RequestInit | undefined;
  const body = '{"items":[],"hasMore":true}';
  const client = createServiceClient({
    publication,
    fetch: async (input, init) => {
      actualUrl = String(input);
      actualInit = init;
      return response(body, 200);
    },
  });

  const outcome = await client.get(
    `/type?name=${encodeURIComponent('Документ._ДемоСчетНаОплатуПокупателю')}`,
    { q: 'счёт а', omitted: undefined, limit: 0, empty: '' },
  );

  assert.deepEqual(outcome, { ok: true, text: body });
  assert.equal(actualUrl, 'http://127.0.0.1:9/pub/hs/objects/type?name=%D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82._%D0%94%D0%B5%D0%BC%D0%BE%D0%A1%D1%87%D0%B5%D1%82%D0%9D%D0%B0%D0%9E%D0%BF%D0%BB%D0%B0%D1%82%D1%83%D0%9F%D0%BE%D0%BA%D1%83%D0%BF%D0%B0%D1%82%D0%B5%D0%BB%D1%8E&q=%D1%81%D1%87%D1%91%D1%82%20%D0%B0&limit=0&empty=');
  assert.equal(actualUrl.includes('+'), false);
  assert.equal(actualUrl.includes('secret-ib'), false);
  assert.equal(actualInit?.method, 'GET');
  assert.ok(actualInit?.signal instanceof AbortSignal);
  const headers = new Headers(actualInit?.headers);
  assert.equal(headers.get('Authorization'), `Basic ${Buffer.from('Администратор:', 'utf8').toString('base64')}`);
  assert.equal(JSON.stringify(outcome).includes(headers.get('Authorization') ?? ''), false);
  assert.equal(JSON.stringify(outcome).includes('Администратор'), false);
  assert.equal(JSON.stringify(outcome).includes('secret-ib'), false);
});

test('GET передаёт пустой q и пропускает undefined limit', async () => {
  let actualUrl = '';
  const client = createServiceClient({
    publication,
    fetch: async (input) => {
      actualUrl = String(input);
      return response('{}', 200);
    },
  });

  await client.get('/types', { q: '', limit: undefined });

  assert.equal(actualUrl, 'http://127.0.0.1:9/pub/hs/objects/types?q=');
});

test('POST отправляет JSON с нужным заголовком одним вызовом', async () => {
  let calls = 0;
  let actualInit: RequestInit | undefined;
  const argument = { value: null, count: 2, items: ['один', 3] };
  const client = createServiceClient({
    publication,
    fetch: async (_input, init) => {
      calls += 1;
      actualInit = init;
      return response('{}', 200);
    },
  });

  await client.post('/object', argument);

  assert.equal(calls, 1);
  assert.equal(actualInit?.method, 'POST');
  const headers = new Headers(actualInit?.headers);
  assert.equal(headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(actualInit?.body, JSON.stringify(argument));
});

test('401 с не-JSON телом считается недоступностью', async () => {
  const client = createServiceClient({
    publication,
    fetch: async () => response('not json', 401),
  });

  const outcome = await client.get('/object', {});

  assert.deepEqual(outcome, { ok: false, text: UNAVAILABLE_TEXT });
  assert.equal(outcome.text.includes('validation_failed'), false);
});

test('ошибка чтения тела не раскрывает адрес публикации', async () => {
  const brokenResponse = response('{}', 200);
  brokenResponse.text = async () => {
    throw new Error('http://127.0.0.1:9/pub/hs/objects/types');
  };
  const client = createServiceClient({
    publication,
    fetch: async () => brokenResponse,
  });

  const outcome = await client.get('/types', {});

  assert.deepEqual(outcome, { ok: false, text: UNAVAILABLE_TEXT });
  assert.equal(outcome.text.includes('http://127.0.0.1:9/pub'), false);
});

test('отказ получения публикации не вызывает fetch', async () => {
  let calls = 0;
  const unavailablePublication: PublicationSource = {
    async get() {
      return { ok: false };
    },
  };
  const client = createServiceClient({
    publication: unavailablePublication,
    fetch: async () => {
      calls += 1;
      return response('{}', 200);
    },
  });

  const outcome = await client.get('/types', {});

  assert.deepEqual(outcome, { ok: false, text: UNAVAILABLE_TEXT });
  assert.equal(calls, 0);
});
