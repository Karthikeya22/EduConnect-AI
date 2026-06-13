/**
 * rag_context.ts
 * RAG (Retrieval Augmented Generation) context retrieval layer.
 * Fetches course materials, rubric info, and instructor persona settings
 * from Supabase to build the knowledge base for grading.
 */

import { supabase } from '@/src/lib/supabase';
import type { PersonaConfig, RAGContext } from './prompt_templates';

interface CourseMaterial {
  id: string;
  title: string;
  topic: string | null;
  description: string;
  file_type: string;
  location_url?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch course materials from the instructional_materials table
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchCourseMaterials(
  assignmentTitle?: string,
  assignmentDescription?: string
): Promise<{ title: string; content: string }[]> {
  try {
    const { data, error } = await supabase
      .from('instructional_materials')
      .select('id, title, topic, description, file_type, location_url')
      .neq('file_type', 'folder_meta')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) {
      console.warn('[RAG] Failed to fetch course materials:', error?.message);
      return [];
    }

    // Score each material by relevance to the assignment
    const scoredMaterials = data.map((mat: CourseMaterial) => {
      let relevanceScore = 0;
      const matText = `${mat.title} ${mat.topic || ''} ${mat.description || ''}`.toLowerCase();
      const assignmentText = `${assignmentTitle || ''} ${assignmentDescription || ''}`.toLowerCase();

      // Extract keywords from assignment
      const keywords = assignmentText
        .replace(/<[^>]+>/g, '') // strip HTML
        .split(/\s+/)
        .filter(w => w.length > 3)
        .map(w => w.replace(/[^a-z0-9]/g, ''));

      // Score by keyword overlap
      for (const keyword of keywords) {
        if (keyword && matText.includes(keyword)) {
          relevanceScore += 2;
        }
      }

      // Bonus for topic match
      if (mat.topic && assignmentText.includes(mat.topic.toLowerCase())) {
        relevanceScore += 5;
      }

      // Bonus for syllabus/rubric materials (always relevant)
      const lowerTitle = mat.title.toLowerCase();
      if (lowerTitle.includes('syllabus') || lowerTitle.includes('rubric') ||
          lowerTitle.includes('guide') || lowerTitle.includes('instructions') ||
          lowerTitle.includes('objective') || lowerTitle.includes('outline')) {
        relevanceScore += 3;
      }

      return { ...mat, relevanceScore };
    });

    // Sort by relevance and take top materials
    const topMaterials = scoredMaterials
      .filter(m => m.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5);

    // If no relevant materials found, take the most recent ones as general context
    const selectedMaterials = topMaterials.length > 0
      ? topMaterials
      : scoredMaterials.slice(0, 3);

    // Build content summaries (we use title + description since full file content
    // would require downloading each file which is expensive)
    return selectedMaterials.map(mat => ({
      title: mat.title,
      content: [
        mat.topic ? `Topic/Category: ${mat.topic}` : '',
        mat.description ? `Description: ${mat.description}` : '',
        mat.file_type ? `File Type: ${mat.file_type}` : '',
        `Relevance Score: ${mat.relevanceScore}`
      ].filter(Boolean).join('\n')
    }));

  } catch (err) {
    console.error('[RAG] Error fetching course materials:', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch instructor persona from teacher_preferences table
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchInstructorPersona(): Promise<PersonaConfig | null> {
  try {
    const { data: authData } = await supabase.auth.getSession();
    if (!authData?.session?.user?.email) {
      console.warn('[RAG] No authenticated session found for persona lookup');
      return null;
    }

    const { data, error } = await supabase
      .from('teacher_preferences')
      .select('persona_settings')
      .eq('teacher_email', authData.session.user.email)
      .eq('course_id', 'BIG_DATA_2026')
      .single();

    if (error || !data?.persona_settings) {
      console.warn('[RAG] No persona settings found, using defaults');
      return null;
    }

    const ps = data.persona_settings as any;
    return {
      tone: ps.tone ?? 50,
      detail: ps.detail ?? 50,
      strictness: ps.strictness ?? 50,
      socratic: ps.socratic ?? false,
      originalityCheck: ps.originalityCheck ?? false,
      philosophy: ps.philosophy ?? '',
      greeting: ps.greeting ?? '',
      gradingSamples: ps.gradingSamples ?? []
    };

  } catch (err) {
    console.error('[RAG] Error fetching instructor persona:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the full RAG context for a grading session
// ─────────────────────────────────────────────────────────────────────────────

export async function buildRAGContext(
  assignmentInstructions: string,
  rubric: any[] | undefined,
  maxPoints: number,
  assignmentTitle?: string
): Promise<RAGContext> {
  // Fetch course materials and persona in parallel
  const [courseMaterials, persona] = await Promise.all([
    fetchCourseMaterials(assignmentTitle, assignmentInstructions),
    fetchInstructorPersona()
  ]);

  // Build rubric text
  let rubricText = '';
  if (rubric && rubric.length > 0) {
    rubricText = '\nGRADING RUBRIC:\n' + rubric.map(r =>
      `- Criteria: ${r.description}\n  Points: ${r.points}\n  Ratings: ${r.ratings?.map((rt: any) => `${rt.description} (${rt.points}pts)`).join(', ')}`
    ).join('\n');
    rubricText += '\n\nCRITICAL: Score STRICTLY according to this rubric. Deduct points exactly as specified.';
  }

  return {
    assignmentInstructions: assignmentInstructions.replace(/<[^>]+>/g, ''),
    rubricText,
    courseMaterials,
    persona,
    maxPoints
  };
}



