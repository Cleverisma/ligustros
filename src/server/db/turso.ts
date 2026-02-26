import { createClient } from '@libsql/client/web';
import type { RequestEventBase } from '@builder.io/qwik-city';

// Helper type to extract env from Qwik City request events or server$ contexts
export interface EnvContext {
    get: (key: string) => string | undefined;
}

/**
 * Creates and returns a libSQL/Turso database client compatible with Edge environments.
 * Uses the environment variables from the Qwik City request context.
 * 
 * @param env The environment getter function from `requestEvent.env` or `this.env`
 * @returns An initialized libSQL client instance
 */
export function getDbClient(env: EnvContext) {
    const url = env.get('PRIVATE_TURSO_DATABASE_URL');
    const authToken = env.get('PRIVATE_TURSO_AUTH_TOKEN');

    if (!url) {
        throw new Error('PRIVATE_TURSO_DATABASE_URL no está definida en las variables de entorno');
    }

    // Using /web submodule of @libsql/client ensures it works on Edge runtimes (Cloudflare, Vercel Edge, etc.)
    return createClient({
        url,
        authToken,
    });
}
