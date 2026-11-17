import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { guard } from '../_shared/guard.ts'
import { denoGuardDeps } from '../_shared/deno_deps.ts'

const DEFAULT_CANVAS = 'https://usflearn.instructure.com'

function canvasBase(): string {
    const raw = Deno.env.get('CANVAS_BASE_URL') || DEFAULT_CANVAS
    return raw.replace(/\/$/, '')
}

function nextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    return nextMatch ? nextMatch[1] : null
}

async function fetchAllPages(startUrl: string, token: string): Promise<any[]> {
    const out: any[] = []
    let nextUrl: string | null = startUrl
    while (nextUrl) {
        const res = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
            const errorText = await res.text()
            throw new Error(`Canvas API ${res.status} ${res.statusText}: ${errorText.substring(0, 200)}`)
        }
        const page = await res.json()
        if (Array.isArray(page)) out.push(...page)
        else if (page && typeof page === 'object' && !page.errors) {
            // single object endpoints (e.g. folders/root) — caller handles
            return [page]
        }
        if (page?.errors) {
            throw new Error(page.errors[0]?.message || 'Canvas API data error')
        }
        nextUrl = nextPageUrl(res.headers.get('Link'))
    }
    return out
}

/** Recursively collect every file under the course Files tree (all folders, all pages). */
async function collectAllCourseFiles(courseId: string, token: string): Promise<any[]> {
    const base = canvasBase()
    const byId = new Map<string, any>()

    // 1) Course-level files list (paginated) — Canvas usually returns files across folders.
    const courseFilesUrl =
        `${base}/api/v1/courses/${courseId}/files?per_page=100&sort=updated_at&order=desc`
    try {
        const listed = await fetchAllPages(courseFilesUrl, token)
        for (const f of listed) {
            if (f?.id != null) byId.set(String(f.id), f)
        }
    } catch (e) {
        console.warn('course files list failed; continuing with folder walk', e)
    }

    // 2) Explicit folder walk so nested / empty-list edge cases still get every file.
    const rootRes = await fetch(`${base}/api/v1/courses/${courseId}/folders/root`, {
        headers: { Authorization: `Bearer ${token}` },
    })
    if (!rootRes.ok) {
        const errorText = await rootRes.text()
        throw new Error(`Canvas root folder ${rootRes.status}: ${errorText.substring(0, 200)}`)
    }
    const root = await rootRes.json()
    const queue: number[] = [root.id]
    const seenFolders = new Set<number>()

    while (queue.length > 0) {
        const folderId = queue.shift()!
        if (seenFolders.has(folderId)) continue
        seenFolders.add(folderId)

        const subfolders = await fetchAllPages(
            `${base}/api/v1/folders/${folderId}/folders?per_page=100`,
            token,
        )
        for (const folder of subfolders) {
            if (folder?.id != null && !seenFolders.has(folder.id)) queue.push(folder.id)
        }

        const files = await fetchAllPages(
            `${base}/api/v1/folders/${folderId}/files?per_page=100`,
            token,
        )
        for (const f of files) {
            if (f?.id != null) byId.set(String(f.id), f)
        }
    }

    return Array.from(byId.values())
}

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

        console.log(`Fetching ALL course files (folders + pagination) for course ${courseId}`)
        const data = await collectAllCourseFiles(String(courseId), CANVAS_API_TOKEN)
        console.log(`Collected ${data.length} unique course files`)

        return new Response(
            JSON.stringify(data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    } catch (error: any) {
        console.error('canvas-get-course-files failed', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    }
})
