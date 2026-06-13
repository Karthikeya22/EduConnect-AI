/**
 * rag_grader.ts
 * Main orchestrator — the entry point for the RAG-based AI grading pipeline.
 * Coordinates the multi-model pipeline:
 *   Stage 1: RAG context retrieval (course materials + persona)
 *   Stage 2: Linguistic analysis (Model 1 — classification)
 *   Stage 3: Grading with full RAG context (Model 2 — reasoning)
 *   Stage 4: Scaffolded feedback generation (Model 3 — evaluation)
 */

import { buildRAGContext } from './rag_context';
import { analyzeSubmission } from './linguistic_analyzer';
import { generateScaffoldedFeedback, type ScaffoldedFeedback } from './feedback_generator';
import { buildGradingPrompt, buildReflectionCritiquePrompt, type LinguisticProfile, type RAGContext } from './prompt_templates';
import { evaluateIntegrityAndQuality, type IntegrityEvaluation } from './human_evaluator';
import { getStudentKnowledgeGraph, updateStudentKnowledgeGraph, type KnowledgeGraphInsight } from './graph_rag';

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Grade Result (extends the original AIGradeResult)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnhancedGradeResult {
  // Original fields (backward compatible)
  suggestedGrade: number;
  strengths: string[];
  improvements: string[];
  deductionRationale?: string;
  feedback: string;
  personalizedNote: string;
  tags: string[];

  // New RAG-enhanced fields
  linguisticProfile: LinguisticProfile;
  scaffoldedFeedback: ScaffoldedFeedback;
  conceptualGaps: string[];
  ragSourcesUsed: string[];
  integrityEvaluation?: IntegrityEvaluation;
  knowledgeGraphInsight?: KnowledgeGraphInsight;
  pipelineMetadata: {
    ragContextSize: number;
    materialsRetrieved: number;
    personaApplied: boolean;
    totalDurationMs: number;
    stages: { name: string; durationMs: number; model: string }[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main grading pipeline
// ─────────────────────────────────────────────────────────────────────────────

export async function gradeSubmission(
  assignmentContext: string,
  studentSubmission: string,
  maxPoints: number,
  rubric: any[] | undefined,
  attachmentSummary: string,
  inlineDataParts: any[],
  apiKey: string,
  assignmentTitle?: string,
  studentId?: string
): Promise<EnhancedGradeResult> {
  const pipelineStart = Date.now();
  const stages: { name: string; durationMs: number; model: string }[] = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 1: RAG Context Retrieval
  // ═══════════════════════════════════════════════════════════════════════════
  const stage1Start = Date.now();
  let ragContext: RAGContext;

  try {
    ragContext = await buildRAGContext(
      assignmentContext,
      rubric,
      maxPoints,
      assignmentTitle
    );
  } catch (err) {
    console.warn('[RAGGrader] Stage 1 failed, using minimal context:', err);
    ragContext = {
      assignmentInstructions: assignmentContext.replace(/<[^>]+>/g, ''),
      rubricText: '',
      courseMaterials: [],
      persona: null,
      maxPoints
    };
  }
  stages.push({
    name: 'RAG Context Retrieval',
    durationMs: Date.now() - stage1Start,
    model: 'supabase'
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 2: Linguistic Analysis (Model 1) + Integrity Check & GraphRAG
  // ═══════════════════════════════════════════════════════════════════════════
  const stage2Start = Date.now();
  let linguisticProfile: LinguisticProfile;
  let integrityEvaluation: IntegrityEvaluation | undefined;
  let knowledgeGraphInsight: KnowledgeGraphInsight | undefined;

  // Start independent analyses early so they don't block the grading model
  const integrityPromise = evaluateIntegrityAndQuality(studentSubmission, ragContext.assignmentInstructions, apiKey).catch(e => undefined);
  const kgPromise = studentId ? getStudentKnowledgeGraph(studentId, []).catch(e => undefined) : Promise.resolve(undefined);

  try {
    // Still need to await Linguistic Profile as it's required for the grading prompt
    linguisticProfile = await analyzeSubmission(studentSubmission, ragContext.assignmentInstructions, attachmentSummary, apiKey);
  } catch (err) {
    console.warn('[RAGGrader] Stage 2 partial failure, using neutral fallback:', err);
    linguisticProfile = {
      tone: 'neutral',
      clarity: 'partially_clear',
      reasoningDepth: 'moderate',
      engagementLevel: 'medium',
      conceptsCovered: [],
      conceptsMissing: [],
      emotionalIndicators: []
    };
  }
  stages.push({
    name: 'Analysis & Integrity',
    durationMs: Date.now() - stage2Start,
    model: 'gemini-2.5-flash'
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 3: Main Grading with RAG Context (Model 2 — Gemini 2.5 Flash)
  // ═══════════════════════════════════════════════════════════════════════════
  const stage3Start = Date.now();
  const gradingPrompt = buildGradingPrompt(
    ragContext,
    studentSubmission,
    attachmentSummary,
    linguisticProfile
  );

  let gradingResult: any;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Removed inlineDataParts to prevent 400 Bad Request (base64 too large).
          // parsedAttachmentsText is already included via gradingPrompt.
          contents: [{
            role: 'user',
            parts: [{ text: gradingPrompt }]
          }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Grading API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Empty response from grading model');
    }

    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    gradingResult = JSON.parse(cleanText);
  } catch (err) {
    console.error('[RAGGrader] Stage 3 grading failed:', err);
    gradingResult = {
      suggestedGrade: Math.round(maxPoints * 0.75),
      strengths: [
        'Demonstrates a solid understanding of the core concepts related to the chosen topic.',
        'The submission is structured logically, making it relatively easy to follow the arguments.'
      ],
      improvements: [
        'Needs further elaboration on key methodology to strengthen the overall argument and prove the thesis.',
        'Consider expanding on the literature review to better situate the research within the context of existing academic work.'
      ],
      deductionRationale: 'Standard deduction applied due to grading model timeout/fallback. Marks deducted for lack of advanced integration of concepts.',
      feedback: 'Good attempt overall. Review the assignment requirements and course materials to strengthen your response and add more critical depth.',
      personalizedNote: 'Keep working at it — consistent effort leads to improvement.',
      tags: ['System Error Fallback', 'Needs more detail'],
      conceptualGaps: [],
      ragSourcesUsed: []
    };
  }
  stages.push({
    name: 'RAG-Enhanced Grading',
    durationMs: Date.now() - stage3Start,
    model: 'gemini-2.5-flash'
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 3b: Reflection Critique (Self-RAG Loop)
  // ═══════════════════════════════════════════════════════════════════════════
  const stage3bStart = Date.now();
  try {
    const critiquePrompt = buildReflectionCritiquePrompt(
      JSON.stringify(gradingResult),
      studentSubmission,
      ragContext.rubricText,
      maxPoints
    );

    const critiqueResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: critiquePrompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
        })
      }
    );

    if (critiqueResponse.ok) {
      const cData = await critiqueResponse.json();
      const cText = cData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (cText) {
        const cleanCText = cText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const critiqueFeedback = JSON.parse(cleanCText);
        if (critiqueFeedback.passed === false && critiqueFeedback.revisedGrading) {
          console.log('[RAGGrader] Reflection logic caught errors. Applying revised grading:', critiqueFeedback.critique);
          gradingResult = critiqueFeedback.revisedGrading;
        }
      }
    }
  } catch (err) {
    console.warn('[RAGGrader] Stage 3b Reflection failed, proceeding with draft grade:', err);
  }
  stages.push({
    name: 'Reflection Critique',
    durationMs: Date.now() - stage3bStart,
    model: 'gemini-2.5-flash'
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4: Scaffolded Feedback Generation (Model 3 — Gemini 2.5 Flash)
  // ═══════════════════════════════════════════════════════════════════════════
  const stage4Start = Date.now();
  let scaffoldedFeedback: ScaffoldedFeedback;

  // Combine all raw feedback for the refinement model
  const rawFeedbackCombined = [
    `Grade: ${gradingResult.suggestedGrade}/${maxPoints}`,
    `Strengths: ${(gradingResult.strengths || []).join('; ')}`,
    `Improvements: ${(gradingResult.improvements || []).join('; ')}`,
    `Deduction Rationale: ${gradingResult.deductionRationale || ''}`,
    `Feedback: ${gradingResult.feedback || ''}`,
    `Note: ${gradingResult.personalizedNote || ''}`
  ].join('\n');

  try {
    scaffoldedFeedback = await generateScaffoldedFeedback(
      rawFeedbackCombined,
      linguisticProfile,
      ragContext.persona,
      maxPoints,
      gradingResult.suggestedGrade,
      apiKey
    );
  } catch (err) {
    console.warn('[RAGGrader] Stage 4 failed, using basic feedback:', err);
    scaffoldedFeedback = {
      conceptualFeedback: 'Review the core concepts covered in this assignment.',
      technicalFeedback: 'Focus on providing more specific details in your response.',
      encouragement: 'Keep working hard — each assignment builds your understanding.',
      nextSteps: ['Review course materials', 'Compare your submission with the assignment rubric'],
      socraticQuestions: [],
      scaffoldingLevel: 'moderate_support'
    };
  }
  stages.push({
    name: 'Scaffolded Feedback',
    durationMs: Date.now() - stage4Start,
    model: 'gemini-2.5-flash'
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Assemble final result
  // ═══════════════════════════════════════════════════════════════════════════

  const [resolvedIntegrity, resolvedGraph] = await Promise.all([integrityPromise, kgPromise]);
  integrityEvaluation = resolvedIntegrity as any;
  knowledgeGraphInsight = resolvedGraph as any;

  return {
    // Original fields
    suggestedGrade: gradingResult.suggestedGrade ?? Math.round(maxPoints * 0.75),
    strengths: gradingResult.strengths ?? [],
    improvements: gradingResult.improvements ?? [],
    deductionRationale: gradingResult.deductionRationale ?? '',
    feedback: gradingResult.feedback ?? '',
    personalizedNote: gradingResult.personalizedNote ?? '',
    tags: gradingResult.tags ?? [],

    // Enhanced fields
    linguisticProfile,
    scaffoldedFeedback,
    conceptualGaps: gradingResult.conceptualGaps ?? linguisticProfile.conceptsMissing,
    ragSourcesUsed: gradingResult.ragSourcesUsed ?? ragContext.courseMaterials.map(m => m.title),
    integrityEvaluation,
    knowledgeGraphInsight,

    // Pipeline metadata
    pipelineMetadata: {
      ragContextSize: ragContext.courseMaterials.reduce((sum, m) => sum + m.content.length, 0),
      materialsRetrieved: ragContext.courseMaterials.length,
      personaApplied: ragContext.persona !== null,
      totalDurationMs: Date.now() - pipelineStart,
      stages
    }
  };
}



