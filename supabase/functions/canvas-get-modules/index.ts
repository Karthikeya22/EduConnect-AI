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

        const { courseId } = await req.json()
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
