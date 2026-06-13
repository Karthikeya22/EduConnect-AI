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

        const { courseId, topicId, message, entryId } = await req.json()
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
