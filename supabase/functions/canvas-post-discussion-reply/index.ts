import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CANVAS_WRITES_ENABLED, corsFor, guard } from '../_shared/guard.ts'
import { denoGuardDeps } from '../_shared/deno_deps.ts'


serve(async (req) => {
    if (!CANVAS_WRITES_ENABLED && req.method !== 'OPTIONS') {
        return new Response(JSON.stringify({ error: 'CANVAS_WRITES_DISABLED' }), {
            status: 403,
            headers: { ...corsFor(req, denoGuardDeps.getEnv), 'Content-Type': 'application/json' },
        })
    }
    const g = await guard(req, denoGuardDeps, { course: true })
    if (g instanceof Response) return g
    const corsHeaders = g.cors

    try {
        const CANVAS_API_TOKEN = g.canvasToken

        if (!CANVAS_API_TOKEN) {
            throw new Error('CANVAS_API_TOKEN not set')
        }

        const { courseId, topicId, message, entryId } = g.body
        if (!courseId || !topicId || !message) {
            throw new Error('courseId, topicId, and message are required')
        }

        // If entryId is provided, reply to a specific entry; otherwise post a top-level entry
        const url = entryId
            ? `https://usflearn.instructure.com/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries/${entryId}/replies`
            : `https://usflearn.instructure.com/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        })

        if (!res.ok) {
            const errText = await res.text()
            throw new Error(`Canvas API error: ${res.status} ${res.statusText} - ${errText}`)
        }

        const data = await res.json()

        return new Response(
            JSON.stringify({ success: true, data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    }
})
