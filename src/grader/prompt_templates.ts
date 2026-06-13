/**
 * prompt_templates.ts
 * Centralized prompt engineering templates for the RAG-based AI grading system.
 * Each template incorporates instructor persona settings, course context, and
 * educational scaffolding instructions.
 */

export interface PersonaConfig {
  tone: number;        // 0 (Professional) → 100 (Friendly)
  detail: number;      // 0 (Concise) → 100 (Verbose)
  strictness: number;  // 0 (Lenient) → 100 (Rigorous)
  socratic: boolean;
  originalityCheck: boolean;
  philosophy: string;
  greeting: string;
  gradingSamples?: { input: string; output: string; grade?: string }[];
}

export interface RAGContext {
  assignmentInstructions: string;
  rubricText: string;
  courseMaterials: { title: string; content: string }[];
  persona: PersonaConfig | null;
  maxPoints: number;
}

export interface LinguisticProfile {
  tone: 'confident' | 'confused' | 'frustrated' | 'neutral' | 'uncertain';
  clarity: 'clear' | 'partially_clear' | 'unclear';
  reasoningDepth: 'surface' | 'moderate' | 'deep';
  engagementLevel: 'high' | 'medium' | 'low';
  conceptsCovered: string[];
  conceptsMissing: string[];
  emotionalIndicators: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build persona instruction block from config
// ─────────────────────────────────────────────────────────────────────────────

function buildPersonaBlock(persona: PersonaConfig | null): string {
  if (!persona) {
    return `Persona: You are a balanced, professional instructor. Provide clear, constructive feedback.`;
  }

  const toneDesc = persona.tone < 30 ? 'cold, clinical, and strictly professional'
    : persona.tone < 60 ? 'professional but approachable'
    : persona.tone < 80 ? 'warm and encouraging'
    : 'very friendly, supportive, and conversational';

  const detailDesc = persona.detail < 30 ? 'extremely concise — bullet points only'
    : persona.detail < 60 ? 'moderately detailed'
    : 'thorough and verbose with explanations';

  const strictDesc = persona.strictness < 30 ? 'lenient — give benefit of the doubt'
    : persona.strictness < 60 ? 'moderately strict'
    : persona.strictness < 80 ? 'rigorous — deduct for missing elements'
    : 'extremely strict — zero tolerance for errors or missing requirements';

  let block = `
INSTRUCTOR PERSONA:
- Communication Tone: ${toneDesc} (${persona.tone}/100)
- Detail Level: ${detailDesc} (${persona.detail}/100)
- Grading Strictness: ${strictDesc} (${persona.strictness}/100)
- Teaching Philosophy: "${persona.philosophy}"
- Greeting Style: "${persona.greeting}"`;

  if (persona.socratic) {
    block += `\n- Method: SOCRATIC — Lead with guiding questions. Do NOT give direct answers. Help the student discover the answer themselves.`;
  }

  if (persona.originalityCheck) {
    block += `\n- Originality Check: ENABLED — Flag any signs of plagiarism, AI-generated content, or copied material.`;
  }

  if (persona.gradingSamples && persona.gradingSamples.length > 0) {
    block += `\n\nFEW-SHOT GRADING EXAMPLES FROM THIS INSTRUCTOR:`;
    persona.gradingSamples.slice(0, 3).forEach((sample, i) => {
      block += `\n--- Example ${i + 1} ---`;
      block += `\nStudent Input: ${sample.input.substring(0, 500)}`;
      block += `\nInstructor Response: ${sample.output.substring(0, 500)}`;
      if (sample.grade) block += `\nGrade Given: ${sample.grade}`;
    });
    block += `\n--- End of Examples ---`;
    block += `\nIMPORTANT: Mirror the instructor's grading style, tone, and expectations shown in these examples.`;
  }

  return block;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1: Linguistic Analysis Prompt (Model 1 — Classification)
// ─────────────────────────────────────────────────────────────────────────────

export function buildLinguisticAnalysisPrompt(
  submission: string,
  assignmentInstructions: string,
  attachmentSummary: string
): string {
  return `You are an expert educational psychologist and linguistics analyzer. Your job is to analyze a student's submission and classify their linguistic features to help an AI grading assistant provide personalized feedback.

ASSIGNMENT INSTRUCTIONS:
${assignmentInstructions || 'No specific instructions provided.'}

STUDENT SUBMISSION:
${submission}
${attachmentSummary ? `\nATTACHMENT CONTENT:\n${attachmentSummary}` : ''}

Analyze the submission and return a strict JSON object with EXACTLY these keys:
- tone: (string) One of: "confident", "confused", "frustrated", "neutral", "uncertain". Assess the student's emotional tone from their writing.
- clarity: (string) One of: "clear", "partially_clear", "unclear". How well-organized and articulate is the response.
- reasoningDepth: (string) One of: "surface", "moderate", "deep". Does the student just state facts, or do they analyze, synthesize, and critically evaluate?
- engagementLevel: (string) One of: "high", "medium", "low". Level of effort and engagement visible in the submission.
- conceptsCovered: (array of strings) Key concepts from the assignment that the student DID address.
- conceptsMissing: (array of strings) Key concepts from the assignment that the student did NOT address or addressed inadequately.
- emotionalIndicators: (array of strings) 2-3 specific phrases or patterns from the submission that informed your tone assessment.

ONLY output valid JSON. No markdown.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 2: Main Grading Prompt (Model 2 — Reasoning + Evaluation)
// ─────────────────────────────────────────────────────────────────────────────

export function buildGradingPrompt(
  ragContext: RAGContext,
  submission: string,
  attachmentSummary: string,
  linguisticProfile: LinguisticProfile
): string {
  const { assignmentInstructions, rubricText, courseMaterials, persona, maxPoints } = ragContext;

  // Build course materials context
  let materialsBlock = '';
  if (courseMaterials.length > 0) {
    materialsBlock = '\n\nRELEVANT COURSE MATERIALS (use these as the knowledge base for grading):';
    courseMaterials.forEach((mat, i) => {
      const truncated = mat.content.length > 5000
        ? mat.content.substring(0, 5000) + '\n... [TRUNCATED]'
        : mat.content;
      materialsBlock += `\n\n--- Material ${i + 1}: ${mat.title} ---\n${truncated}`;
    });
    materialsBlock += '\n--- End of Course Materials ---';
  }

  // Build linguistic context
  const linguisticBlock = `
STUDENT LINGUISTIC PROFILE (from pre-analysis):
- Emotional Tone: ${linguisticProfile.tone}
- Writing Clarity: ${linguisticProfile.clarity}
- Reasoning Depth: ${linguisticProfile.reasoningDepth}
- Engagement Level: ${linguisticProfile.engagementLevel}
- Concepts Covered: ${linguisticProfile.conceptsCovered.join(', ') || 'None identified'}
- Concepts Missing: ${linguisticProfile.conceptsMissing.join(', ') || 'None identified'}

ADAPT YOUR FEEDBACK BASED ON THIS PROFILE:
${linguisticProfile.tone === 'frustrated' ? '- Student appears frustrated. Be encouraging and empathetic. Highlight what they did well before suggesting improvements.' : ''}
${linguisticProfile.tone === 'confused' ? '- Student appears confused. Provide clear explanations. Break down complex concepts. Give concrete examples.' : ''}
${linguisticProfile.tone === 'confident' ? '- Student appears confident. You can be more direct with criticism. Challenge them to go deeper.' : ''}
${linguisticProfile.clarity === 'unclear' ? '- Student writing is unclear. Provide specific guidance on how to better organize and articulate their ideas.' : ''}
${linguisticProfile.reasoningDepth === 'surface' ? '- Student reasoning is surface-level. Encourage deeper analysis and critical thinking.' : ''}`;

  return `You are an expert AI grading assistant acting as a DUPLICATION of the course instructor. Grade this student's submission as if you ARE the professor.

Max points possible: ${maxPoints}.

${buildPersonaBlock(persona)}

ASSIGNMENT INSTRUCTIONS:
${assignmentInstructions || 'No specific instructions provided.'}

${rubricText}
${materialsBlock}

${linguisticBlock}

STUDENT SUBMISSION:
${submission}
${attachmentSummary ? `\nATTACHMENT CONTENT:\n${attachmentSummary}` : ''}

GRADING INSTRUCTIONS:
1. Grade according to the rubric (if provided), but BE LENIENT. Only deduct from the max points when perfectly necessary for major omissions.
2. Your grade should reflect the instructor's strictness level, but generally give the student the benefit of the doubt.
3. Reference specific course materials when explaining why something is correct or incorrect.
4. IMPORTANT: Make sure deductionRationale explains EXACTLY why the student got the score they did out of the max possible points. Give specific reasons for every point lost.

Provide your evaluation as a strict JSON object with EXACTLY these keys:
- suggestedGrade: (number) The numerical score out of ${maxPoints}.
- strengths: (array of strings) 2-3 specific strengths, referencing what the student did well.
- improvements: (array of strings) 2-3 specific areas for improvement with actionable guidance.
- deductionRationale: (string) A clear explanation of exactly why points were deducted from the max points (if any), referencing the rubric.
- feedback: (string) A 3-4 sentence paragraph of educational feedback addressed to the student. Reference course concepts.
- personalizedNote: (string) A personalized 1-2 sentence note adapted to the student's emotional tone and engagement level.
- tags: (array of strings) 3-5 short labels characterizing the submission.
- conceptualGaps: (array of strings) Specific concepts from the course materials that the student should revisit.
- ragSourcesUsed: (array of strings) Names of course materials you referenced in your evaluation.

ONLY output valid JSON. No markdown formatting blocks.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 3: Scaffolded Feedback Generation (Model 3 — Feedback Refinement)
// ─────────────────────────────────────────────────────────────────────────────

export function buildFeedbackRefinementPrompt(
  rawFeedback: string,
  linguisticProfile: LinguisticProfile,
  persona: PersonaConfig | null,
  maxPoints: number,
  suggestedGrade: number
): string {
  const scaffoldingStrategy = linguisticProfile.tone === 'confused'
    ? 'EXPLANATORY — Provide clear explanations and worked examples. Break down complex ideas step-by-step.'
    : linguisticProfile.tone === 'frustrated'
    ? 'ENCOURAGING — Lead with empathy. Highlight progress and effort before addressing issues. Use supportive language.'
    : linguisticProfile.reasoningDepth === 'surface'
    ? 'DEEPENING — Ask probing questions that push the student to think more critically. Use "What if..." and "How might..." prompts.'
    : linguisticProfile.tone === 'confident' && suggestedGrade > maxPoints * 0.85
    ? 'CHALLENGING — The student is strong. Push them further with extension questions and advanced connections.'
    : 'BALANCED — Provide a mix of praise, constructive criticism, and forward-looking guidance.';

  const socraticInstructions = persona?.socratic
    ? `\nSOCRATIC MODE IS ACTIVE: Instead of giving direct answers, phrase your feedback as guiding questions.
Example: Instead of "You should have used a HashMap", say "What data structure might give you O(1) lookup time here? Consider how that changes your approach."`
    : '';

  return `You are an expert educational feedback specialist. Transform raw AI grading feedback into pedagogically scaffolded, personalized feedback that helps students learn.

SCAFFOLDING STRATEGY: ${scaffoldingStrategy}
${socraticInstructions}

${buildPersonaBlock(persona)}

STUDENT PROFILE:
- Tone: ${linguisticProfile.tone}
- Clarity: ${linguisticProfile.clarity}
- Reasoning Depth: ${linguisticProfile.reasoningDepth}
- Engagement: ${linguisticProfile.engagementLevel}
- Grade: ${suggestedGrade}/${maxPoints}

RAW FEEDBACK TO TRANSFORM:
${rawFeedback}

CONCEPTS THE STUDENT MISSED: ${linguisticProfile.conceptsMissing.join(', ') || 'None'}

Generate scaffolded feedback as a strict JSON object with EXACTLY these keys:
- conceptualFeedback: (string) 2-3 sentences addressing understanding gaps. ${persona?.socratic ? 'Use guiding questions.' : 'Give clear explanations.'}
- technicalFeedback: (string) 2-3 sentences with specific, actionable improvement suggestions.
- encouragement: (string) 1-2 sentences of personalized motivation adapted to the student's emotional state.
- nextSteps: (array of strings) 2-3 concrete, actionable learning tasks the student should do next.
- socraticQuestions: (array of strings) 2-3 thought-provoking questions that guide the student toward deeper understanding. ${!persona?.socratic ? 'Still provide these even if not in Socratic mode — they are optional bonus content.' : ''}
- scaffoldingLevel: (string) One of: "high_support", "moderate_support", "low_support", "challenge". Describes the level of scaffolding applied.

ONLY output valid JSON. No markdown.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 4: Reflection Critique (Self-RAG Evaluation)
// ─────────────────────────────────────────────────────────────────────────────

export function buildReflectionCritiquePrompt(
  draftGradingJson: string,
  submission: string,
  rubricText: string,
  maxPoints: number
): string {
  return `You are a strict QA Reviewer for an AI Grading System. Your job is to review a draft grade and feedback generated by another AI against the original student submission and rubric.

STUDENT SUBMISSION:
${submission}

RUBRIC / INSTRUCTIONS:
${rubricText || 'Standard grading standards apply.'}

DRAFT GRADING (JSON):
${draftGradingJson}

EVALUATION CRITERIA:
1. Faithfulness: Is the feedback entirely backed by the student submission and rubric? (No hallucinations).
2. Rubric Alignment: Did the draft grade apply the rubric fairly and correctly calculate the points out of ${maxPoints}?
3. Tone: Is the feedback professional and educational?

Return a strict JSON object with EXACTLY these keys:
- passed: (boolean) true if the draft grading is excellent and requires no changes. false if it has hallucinations, unfair grading, or missed rubric items.
- critique: (string) A brief explanation of why it passed or failed.
- revisedGrading: (object or null) If passed is false, provide a fully corrected version of the draft grading JSON here (must include suggestedGrade, strengths, improvements, deductionRationale, feedback, personalizedNote, tags, conceptualGaps, ragSourcesUsed). If passed is true, this should be null.

ONLY output valid JSON. No markdown.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 5: Human-Style Evaluator (Intrinsic Quality & Integrity)
// ─────────────────────────────────────────────────────────────────────────────

export function buildHumanEvaluatorPrompt(
  submission: string,
  assignmentInstructions: string
): string {
  return `You are an expert human academic evaluator. Analyze the student submission beyond just the basic rubric. Focus on intrinsic quality, critical thinking, and academic integrity.

ASSIGNMENT CONTEXT:
${assignmentInstructions || 'No specific context.'}

STUDENT SUBMISSION:
${submission}

Analyze the text and return a strict JSON object with EXACTLY these keys:
- intrinsicQualityScore: (number) A score from 0 to 100 representing the depth of critical thinking, originality, and argument construction (ignoring basic formatting).
- qualityFeedback: (string) A 2-sentence summary of the submission's true academic depth.
- aiProbability: (number) Estimated probability (0-100) that this text was generated by an LLM (look for typical AI syntactic patterns, lack of burstiness/perplexity).
- plagiarismRisk: (string) One of "LOW", "MEDIUM", "HIGH". Estimate the risk based on generic phrasings or lack of citations where needed.
- integrityFlags: (array of strings) Explain any red flags for AI or plagiarism. Empty array if none.

ONLY output valid JSON. No markdown.`;
}



