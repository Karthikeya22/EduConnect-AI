/**
 * graph_rag.ts
 * Manages the interactions with the Student Knowledge Graph.
 * Uses PostgREST / Supabase pgvector to find connected concepts based on student ID.
 */

import { supabase } from '@/src/lib/supabase';

export interface KnowledgeGraphInsight {
  studentId: string;
  masteredConcepts: string[];
  strugglingConcepts: string[];
  learningTrajectory: string;
}

/**
 * Retrieves the student's concept graph from Supabase.
 */
export async function getStudentKnowledgeGraph(
  studentId: string,
  currentAssignmentConcepts: string[]
): Promise<KnowledgeGraphInsight> {
  try {
    const { data, error } = await supabase
      .from('student_knowledge_graph')
      .select('concept_name, mastery_score')
      .eq('student_canvas_id', studentId);

    if (error) {
      console.error('[GraphRAG] Failed to fetch student graph:', error.message);
      throw error;
    }

    const masteredConcepts = data?.filter(row => row.mastery_score >= 0.7).map(row => row.concept_name) || [];
    const strugglingConcepts = data?.filter(row => row.mastery_score < 0.4).map(row => row.concept_name) || [];

    let trajectory = 'Student is building foundational knowledge.';
    if (masteredConcepts.length > strugglingConcepts.length) {
      trajectory = 'Student shows strong mastery of key concepts and is progressing well.';
    } else if (strugglingConcepts.length > 0) {
      trajectory = 'Student is struggling with some core concepts and may need additional scaffolding.';
    }

    return {
      studentId,
      masteredConcepts,
      strugglingConcepts,
      learningTrajectory: trajectory
    };
  } catch (err) {
    console.warn('[GraphRAG] Returning fallback due to error:', err);
    return {
      studentId,
      masteredConcepts: [],
      strugglingConcepts: [],
      learningTrajectory: 'Unable to load knowledge graph.'
    };
  }
}

/**
 * Extracts new concepts from a graded submission to update the graph database.
 */
export async function updateStudentKnowledgeGraph(
  studentId: string,
  courseId: string,
  conceptsCovered: string[],
  conceptsMissed: string[],
  gradePercentage: number
): Promise<void> {
  const adjustments = [
    ...conceptsCovered.map(concept => ({ concept, adjust: 0.15 * gradePercentage })), // Positive reinforcement
    ...conceptsMissed.map(concept => ({ concept, adjust: -0.1 })) // Negative reinforcement
  ];

  for (const { concept, adjust } of adjustments) {
    if (!concept) continue;
    
    await supabase.rpc('update_concept_mastery', {
      p_student_id: studentId,
      p_course_id: courseId,
      p_concept: concept,
      p_adjustment: adjust
    });
  }

  console.log(`[GraphRAG] Updated graph for ${studentId}: +, ${conceptsCovered.length} -, ${conceptsMissed.length}`);
}



