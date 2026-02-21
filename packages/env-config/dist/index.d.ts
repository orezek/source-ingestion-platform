import { type z } from 'zod';
/**
 * Loads and validates environment variables from .env files.
 *
 * @param schema - The Zod schema to validate against.
 * @param importMetaUrl - Pass `import.meta.url` from the calling file.
 * @returns The validated, type-safe environment object.
 */
export declare function loadEnv<T extends z.ZodTypeAny>(schema: T, importMetaUrl: string): z.infer<T>;
//# sourceMappingURL=index.d.ts.map