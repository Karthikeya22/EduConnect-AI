import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { guard } from '../_shared/guard.ts'
import { denoGuardDeps } from '../_shared/deno_deps.ts'

const CANVAS_BASE_URL = "https://usflearn.instructure.com"

serve(async (req) => {
    const g = await guard(req, denoGuardDeps, { course: true })
    if (g instanceof Response) return g
    const corsHeaders = g.cors

    try {
        const { courseId } = g.body
        const CANVAS_API_TOKEN = g.canvasToken

        if (!CANVAS_API_TOKEN) {
            throw new Error('CANVAS_API_TOKEN is not set')
        }

        // Validate the API token by making a simple request
        const authCheckResponse = await fetch(
            `${CANVAS_BASE_URL}/api/v1/users/self`,
            {
                headers: {
                    'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
                    'Accept': 'application/json',
                },
            }
        )

        if (!authCheckResponse.ok) {
            const errorText = await authCheckResponse.text();
            console.error(`Canvas API error: ${authCheckResponse.status} ${authCheckResponse.statusText}`, errorText);
            throw new Error(`Canvas API Auth Error: ${authCheckResponse.status} ${authCheckResponse.statusText}. Check your API token.`);
        }

        const authCheckData = await authCheckResponse.json()
        
        if (authCheckData.errors) {
            console.error("Canvas returned errors array:", authCheckData.errors);
            throw new Error(`Canvas API Auth Error: ${authCheckData.errors[0]?.message || 'Unknown'}`);
        }

        // 1. Fetch Todo items for pending grading
        const todoResponse = await fetch(
            `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/todo`,
            {
                headers: {
                    'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
                    'Accept': 'application/json',
                },
            }
        )
        const todoData = await todoResponse.json()

        // 2. Fetch Recent Submissions (Latest 10 across all student/assignments)
        // Canvas doesn't have a direct "recent across all" that is easy, 
        // but we can fetch recent activity or list submissions for all students.
        // For the dashboard, we'll fetch the most recent submissions.
        const submissionsResponse = await fetch(
            `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/students/submissions?student_ids[]=all&include[]=assignment&include[]=user&order=graded_at&order_direction=desc&per_page=10`,
            {
                headers: {
                    'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
                    'Accept': 'application/json',
                },
            }
        )
        const submissionsData = await submissionsResponse.json()

        return new Response(
            JSON.stringify({
                todo: todoData,
                recentSubmissions: submissionsData
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    }
})
