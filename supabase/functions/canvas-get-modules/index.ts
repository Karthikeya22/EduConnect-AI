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
            throw new Error('CANVAS_API_TOKEN not set')
        }

        const { courseId } = g.body
        if (!courseId) {
            throw new Error('courseId is required')
        }

        const res = await fetch(`https://usflearn.instructure.com/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`, {
            headers: {
                'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
            },
        })

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Canvas API error: ${res.status} ${res.statusText}`, errorText);
            throw new Error(`Canvas API Auth Error: ${res.status} ${res.statusText}. Tokens might be invalid or expired.`);
        }

        const data = await res.json()
        
        if (data.errors) {
            console.error("Canvas returned errors array:", data.errors);
            throw new Error(`Canvas API Data Error: ${data.errors[0]?.message || 'Unknown'}`);
        }

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
