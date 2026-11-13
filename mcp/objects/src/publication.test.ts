import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnvPublicationSource } from './publication.js';

test('публикация берётся из окружения, завершающий «/» срезается', async () => {
  const source = createEnvPublicationSource({
    ONEC_HTTP_URL: 'http://localhost/base/',
    ONEC_USER: 'Администратор',
    ONEC_PASSWORD: 'secret',
  });
  assert.deepEqual(await source.get(), {
    ok: true,
    publication: { url: 'http://localhost/base', user: 'Администратор', password: 'secret' },
  });
});

test('пароль необязателен', async () => {
  const source = createEnvPublicationSource({
    ONEC_HTTP_URL: 'http://localhost/base',
    ONEC_USER: 'Администратор',
  });
  assert.deepEqual(await source.get(), {
    ok: true,
    publication: { url: 'http://localhost/base', user: 'Администратор', password: '' },
  });
});

test('без адреса или пользователя публикации нет', async () => {
  for (const env of [
    {},
    { ONEC_USER: 'Администратор' },
    { ONEC_HTTP_URL: 'http://localhost/base' },
    { ONEC_HTTP_URL: 'localhost/base', ONEC_USER: 'Администратор' },
  ]) {
    assert.deepEqual(await createEnvPublicationSource(env).get(), { ok: false });
  }
});
