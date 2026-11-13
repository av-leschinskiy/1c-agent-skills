import { z } from 'zod/v4';

import type { ServiceClient, ServiceOutcome } from './service.js';

export type ToolResult = {
  content: [{ type: 'text'; text: string }];
  isError?: true;
};

export const findTypesSchema = z.strictObject({
  q: z.string(),
  limit: z.number().int().optional(),
});

export const describeTypeSchema = z.strictObject({
  name: z.string(),
});

export const findObjectsSchema = z.strictObject({
  type: z.string(),
  q: z.string(),
  limit: z.number().int().optional(),
});

export const readObjectSchema = z.strictObject({
  type: z.string(),
  id: z.string(),
});

export const createObjectSchema = z.strictObject({
  type: z.string(),
  header: z.record(z.string(), z.unknown()),
  tables: z.record(z.string(), z.unknown()),
});

function toolResult(outcome: ServiceOutcome): ToolResult {
  const result: ToolResult = {
    content: [{ type: 'text', text: outcome.text }],
  };
  if (!outcome.ok) {
    result.isError = true;
  }
  return result;
}

export async function findTypes(
  args: { q: string; limit?: number },
  service: ServiceClient,
): Promise<ToolResult> {
  return toolResult(await service.get('/types', {
    q: args.q,
    limit: args.limit,
  }));
}

export async function describeType(
  args: { name: string },
  service: ServiceClient,
): Promise<ToolResult> {
  return toolResult(await service.get('/type', { name: args.name }));
}

export async function findObjects(
  args: { type: string; q: string; limit?: number },
  service: ServiceClient,
): Promise<ToolResult> {
  return toolResult(await service.get('/search', {
    type: args.type,
    q: args.q,
    limit: args.limit,
  }));
}

export async function readObject(
  args: { type: string; id: string },
  service: ServiceClient,
): Promise<ToolResult> {
  return toolResult(await service.get('/object', {
    type: args.type,
    id: args.id,
  }));
}

export async function createObject(
  args: {
    type: string;
    header: Record<string, unknown>;
    tables: Record<string, unknown>;
  },
  service: ServiceClient,
): Promise<ToolResult> {
  return toolResult(await service.post('/object', {
    type: args.type,
    header: args.header,
    tables: args.tables,
  }));
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const toolCatalog = [
  {
    name: 'find_types',
    title: 'Найти типы',
    description: 'Ищет справочники и документы по вхождению строки в техническое имя или синоним. Вызывать, когда точное имя типа ещё неизвестно. Базу не меняет. В ответе JSON сервиса: items и hasMore. hasMore true значит, что совпадений больше, чем в items; страницы продолжения нет, строку поиска уточняют или увеличивают limit. descriptionUrl не открывать. Схему типа запрашивают инструментом describe_type с точным name.',
    annotations: readOnlyAnnotations,
    schema: findTypesSchema,
    call: findTypes,
  },
  {
    name: 'describe_type',
    title: 'Описать тип',
    description: 'Возвращает схему типа: поля, типы значений, обязательность, операции, exchange и rules. Вызывать, когда полное имя типа уже известно, перед поиском ссылок и перед созданием. Базу не меняет. В ответе JSON сервиса. searchUrl и objectUrl не открывать. Ссылку ищут инструментом find_objects по targetType. Объект читают инструментом read_object по type и id. Значения перечисления берут из values[].name. Тело создания собирают по exchange и rules этого ответа.',
    annotations: readOnlyAnnotations,
    schema: describeTypeSchema,
    call: describeType,
  },
  {
    name: 'find_objects',
    title: 'Найти объекты',
    description: 'Ищет объекты для ссылки: у справочника по части наименования, у документа по номеру. Вызывать, чтобы получить id. Базу не меняет. Полное содержимое объекта не возвращает. В ответе JSON сервиса: items и hasMore. hasMore true значит, что совпадений больше, чем в items; страницы продолжения нет, строку поиска уточняют или увеличивают limit. Для ссылки и для чтения нужен id элемента.',
    annotations: readOnlyAnnotations,
    schema: findObjectsSchema,
    call: findObjects,
  },
  {
    name: 'read_object',
    title: 'Прочитать объект',
    description: 'Читает сохранённый объект по уже известным типу и UUID. Базу не меняет. В ответе JSON сервиса шапка и таблицы сохранённого объекта: header и tables.',
    annotations: readOnlyAnnotations,
    schema: readObjectSchema,
    call: readObject,
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
    schema: createObjectSchema,
    call: createObject,
  },
] as const;
