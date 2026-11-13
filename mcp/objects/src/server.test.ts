import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import { createMcpServer } from './server.js';
import type { ServiceClient, ServiceOutcome } from './service.js';
import { toolCatalog } from './tools.js';

type Post = { path: string; body: unknown };

async function connectedClient(
  t: TestContext,
  service: ServiceClient,
): Promise<Client> {
  const server = createMcpServer(service);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });
  return client;
}

function serviceWith(
  getOutcome: ServiceOutcome,
  postOutcome: ServiceOutcome = { ok: true, text: '{"id":"uuid"}' },
): { service: ServiceClient; posts: Post[] } {
  const posts: Post[] = [];
  return {
    posts,
    service: {
      async get() {
        return getOutcome;
      },
      async post(path, body) {
        posts.push({ path, body });
        return postOutcome;
      },
    },
  };
}

test('сервер регистрирует только каталог с его метаданными и порядком', async (t) => {
  const fake = serviceWith({ ok: true, text: '{}' });
  const client = await connectedClient(t, fake.service);

  const result = await client.listTools();

  assert.deepEqual(
    result.tools.map(({ name, title, description, annotations }) => ({
      name,
      title,
      description,
      annotations,
    })),
    toolCatalog.map(({ name, title, description, annotations }) => ({
      name,
      title,
      description,
      annotations,
    })),
  );
});

test('поиск типов отдаёт успешный текст модели', async (t) => {
  const text = '{"items":[],"hasMore":true}';
  const fake = serviceWith({ ok: true, text });
  const client = await connectedClient(t, fake.service);

  const result = await client.callTool({
    name: 'find_types',
    arguments: { q: 'счёт' },
  });

  assert.deepEqual(result.content, [{ type: 'text', text }]);
  assert.equal(Boolean(result.isError), false);
});

test('отказ сервиса возвращается как ошибка инструмента', async (t) => {
  const fake = serviceWith({ ok: false, text: 'Отказ' });
  const client = await connectedClient(t, fake.service);

  const result = await client.callTool({
    name: 'find_types',
    arguments: { q: 'счёт' },
  });

  assert.deepEqual(result.content, [{ type: 'text', text: 'Отказ' }]);
  assert.equal(result.isError, true);
});

test('создание передаёт null и строки', async (t) => {
  const fake = serviceWith({ ok: true, text: '{}' });
  const client = await connectedClient(t, fake.service);
  const args = {
    type: 't',
    header: { Поле: null, Число: 1 },
    tables: { Строки: [{ Ссылка: 'uuid', Количество: 1 }] },
  };

  const result = await client.callTool({
    name: 'create_object',
    arguments: args,
  });

  assert.equal(fake.posts.length, 1);
  assert.deepEqual(fake.posts[0], { path: '/object', body: args });
  assert.equal(Boolean(result.isError), false);
});

test('лишний аргумент создания не вызывает HTTP', async (t) => {
  const fake = serviceWith({ ok: true, text: '{}' });
  const client = await connectedClient(t, fake.service);

  const result = await client.callTool({
    name: 'create_object',
    arguments: {
      type: 't',
      header: {},
      tables: {},
      posted: true,
    },
  });

  assert.equal(result.isError, true);
  const content = result.content as Array<{ type: string; text: string }>;
  assert.ok(content[0].text.includes('posted'));
  assert.equal(fake.posts.length, 0);
});

const objectTypesDescription = 'Список справочников и документов сервиса объектов. Приложение подкладывает текст в контекст, чтобы имя типа было известно без вызова find_types. Базу не меняет. В тексте JSON сервиса: items и hasMore. hasMore true значит, что типов больше, чем в items; страницы продолжения нет. descriptionUrl не открывать. Схему типа запрашивают инструментом describe_type с точным name. Если hasMore true, полный перечень этим ресурсом не получить: имя ищут инструментом find_types.';

function recordingService(outcome: ServiceOutcome): {
  service: ServiceClient;
  gets: Array<{ path: string; query: Record<string, string | number | undefined> }>;
} {
  const gets: Array<{ path: string; query: Record<string, string | number | undefined> }> = [];
  return {
    gets,
    service: {
      async get(path, query) {
        gets.push({ path, query });
        return outcome;
      },
      async post() {
        return { ok: true, text: '{}' };
      },
    },
  };
}

test('ресурс «Типы объектов 1С» отдаёт список типов сервиса для контекста', async (t) => {
  const text = '{"items":[{"name":"Документ.Счёт","title":"Счёт","kind":"document"}],"hasMore":true}';
  const fake = recordingService({ ok: true, text });
  const client = await connectedClient(t, fake.service);

  const listed = await client.listResources();

  assert.equal(fake.gets.length, 0);
  assert.deepEqual(listed.resources, [{
    uri: 'objects://types',
    name: 'Типы объектов 1С',
    title: 'Типы объектов 1С',
    description: objectTypesDescription,
    mimeType: 'application/json',
  }]);

  const read = await client.readResource({ uri: 'objects://types' });

  assert.deepEqual(fake.gets, [
    { path: '/types', query: { q: '.', limit: 100 } },
  ]);
  assert.deepEqual(read.contents, [{
    uri: 'objects://types',
    mimeType: 'application/json',
    text,
  }]);
});

test('отказ сервиса не отдаёт список типов как успешный ресурс', async (t) => {
  const text = 'Сервис объектов недоступен. Это не отказ записи.';
  const fake = recordingService({ ok: false, text });
  const client = await connectedClient(t, fake.service);

  await assert.rejects(
    () => client.readResource({ uri: 'objects://types' }),
    { message: text },
  );
  assert.deepEqual(fake.gets, [
    { path: '/types', query: { q: '.', limit: 100 } },
  ]);
});
