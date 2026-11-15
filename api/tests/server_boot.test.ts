import { describe, it, expect } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

// Se estiver executando fora do container Docker (no host local), adapta endpoints expostos
if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

describe('Server Boot & Route Integrity', () => {
  it('buildServer deve inicializar sem rotas duplicadas ou erros de plugins', async () => {
    const { buildServer } = await import('../src/server.js');
    const server = await buildServer();
    await server.ready();
    expect(server).toBeDefined();
    await server.close();
  });
});
