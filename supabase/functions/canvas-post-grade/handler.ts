// Pure handler (no Deno imports) so it can be exercised locally with mocks.
//
// PUBLICATION_ENABLED is containment: it stops grade writes to Canvas before any
// identity, token or network work. Enabling it requires a code change + review AND
// a real instructor approval gate; there is intentionally no env var or test override.
// If it is ever enabled, the course-membership guard below still applies.
import { corsFor, guard, type GuardDeps } from '../_shared/guard.ts';

export const PUBLICATION_ENABLED = false as const;

export interface PostGradeDeps {
    guard: GuardDeps;
    fetchFn: typeof fetch;
}

export async function handlePostGrade(req: Request, deps: PostGradeDeps): Promise<Response> {
    const cors = corsFor(req, deps.guard.getEnv);
    const json = (body: unknown, status: number) =>
        new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' }, status });

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors, status: 200 });
    }

    // Must stay before any token resolution or outbound request.
    if (!PUBLICATION_ENABLED) {
        return json({ error: 'GRADE_PUBLICATION_DISABLED' }, 403);
    }

    const g = await guard(req, deps.guard, { course: true });
    if (g instanceof Response) return g;

    try {
        const { courseId, assignmentId, studentId, grade, comment } = g.body;
        if (!assignmentId || !studentId) {
            return json({ error: 'courseId, assignmentId, and studentId are required' }, 400);
        }

        const res = await deps.fetchFn(
            `https://usflearn.instructure.com/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${studentId}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${g.canvasToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    submission: { posted_grade: grade },
                    comment: { text_comment: comment },
                }),
            },
        );
        if (!res.ok) {
            return json({ error: `Canvas API error: ${res.status} ${res.statusText}` }, 502);
        }
        return json({ success: true, data: await res.json() }, 200);
    } catch (error: any) {
        return json({ error: error?.message || 'Unknown error' }, 500);
    }
}
