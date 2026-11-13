export type Publication = {
  url: string;
  user: string;
  password: string;
};

export type PublicationSource = {
  get(): Promise<
    { ok: true; publication: Publication }
    | { ok: false }
  >;
};

/**
 * Публикация базы из переменных окружения записи MCP в конфиге харнесса:
 * ONEC_HTTP_URL — адрес публикации без завершающего «/» (сервис — ${url}/hs/objects),
 * ONEC_USER — пользователь 1С, ONEC_PASSWORD — пароль, если он есть.
 */
export function createEnvPublicationSource(
  env: Record<string, string | undefined>,
): PublicationSource {
  const url = env.ONEC_HTTP_URL?.trim().replace(/\/+$/, '') ?? '';
  const user = env.ONEC_USER ?? '';
  const password = env.ONEC_PASSWORD ?? '';
  const valid = /^https?:\/\/\S+$/.test(url) && user !== '';
  const outcome = valid
    ? { ok: true as const, publication: { url, user, password } }
    : { ok: false as const };

  return {
    async get() {
      return outcome;
    },
  };
}
