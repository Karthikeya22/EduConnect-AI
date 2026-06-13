import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CANVAS_BASE_URL = 'https://usflearn.instructure.com'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-canvas-token',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders, status: 200 })
    }

    try {
        const CANVAS_API_TOKEN = req.headers.get('x-canvas-token') || Deno.env.get('CANVAS_API_TOKEN')

        if (!CANVAS_API_TOKEN) {
            return new Response(
                JSON.stringify({ error: 'CANVAS_API_TOKEN is missing.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const { courseId, studentId } = await req.json()
        if (!courseId || !studentId) {
            return new Response(
                JSON.stringify({ error: 'courseId and studentId are required.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const headers = {
            'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
            'Accept': 'application/json',
        }

        // Fetch activity (page view hits by hour + participation records) and assignment data in parallel
        const [activityRes, assignmentsRes] = await Promise.all([
            fetch(
                `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/analytics/users/${studentId}/activity`,
                { headers }
            ),
            fetch(
                `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/analytics/users/${studentId}/assignments`,
                { headers }
            ),
        ])

        let activity = null
        let assignments = null

        if (activityRes.ok) {
            activity = await activityRes.json()
        } else {
            console.error(`Activity fetch failed: ${activityRes.status} ${activityRes.statusText}`)
            const errText = await activityRes.text()
            console.error(errText)
        }

        if (assignmentsRes.ok) {
            assignments = await assignmentsRes.json()
        } else {
            console.error(`Assignments fetch failed: ${assignmentsRes.status} ${assignmentsRes.statusText}`)
            const errText = await assignmentsRes.text()
            console.error(errText)
        }

        return new Response(
            JSON.stringify({ activity, assignments }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    }
})
