import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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
            throw new Error('CANVAS_API_TOKEN not set')
        }

        const { courseId, assignmentId, studentId, grade, comment } = await req.json()
        if (!courseId || !assignmentId || !studentId) {
            throw new Error('courseId, assignmentId, and studentId are required')
        }

        const res = await fetch(`https://usflearn.instructure.com/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${studentId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                submission: { posted_grade: grade },
                comment: { text_comment: comment }
            })
        })

        if (!res.ok) {
            throw new Error(`Canvas API error: ${res.status} ${res.statusText}`)
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
