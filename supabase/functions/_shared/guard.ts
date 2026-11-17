// Pure request guard for Canvas Edge Functions (no Deno imports, so it is testable with vite-node).
//
// Identity: the caller's Supabase session JWT, checked by auth.getUser() (never the anon key).
// Access:   a non-revoked teacher/TA row in public.memberships for the configured Canvas host
//           and course, read with the caller's own JWT under RLS.
// The Canvas token is the caller's own (x-canvas-token); there is no server-wide token fallback.
// CORS only controls which browser origins may read responses; it is not authentication.

export const CANVAS_WRITES_ENABLED = false as const;

export interface GuardDeps {
    getEnv: (key: string) => string | undefined;
    /** Resolves the user id for a session JWT, null if the token is not a valid user session. */
    getUserId: (jwt: string) => Promise<string | null>;
    /** Active membership roles, or 'unavailable' when memberships cannot be read. */
    courseRoles: (jwt: string, userId: string, lmsHost: string, courseId: string) => Promise<string[] | 'unavailable'>;
}

export interface Guarded {
    cors: Record<string, string>;
    canvasToken: string;
    body: any;
    userId: string;
}

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, x-canvas-token';
const DEFAULT_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000,https://edu-connect-ai-three.vercel.app';
const STAFF_ROLES = new Set(['teacher', 'ta']);
const CANVAS_ID = /^\d{1,20}$/;

export function corsFor(req: Request, getEnv: GuardDeps['getEnv']): Record<string, string> {
    const allowed = (getEnv('ALLOWED_ORIGINS') || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('origin') || '';
    const headers: Record<string, string> = { 'Access-Control-Allow-Headers': ALLOW_HEADERS, Vary: 'Origin' };
    if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    return headers;
}

export function lmsHost(getEnv: GuardDeps['getEnv']): string {
    try {
        return new URL(getEnv('CANVAS_BASE_URL') || 'https://usflearn.instructure.com').hostname.toLowerCase();
    } catch {
        return '';
    }
}

export function canvasApiBase(getEnv: GuardDeps['getEnv']): string {
    return `https://${lmsHost(getEnv)}/api/v1`;
}

export async function guard(req: Request, deps: GuardDeps, opts: { course: boolean }): Promise<Guarded | Response> {
    const cors = corsFor(req, deps.getEnv);
    const deny = (error: string, status: number) =>
        new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors, status: 200 });

    const auth = req.headers.get('authorization') || '';
    const jwt = auth.slice(0, 7).toLowerCase() === 'bearer ' ? auth.slice(7).trim() : '';
    if (!jwt) return deny('AUTH_REQUIRED', 401);

    let userId: string | null;
    try {
        userId = await deps.getUserId(jwt);
    } catch {
        return deny('AUTH_UNAVAILABLE', 503);
    }
    if (!userId) return deny('INVALID_TOKEN', 401);

    let body: any = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        try {
            body = await req.json();
        } catch {
            return deny('INVALID_BODY', 400);
        }
    }

    if (opts.course) {
        const courseId = String(body?.courseId ?? '');
        if (!CANVAS_ID.test(courseId)) return deny('COURSE_REQUIRED', 400);
        const host = lmsHost(deps.getEnv);
        if (!host) return deny('AUTH_NOT_CONFIGURED', 503);
        let roles: string[] | 'unavailable';
        try {
            roles = await deps.courseRoles(jwt, userId, host, courseId);
        } catch {
            roles = 'unavailable';
        }
        if (roles === 'unavailable') return deny('AUTHZ_SETUP_REQUIRED', 503);
        if (!roles.some((r) => STAFF_ROLES.has(r))) return deny('COURSE_ACCESS_DENIED', 403);
    }

    const canvasToken = req.headers.get('x-canvas-token') || '';
    if (!canvasToken) return deny('CANVAS_TOKEN_REQUIRED', 400);
    return { cors, canvasToken, body, userId };
}
