// Run: npx vite-node supabase/functions/_shared/guard.test.ts
// Local only: identity and memberships are fakes; the Deno runtime binding (deno_deps.ts) is NOT exercised.
import { CANVAS_WRITES_ENABLED, corsFor, guard, type GuardDeps } from './guard';

function assert(cond: unknown, msg: string) {
    if (!cond) throw new Error(`FAIL: ${msg}`);
}

const USERS: Record<string, string> = { 'jwt-teacher': 'u-teacher', 'jwt-forged': 'u-forged', 'jwt-revoked': 'u-revoked' };
const MEMBERSHIPS = [
    { user: 'u-teacher', host: 'usflearn.instructure.com', course: '11', role: 'teacher', revoked: false },
    { user: 'u-revoked', host: 'usflearn.instructure.com', course: '11', role: 'teacher', revoked: true },
    { user: 'u-forged', host: 'usflearn.instructure.com', course: '11', role: 'student', revoked: false },
];

function deps(over: Partial<GuardDeps> = {}): GuardDeps {
    return {
        getEnv: (k) => ({ ALLOWED_ORIGINS: 'https://app.example' } as Record<string, string>)[k],
        getUserId: async (jwt) => USERS[jwt] ?? null,
        courseRoles: async (_jwt, userId, host, courseId) =>
            MEMBERSHIPS.filter((m) => m.user === userId && m.host === host && m.course === courseId && !m.revoked).map((m) => m.role),
        ...over,
    };
}

function req(opts: { jwt?: string; body?: unknown; origin?: string; canvas?: string | null; method?: string; headers?: Record<string, string> }) {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
    if (opts.jwt) headers.authorization = `Bearer ${opts.jwt}`;
    if (opts.origin) headers.origin = opts.origin;
    if (opts.canvas !== null) headers['x-canvas-token'] = opts.canvas ?? 'ct';
    const method = opts.method ?? 'POST';
    return new Request('http://local/fn', {
        method,
        headers,
        body: method === 'OPTIONS' ? undefined : JSON.stringify(opts.body ?? { courseId: '11' }),
    });
}

async function status(r: Request, d = deps(), course = true) {
    const g = await guard(r, d, { course });
    if (g instanceof Response) return { status: g.status, error: (await g.json().catch(() => ({}))).error as string | undefined };
    return { status: 200, error: undefined, g };
}

async function main() {
    assert(CANVAS_WRITES_ENABLED === false, 'Canvas writes disabled in source');

    let r = await status(req({}));
    assert(r.status === 401 && r.error === 'AUTH_REQUIRED', `missing identity -> ${r.status}`);

    r = await status(req({ jwt: 'anon-key-or-garbage' }));
    assert(r.status === 401 && r.error === 'INVALID_TOKEN', `invalid identity -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-teacher' }), deps({ getUserId: async () => { throw new Error('auth down'); } }));
    assert(r.status === 503 && r.error === 'AUTH_UNAVAILABLE', `auth outage -> ${r.status}`);

    r = await status(req({
        jwt: 'jwt-forged',
        headers: { 'x-tenant-id': '11', 'x-llm-api-key': 'sk', 'x-user-role': 'teacher' },
    }));
    assert(r.status === 403 && r.error === 'COURSE_ACCESS_DENIED', `forged role/tenant/BYOK -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-teacher', body: { courseId: '22' } }));
    assert(r.status === 403 && r.error === 'COURSE_ACCESS_DENIED', `foreign course -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-revoked' }));
    assert(r.status === 403 && r.error === 'COURSE_ACCESS_DENIED', `revoked membership -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-teacher', body: { courseId: '11 or 1=1' } }));
    assert(r.status === 400 && r.error === 'COURSE_REQUIRED', `non-numeric course -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-teacher' }), deps({ courseRoles: async () => 'unavailable' }));
    assert(r.status === 503 && r.error === 'AUTHZ_SETUP_REQUIRED', `memberships unreadable -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-teacher', canvas: null }));
    assert(r.status === 400 && r.error === 'CANVAS_TOKEN_REQUIRED', `no caller Canvas token (no env fallback) -> ${r.status}`);

    r = await status(req({ jwt: 'jwt-teacher' }));
    assert(r.status === 200 && r.g!.userId === 'u-teacher' && r.g!.canvasToken === 'ct', 'authorized teacher passes');

    r = await status(req({ jwt: 'jwt-forged', body: {} }), deps(), false);
    assert(r.status === 200, 'identity-only route accepts any signed-in user');

    const allowed = corsFor(req({ origin: 'https://app.example' }), deps().getEnv);
    assert(allowed['Access-Control-Allow-Origin'] === 'https://app.example', 'approved origin echoed');
    const denied = corsFor(req({ origin: 'https://evil.example' }), deps().getEnv);
    assert(!('Access-Control-Allow-Origin' in denied), 'unapproved origin gets no CORS grant');

    const pre = await guard(req({ method: 'OPTIONS', origin: 'https://evil.example' }), deps(), { course: true });
    assert(pre instanceof Response && pre.status === 200 && !pre.headers.get('access-control-allow-origin'), 'preflight without grant');

    console.log('guard.test.ts PASS (15 cases)');
}

main().catch((e) => { console.error(e); process.exit(1); });
