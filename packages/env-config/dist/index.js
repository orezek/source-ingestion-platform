import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { URL } from 'url'; // Built-in Node.js module
import {} from 'zod';
/**
 * Loads and validates environment variables from .env files.
 *
 * @param schema - The Zod schema to validate against.
 * @param importMetaUrl - Pass `import.meta.url` from the calling file.
 * @returns The validated, type-safe environment object.
 */
export function loadEnv(schema, importMetaUrl) {
    // Resolve the app directory from the caller path.
    const appEnvDir = path.dirname(new URL(importMetaUrl).pathname);
    // Use NODE_ENV if defined; default to development.
    const NODE_ENV = process.env.NODE_ENV || 'development';
    // Load env files with increasing override priority.
    const envFiles = [
        path.resolve(appEnvDir, '..', '.env'), // 1. Base .env
        path.resolve(appEnvDir, '..', `.env.${NODE_ENV}`), // 2. .env.development or .env.production
        path.resolve(appEnvDir, '..', '.env.local'), // 3. .env.local (highest priority)
    ];
    // Read each existing file into process.env.
    envFiles.forEach((filePath) => {
        if (fs.existsSync(filePath)) {
            dotenv.config({
                path: filePath,
                override: true,
            });
        }
    });
    // Validate loaded values against the provided schema.
    const parsedEnv = schema.safeParse(process.env);
    if (!parsedEnv.success) {
        const errors = parsedEnv.error.issues
            .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');
        throw new Error(`Environment variable validation failed:\n${errors}`);
    }
    return parsedEnv.data;
}
