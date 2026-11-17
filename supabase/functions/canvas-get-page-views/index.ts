import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { guard } from '../_shared/guard.ts'
import { denoGuardDeps } from '../_shared/deno_deps.ts'


serve(async (req) => {
    const g = await guard(req, denoGuardDeps, { course: true })
    if (g instanceof Response) return g
    const corsHeaders = g.cors

    try {
        const CANVAS_API_TOKEN = g.canvasToken

        if (!CANVAS_API_TOKEN) {
            return new Response(
                JSON.stringify({ error: 'Supabase Secret CANVAS_API_TOKEN is missing.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const { studentId, startTime, endTime } = g.body
        if (!studentId) {
             return new Response(
                JSON.stringify({ error: 'studentId is required.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const apiUrl = new URL(`https://usflearn.instructure.com/api/v1/users/${studentId}/page_views`);
        apiUrl.searchParams.append('per_page', '100');
        if (startTime) apiUrl.searchParams.append('start_time', startTime);
        if (endTime) apiUrl.searchParams.append('end_time', endTime);

        console.log(`Fetching page views for student ${studentId}...`)
        const res = await fetch(apiUrl.toString(), {
            headers: {
                'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
            },
        })

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Canvas API error: ${res.status} ${res.statusText}`, errorText);
            throw new Error(`Canvas API responded with ${res.status}: ${res.statusText}. Details: ${errorText}`);
        }

        // Canvas page views are user-wide; only views inside the authorized course are returned.
        const coursePath = `/courses/${g.body.courseId}`
        const all = await res.json()
        const data = Array.isArray(all)
            ? all.filter((v: any) => typeof v?.url === 'string' && new RegExp(`${coursePath}(/|$|\\?)`).test(v.url))
            : []

        return new Response(
            JSON.stringify(data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    }
})
