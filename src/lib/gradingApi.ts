import { gradingApiBase } from './llmProviders';

/**
 * Headers for every grading-server call: the Supabase session token (identity,
 * verified server-side) and the teacher's Canvas token (used by the server only
 * against the configured Canvas host). Access itself comes from server-side
 * course memberships, never from anything sent here.
 */
export async function gradingAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const { supabase } = await import('./supabase');
  const { data } = await supabase.auth.getSession();
  // The mock/backdoor session has no access_token, so the server denies it.
  const accessToken = (data.session as { access_token?: string } | null)?.access_token;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const canvasToken = localStorage.getItem('custom_canvas_token');
  if (canvasToken) headers['X-Canvas-Token'] = canvasToken;
  return headers;
}

/** Throws before fetch when the browser session cannot authenticate to the grading server. */
export async function requireGradingSession(): Promise<string> {
  const { supabase } = await import('./supabase');
  const { data } = await supabase.auth.getSession();
  const accessToken = (data.session as { access_token?: string } | null)?.access_token;
  if (accessToken) return accessToken;
  let mock = false;
  try {
    mock = Boolean(localStorage.getItem('mock_user'));
  } catch {
    mock = false;
  }
  throw new Error(
    mock
      ? 'Demo instructor login cannot call the grading server. Sign out and sign in with your real instructor account, then verify Canvas + LLM keys.'
      : AUTH_MESSAGES.AUTH_REQUIRED,
  );
}

export function activeCourseId(): string {
  try {
    return String(JSON.parse(localStorage.getItem('active_canvas_course') || '{}')?.id ?? '');
  } catch {
    return '';
  }
}

const AUTH_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in again to use AI grading. Demo/mock instructor login is not accepted by the grading server.',
  INVALID_TOKEN: 'Your session is invalid. Sign in again.',
  TOKEN_EXPIRED: 'Your session expired. Sign in again.',
  COURSE_ACCESS_DENIED: 'You are not registered as a teacher or TA of this course in EduConnect. Ask the project owner to add your membership.',
  ASSIGNMENT_NOT_IN_COURSE: 'This assignment does not belong to the selected course.',
  ASSIGNMENT_SCOPE_UNVERIFIED: 'Connect your Canvas token so the assignment can be verified.',
  COURSE_REQUIRED: 'Select a course first.',
  ASSIGNMENT_REQUIRED: 'Select an assignment first.',
  AUTHZ_SETUP_REQUIRED:
    'Course access is not set up: the memberships migration has not been applied (or your teacher row is missing). Ask the project owner to apply grading_server/migrations/2026_10_31_authz_scope.sql and bootstrap_memberships.template.sql — see docs/research/baseline.md §7.',
  AUTH_NOT_CONFIGURED: 'The grading server authentication is not configured.',
  AUTH_UNAVAILABLE: 'Access could not be verified right now. Try again shortly.',
  CANVAS_TOKEN_REQUIRED: 'Enter a Canvas token before verifying.',
  CANVAS_HOST_INVALID: 'Enter a valid HTTPS Canvas base URL.',
  CANVAS_TOKEN_INVALID: 'Canvas rejected that token. Check it and try again.',
};

/** User-facing message for an authorization error body, or null if it is not one. */
export function authErrorMessage(body: unknown): string | null {
  const code = (body as { error?: unknown } | null)?.error;
  return typeof code === 'string' && code in AUTH_MESSAGES ? AUTH_MESSAGES[code] : null;
}

export interface CanvasMembershipSyncResult {
  count: number;
  lms_host: string;
  synced: { course_id: string; role: string }[];
}

/**
 * Syncs memberships that the authenticated user's Canvas account reports as
 * teacher/TA. The server derives courses from Canvas; the browser supplies
 * only the selected Canvas host.
 */
export async function syncCanvasMemberships(
  canvasBaseUrl: string,
): Promise<CanvasMembershipSyncResult> {
  const headers = {
    'Content-Type': 'application/json',
    ...(await gradingAuthHeaders()),
  };
  const res = await fetch(`${gradingApiBase()}/api/authz/sync-canvas-memberships`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ canvas_base_url: canvasBaseUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      authErrorMessage(body)
      || (body as { message?: string; error?: string }).message
      || (body as { error?: string }).error
      || `Sync failed (${res.status})`,
    );
  }
  return body as CanvasMembershipSyncResult;
}
