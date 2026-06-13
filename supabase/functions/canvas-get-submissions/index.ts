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

        const { courseId, assignmentId } = await req.json()
        if (!courseId) {
            throw new Error('courseId is required')
        }

        const url = assignmentId
            ? `https://usflearn.instructure.com/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=user&include[]=submission_comments&include[]=submission_history&per_page=100`
            : `https://usflearn.instructure.com/api/v1/courses/${courseId}/students/submissions?student_ids[]=all&include[]=user&include[]=assignment&include[]=submission_comments&include[]=submission_history&per_page=100`;

        let data: any[] = [];
        let currentUrl: string | null = url;

        while (currentUrl) {
            const res = await fetch(currentUrl, {
                headers: {
                    'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
                },
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error(`Canvas API error: ${res.status} ${res.statusText}`, errorText);
                throw new Error(`Canvas API Auth Error: ${res.status} ${res.statusText}. Check your API token.`);
            }

            const pageData = await res.json();
            
            if (pageData.errors) {
                console.error("Canvas returned errors array:", pageData.errors);
                throw new Error(`Canvas API Auth Error: ${pageData.errors[0]?.message || 'Unknown'}`);
            }

            if (Array.isArray(pageData)) {
                data = data.concat(pageData);
            } else {
                data.push(pageData);
            }

            currentUrl = null;
            const linkHeader = res.headers.get('Link');
            if (linkHeader) {
                const links = linkHeader.split(',');
                const nextLink = links.find(link => link.includes('rel="next"'));
                if (nextLink) {
                    const match = nextLink.match(/<([^>]+)>/);
                    if (match) {
                        currentUrl = match[1];
                    }
                }
            }
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
