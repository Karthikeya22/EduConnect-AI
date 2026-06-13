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
                JSON.stringify({ error: 'Supabase Secret CANVAS_API_TOKEN is missing. Please set it using: npx supabase secrets set CANVAS_API_TOKEN=your_token' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const baseUrl = 'https://usflearn.instructure.com/api/v1/courses';
        const params = new URLSearchParams();
        params.append('enrollment_type', 'teacher');
        params.append('include[]', 'term');
        params.append('include[]', 'total_students');
        params.append('include[]', 'course_image');
        params.append('include[]', 'public_description');
        params.append('include[]', 'teachers');
        params.append('state[]', 'available');
        params.append('per_page', '100');

        console.log("Fetching courses from Canvas (with pagination)...")

        // Paginated fetch — follow Link: <...>; rel="next" headers
        let allCourses: any[] = [];
        let nextUrl: string | null = `${baseUrl}?${params.toString()}`;

        while (nextUrl) {
            const res = await fetch(nextUrl, {
                headers: { 'Authorization': `Bearer ${CANVAS_API_TOKEN}` },
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error(`Canvas API error: ${res.status} ${res.statusText}`, errorText);
                throw new Error(`Canvas API responded with ${res.status}: ${res.statusText}. Details: ${errorText.substring(0, 100)}`);
            }

            const page = await res.json();
            if (Array.isArray(page)) {
                allCourses = allCourses.concat(page);
            }

            // Parse Link header for next page
            const linkHeader = res.headers.get('Link') || '';
            const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            nextUrl = nextMatch ? nextMatch[1] : null;
        }

        console.log(`Successfully fetched ${allCourses.length} courses from Canvas (all pages).`)

        return new Response(
            JSON.stringify(allCourses),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    }
})
