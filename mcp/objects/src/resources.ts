import type { ServiceClient } from './service.js';

export const OBJECT_TYPES_URI = 'objects://types';

const objectTypesDescription = 'Список справочников и документов сервиса объектов. Приложение подкладывает текст в контекст, чтобы имя типа было известно без вызова find_types. Базу не меняет. В тексте JSON сервиса: items и hasMore. hasMore true значит, что типов больше, чем в items; страницы продолжения нет. descriptionUrl не открывать. Схему типа запрашивают инструментом describe_type с точным name. Если hasMore true, полный перечень этим ресурсом не получить: имя ищут инструментом find_types.';

export type ResourceReadResult = {
  contents: [{
    uri: string;
    mimeType: 'application/json';
    text: string;
  }];
};

export async function readObjectTypes(
  uri: URL,
  service: ServiceClient,
): Promise<ResourceReadResult> {
  // Сервис требует непустую строку поиска и отдаёт не больше 100 типов.
  // Точка есть в полном имени каждого справочника и документа.
  const outcome = await service.get('/types', { q: '.', limit: 100 });
  if (!outcome.ok) {
    throw new Error(outcome.text);
  }
  return {
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: outcome.text,
    }],
  };
}

export const resourceCatalog = [
  {
    name: 'Типы объектов 1С',
    title: 'Типы объектов 1С',
    uri: OBJECT_TYPES_URI,
    description: objectTypesDescription,
    mimeType: 'application/json' as const,
    read: readObjectTypes,
  },
] as const;
