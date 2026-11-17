// Deno runtime bindings for guard.ts. SUPABASE_URL / SUPABASE_ANON_KEY are provided by the Edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { GuardDeps } from './guard.ts';

function userClient(jwt: string) {
    return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

export const denoGuardDeps: GuardDeps = {
    getEnv: (k) => Deno.env.get(k),
    getUserId: async (jwt) => {
        const { data, error } = await userClient(jwt).auth.getUser(jwt);
        if (error) {
            if ((error as { status?: number }).status && (error as { status: number }).status >= 500) throw error;
            return null;
        }
        return data.user?.id ?? null;
    },
    courseRoles: async (jwt, userId, lmsHost, courseId) => {
        const { data, error } = await userClient(jwt)
            .from('memberships')
            .select('role,revoked_at')
            .eq('user_id', userId)
            .eq('lms_host', lmsHost)
            .eq('course_id', courseId)
            .is('revoked_at', null);
        if (error) return 'unavailable';
        return (data ?? []).filter((r: { revoked_at: unknown }) => r.revoked_at == null).map((r: { role: string }) => r.role);
    },
};
