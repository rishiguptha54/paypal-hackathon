import request from 'supertest';
import type { Express } from 'express';

export function sessionClient(app: Express) {
  let cookie = '';
  async function send(test: request.Test) {
    const response = await (cookie ? test.set('Cookie', cookie) : test);
    const header = response.headers['set-cookie'] as string[] | undefined;
    if (header?.[0]) cookie = header[0].split(';')[0] ?? '';
    return response;
  }
  return {
    post: (path: string, body: object = {}) => send(request(app).post(path).send(body)),
    get: (path: string) => send(request(app).get(path)),
  };
}
