import { createVerify, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { EnvSchema } from './env.js';

export class AuthError extends Error {
  public readonly statusCode = 401;

  public constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

type JwtPayload = {
  exp?: number;
  iat?: number;
  nbf?: number;
  sub?: string;
};

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

function decodeBase64UrlJson(value: string): JwtPayload {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  return JSON.parse(decoded) as JwtPayload;
}

function verifySharedToken(requestToken: string, expectedToken: string): void {
  const left = Buffer.from(requestToken);
  const right = Buffer.from(expectedToken);
  const matches =
    left.length === right.length &&
    timingSafeEqual(Buffer.from(requestToken), Buffer.from(expectedToken));

  if (!matches) {
    throw new AuthError('Invalid control token.');
  }
}

function verifyJwt(token: string, rawPublicKey: string): void {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError('Malformed JWT token.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new AuthError('Malformed JWT token segments.');
  }

  const header = decodeBase64UrlJson(headerB64) as JwtPayload & { alg?: string; typ?: string };
  if (header.alg !== 'RS256') {
    throw new AuthError(`Unsupported JWT algorithm "${header.alg ?? 'unknown'}".`);
  }

  const payload = decodeBase64UrlJson(payloadB64);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
    throw new AuthError('JWT token is not active yet (nbf claim).');
  }

  if (typeof payload.exp === 'number' && payload.exp <= nowSeconds) {
    throw new AuthError('JWT token has expired.');
  }

  const signature = Buffer.from(signatureB64, 'base64url');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const normalizedPublicKey = rawPublicKey.includes('\\n')
    ? rawPublicKey.replace(/\\n/g, '\n')
    : rawPublicKey;

  const valid = verifier.verify(normalizedPublicKey, signature);
  if (!valid) {
    throw new AuthError('Invalid JWT signature.');
  }
}

export function assertControlAuth(request: FastifyRequest, env: EnvSchema): void {
  const token = getBearerToken(request.headers.authorization);

  if (env.CONTROL_AUTH_MODE === 'token') {
    if (!env.CONTROL_SHARED_TOKEN) {
      throw new AuthError('CONTROL_SHARED_TOKEN is not configured.');
    }

    verifySharedToken(token, env.CONTROL_SHARED_TOKEN);
    return;
  }

  if (!env.CONTROL_JWT_PUBLIC_KEY) {
    throw new AuthError('CONTROL_JWT_PUBLIC_KEY is not configured.');
  }

  verifyJwt(token, env.CONTROL_JWT_PUBLIC_KEY);
}
