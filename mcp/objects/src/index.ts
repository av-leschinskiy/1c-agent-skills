import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createEnvPublicationSource } from './publication.js';
import { createMcpServer } from './server.js';
import { createServiceClient } from './service.js';

const service = createServiceClient({
  publication: createEnvPublicationSource(process.env),
  fetch: globalThis.fetch,
});

await createMcpServer(service).connect(new StdioServerTransport());
