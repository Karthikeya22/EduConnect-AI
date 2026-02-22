
import { supabase } from './supabase';

export type LogAction = 'UPLOAD' | 'DELETE' | 'AI_QUERY' | 'LOGIN_EVENT' | 'DATABASE_UPDATE' | 'GRADE_ASSIGNMENT';

export const logActivity = async (action: LogAction, details: string, metadata: any = {}) => {
  // Fire and forget logging to avoid blocking UI.
  // Wrapped in a background worker with internal catch to suppress network failure errors.
  (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const sanitizedMetadata = { ...metadata };
      delete sanitizedMetadata.password;
      delete sanitizedMetadata.token;
      delete sanitizedMetadata.credential;

      const { error } = await supabase
        .from('platform_activity_logs')
        .insert({
          user_id: user?.id || 'anonymous',
          user_email: user?.email || 'unknown',
          action,
          details,
          metadata: sanitizedMetadata,
          created_at: new Date().toISOString()
        });

      if (error) console.warn('Activity log suppressed by system (auth limitation).');
    } catch (err: any) {
      // Quietly suppress "Failed to fetch" during background logging to prevent UI disruption
      if (err?.message?.includes("Failed to fetch")) {
        console.debug("Background logger deferred due to network unreachable state.");
      }
    }
  })();
};
