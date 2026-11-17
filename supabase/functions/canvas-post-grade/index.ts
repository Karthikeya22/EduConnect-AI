import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handlePostGrade } from './handler.ts'
import { denoGuardDeps } from '../_shared/deno_deps.ts'

serve((req) => handlePostGrade(req, { guard: denoGuardDeps, fetchFn: fetch }))
