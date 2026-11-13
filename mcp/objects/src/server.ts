import { McpServer } from '@modelcontextprotocol/server';

import { resourceCatalog } from './resources.js';
import type { ServiceClient } from './service.js';
import { toolCatalog } from './tools.js';

export function createMcpServer(service: ServiceClient): McpServer {
  const server = new McpServer({ name: 'objects', version: '1.0.0' });

  for (const tool of toolCatalog) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: tool.schema,
      },
      (args: unknown) => tool.call(args as never, service),
    );
  }

  for (const resource of resourceCatalog) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      (uri) => resource.read(uri, service),
    );
  }

  return server;
}
