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

        const { courseId } = g.body
        if (!courseId) {
             return new Response(
                JSON.stringify({ error: 'courseId is required.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
            )
        }

        const summariesUrl = new URL(`https://usflearn.instructure.com/api/v1/courses/${courseId}/analytics/student_summaries`);
        summariesUrl.searchParams.append('per_page', '100');

        const usersUrl = new URL(`https://usflearn.instructure.com/api/v1/courses/${courseId}/users`);
        usersUrl.searchParams.append('enrollment_type[]', 'student');
        usersUrl.searchParams.append('per_page', '100');

        console.log(`Fetching student summaries and users for course ${courseId}...`)
        const [summariesRes, usersRes] = await Promise.all([
            fetch(summariesUrl.toString(), { headers: { 'Authorization': `Bearer ${CANVAS_API_TOKEN}` } }),
            fetch(usersUrl.toString(), { headers: { 'Authorization': `Bearer ${CANVAS_API_TOKEN}` } })
        ]);

        const data = await summariesRes.json()
        
        if (data.errors) {
            console.error("Canvas returned errors array:", data.errors);
            throw new Error(`Canvas API Auth Error: ${data.errors[0]?.message || 'Unknown'}`);
        }

        let usersData: any[] = [];
        if (usersRes.ok) {
            usersData = await usersRes.json();
        }

        let finalData = data;
        if (Array.isArray(data) && Array.isArray(usersData)) {
            const userMap = new Map();
            usersData.forEach((u: any) => userMap.set(String(u.id), u.name || u.sortable_name || u.short_name));
            
            finalData = data.map((s: any) => {
                if (s && s.id) {
                    const name = userMap.get(String(s.id));
                    if (name) s.student_name = name;
                }
                return s;
            });
        }

        return new Response(
            JSON.stringify(finalData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    }
})
