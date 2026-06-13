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
            return new Response(
                JSON.stringify({ error: 'Supabase Secret CANVAS_API_TOKEN is missing.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const { studentId, startTime, endTime } = await req.json()
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

        const data = await res.json()
        
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
