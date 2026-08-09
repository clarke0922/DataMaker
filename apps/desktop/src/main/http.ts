import Fastify from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApplicationServices } from './services.js';

export async function startHttpServer(services: ApplicationServices) {
  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const token = randomBytes(32).toString('base64url');
  server.get('/api/v1/health', async () => ({ status: 'ok' }));
  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/v1/health') return;
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const valid = supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
    if (!valid) return reply.code(401).send({ error: 'UNAUTHORIZED' });
  });
  server.get('/api/v1/system/info', async () => services.systemInfo());
  server.get('/api/v1/metadata/stats', async () => services.metadataStats());
  server.get('/api/v1/search', async request => services.metadataSearch(String((request.query as { q?: string }).q ?? '')));
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  return { server, token, port: typeof address === 'object' && address ? address.port : 0 };
}
