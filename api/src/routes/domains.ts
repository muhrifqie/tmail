import type { FastifyInstance } from 'fastify';
import { activeDomainNames, loadDomains } from '../lib/domains.js';

export async function domainRoutes(app: FastifyInstance) {
  app.get('/api/domains', async () => {
    loadDomains(true);
    return { domains: activeDomainNames() };
  });
}
