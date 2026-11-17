// Run: npx vite-node supabase/functions/canvas-post-grade/handler.test.ts
import { handlePostGrade, PUBLICATION_ENABLED } from './handler';

let fetchCalls = 0;
let tokenEnvReads = 0;
let headerTokenReads = 0;
let identityCalls = 0;

const deps = {
    guard: {
        getEnv: (k: string) => {
            if (k === 'CANVAS_API_TOKEN') tokenEnvReads++;
            return undefined;
        },
        getUserId: async () => { identityCalls++; return 'u1'; },
        courseRoles: async () => { identityCalls++; return ['teacher']; },
    },
    fetchFn: (async () => { fetchCalls++; throw new Error('outbound fetch must not happen'); }) as unknown as typeof fetch,
};

function trackedRequest(body: string, method = 'POST'): Request {
    const req = new Request('http://local/canvas-post-grade', {
        method,
        headers: {
            'content-type': 'application/json',
            'x-canvas-token': 'header-token',
            authorization: 'Bearer user-jwt',
            origin: 'https://evil.example',
        },
        body: method === 'GET' || method === 'OPTIONS' ? undefined : body,
    });
    const origGet = req.headers.get.bind(req.headers);
    (req.headers as any).get = (k: string) => {
        if (k.toLowerCase() === 'x-canvas-token') headerTokenReads++;
        return origGet(k);
    };
    return req;
}

function assert(cond: unknown, msg: string) {
    if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
    assert(PUBLICATION_ENABLED === false, 'publication must be disabled in source');

    const valid = JSON.stringify({ courseId: '1', assignmentId: '2', studentId: '3', grade: 95, comment: 'x' });
    const r1 = await handlePostGrade(trackedRequest(valid), deps);
    assert(r1.status === 403, `direct invoke status ${r1.status}`);
    assert((await r1.json()).error === 'GRADE_PUBLICATION_DISABLED', 'typed error code');
    assert(r1.headers.get('access-control-allow-origin') === null, 'unapproved origin gets no CORS grant');

    const r2 = await handlePostGrade(trackedRequest('{not json'), deps);
    assert(r2.status === 403, `malformed body status ${r2.status}`);

    const r3 = await handlePostGrade(trackedRequest('', 'PUT'), deps);
    assert(r3.status === 403, `PUT status ${r3.status}`);

    const r4 = await handlePostGrade(trackedRequest('', 'OPTIONS'), deps);
    assert(r4.status === 200, 'OPTIONS preflight still answered');

    assert(fetchCalls === 0, `outbound fetch calls: ${fetchCalls}`);
    assert(tokenEnvReads === 0, `env token reads: ${tokenEnvReads}`);
    assert(headerTokenReads === 0, `header token reads: ${headerTokenReads}`);
    assert(identityCalls === 0, `identity/membership lookups: ${identityCalls}`);

    console.log('canvas-post-grade handler.test.ts PASS (4 cases, 0 fetch, 0 token reads, 0 identity calls)');
}

main().catch((e) => { console.error(e); process.exit(1); });
