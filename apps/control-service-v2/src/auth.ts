import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { EnvSchema } from './env.js';

export class AuthError extends Error {
  public readonly statusCode = 401;

  public constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function getBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new AuthError('Missing Authorization header.');
  }

  const [kind, token] = authorizationHeader.split(' ');
  if (kind?.toLowerCase() !== 'bearer' || !token) {
    throw new AuthError('Authorization header must be a Bearer token.');
  }

  return token.trim();
}

export function assertControlAuth(request: FastifyRequest, env: EnvSchema): void {
  const token = getBearerToken(request.headers.authorization);
  const left = Buffer.from(token);
  const right = Buffer.from(env.CONTROL_SHARED_TOKEN);
  const matches = left.length === right.length && timingSafeEqual(left, right);

  if (!matches) {
    throw new AuthError('Invalid control token.');
  }
}

export function buildAuthHeaders(sharedToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${sharedToken}`,
    'Content-Type': 'application/json',
  };
}
