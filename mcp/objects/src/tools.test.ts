import assert from 'node:assert/strict';
import test from 'node:test';

import type { ServiceClient, ServiceOutcome } from './service.js';
import {
  createObject,
  createObjectSchema,
  findTypes,
  findTypesSchema,
  toolCatalog,
} from './tools.js';

const expectedTools = [
  {
    name: 'find_types',
    title: 'Найти типы',
    description: 'Ищет справочники и документы по вхождению строки в техническое имя или синоним. Вызывать, когда точное имя типа ещё неизвестно. Базу не меняет. В ответе JSON сервиса: items и hasMore. hasMore true значит, что совпадений больше, чем в items; страницы продолжения нет, строку поиска уточняют или увеличивают limit. descriptionUrl не открывать. Схему типа запрашивают инструментом describe_type с точным name.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'describe_type',
    title: 'Описать тип',
    description: 'Возвращает схему типа: поля, типы значений, обязательность, операции, exchange и rules. Вызывать, когда полное имя типа уже известно, перед поиском ссылок и перед созданием. Базу не меняет. В ответе JSON сервиса. searchUrl и objectUrl не открывать. Ссылку ищут инструментом find_objects по targetType. Объект читают инструментом read_object по type и id. Значения перечисления берут из values[].name. Тело создания собирают по exchange и rules этого ответа.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'find_objects',
    title: 'Найти объекты',
    description: 'Ищет объекты для ссылки: у справочника по части наименования, у документа по номеру. Вызывать, чтобы получить id. Базу не меняет. Полное содержимое объекта не возвращает. В ответе JSON сервиса: items и hasMore. hasMore true значит, что совпадений больше, чем в items; страницы продолжения нет, строку поиска уточняют или увеличивают limit. Для ссылки и для чтения нужен id элемента.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'read_object',
    title: 'Прочитать объект',
    description: 'Читает сохранённый объект по уже известным типу и UUID. Базу не меняет. В ответе JSON сервиса шапка и таблицы сохранённого объекта: header и tables.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'create_object',
    title: 'Создать объект',
    description: 'Создаёт элемент справочника или непроведённый документ. Вызывать, когда человек просит создать объект и значения уже собраны из схемы и поиска. Инструмент меняет базу: перед вызовом нужно подтверждение человека. Документ записывается непроведённым. Номер назначает 1С. При успехе номер в поле number, признак проведения posted равен false. Ссылки передают UUID из find_objects, а не наименованиями. Сервер поля не заполняет и суммы не считает. Повтор не ищет уже созданный объект и создаёт ещё один. При отказе текст отказа исправляют новым вызовом или отдают менеджеру. В ответе JSON сервиса.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

function serviceWith(outcome: ServiceOutcome): {
  service: ServiceClient;
  getCalls: Array<{ path: string; query: Record<string, string | number | undefined> }>;
  postCalls: Array<{ path: string; body: unknown }>;
} {
  const getCalls: Array<{ path: string; query: Record<string, string | number | undefined> }> = [];
  const postCalls: Array<{ path: string; body: unknown }> = [];
  return {
    getCalls,
    postCalls,
    service: {
      async get(path, query) {
        getCalls.push({ path, query });
        return outcome;
      },
      async post(path, body) {
        postCalls.push({ path, body });
        return outcome;
      },
    },
  };
}

test('каталог содержит пять инструментов в заданном порядке и с точными метаданными', () => {
  assert.deepEqual(
    toolCatalog.map(({ name, title, description, annotations }) => ({
      name,
      title,
      description,
      annotations,
    })),
    expectedTools,
  );
});

test('схемы строго проверяют корень и пропускают произвольное содержимое объекта', () => {
  assert.equal(findTypesSchema.safeParse({ q: 'a', extra: 1 }).success, false);

  const value = {
    type: 't',
    header: { Поле: null, Число: 1 },
    tables: { Строки: [{ Ссылка: 'uuid' }] },
  };
  assert.equal(createObjectSchema.safeParse(value).success, true);
  assert.equal(createObjectSchema.safeParse({ ...value, posted: false }).success, false);
  assert.equal(createObjectSchema.safeParse({ ...value, header: [] }).success, false);
});

test('поиск типов передаёт отсутствующий limit как undefined и сохраняет успешный текст', async () => {
  const text = '{"items":[],"hasMore":true}';
  const fake = serviceWith({ ok: true, text });

  const result = await findTypes({ q: 'a' }, fake.service);

  assert.deepEqual(fake.getCalls, [
    { path: '/types', query: { q: 'a', limit: undefined } },
  ]);
  assert.deepEqual(result, { content: [{ type: 'text', text }] });
});

test('неуспешный исход сервиса становится ошибкой инструмента с тем же текстом', async () => {
  const fake = serviceWith({ ok: false, text: 'Отказ' });

  const result = await findTypes({ q: 'a', limit: 0 }, fake.service);

  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'Отказ' }],
    isError: true,
  });
});

test('создание один раз передаёт неизменённые шапку и таблицы', async () => {
  const fake = serviceWith({ ok: true, text: '{"id":"uuid"}' });
  const header = { Поле: null, Число: 1 };
  const tables = { Строки: [{ Ссылка: 'uuid' }] };

  await createObject({ type: 't', header, tables }, fake.service);

  assert.deepEqual(fake.postCalls, [
    { path: '/object', body: { type: 't', header, tables } },
  ]);
});
