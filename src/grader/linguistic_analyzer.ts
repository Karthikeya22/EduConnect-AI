/**
 * linguistic_analyzer.ts
 * Model 1 — Classification: Analyzes a student's submission for linguistic
 * features including tone, clarity, reasoning depth, and emotional state.
 * This profile is used by downstream stages to personalize feedback.
 */

import { buildLinguisticAnalysisPrompt, type LinguisticProfile } from './prompt_templates';

// ─────────────────────────────────────────────────────────────────────────────
// Analyze a student submission's linguistic features
// ─────────────────────────────────────────────────────────────────────────────

export async function analyzeSubmission(
  submission: string,
  assignmentInstructions: string,
  attachmentSummary: string,
  apiKey: string
): Promise<LinguisticProfile> {
  const prompt = buildLinguisticAnalysisPrompt(
    submission,
    assignmentInstructions,
    attachmentSummary
  );

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,  // Low temp for consistent classification
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Linguistic analysis API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Empty response from linguistic analysis');
    }

    const parsed = JSON.parse(text);

    // Validate and normalize the response
    return {
      tone: validateEnum(parsed.tone, ['confident', 'confused', 'frustrated', 'neutral', 'uncertain'], 'neutral'),
      clarity: validateEnum(parsed.clarity, ['clear', 'partially_clear', 'unclear'], 'partially_clear'),
      reasoningDepth: validateEnum(parsed.reasoningDepth, ['surface', 'moderate', 'deep'], 'moderate'),
      engagementLevel: validateEnum(parsed.engagementLevel, ['high', 'medium', 'low'], 'medium'),
      conceptsCovered: Array.isArray(parsed.conceptsCovered) ? parsed.conceptsCovered : [],
      conceptsMissing: Array.isArray(parsed.conceptsMissing) ? parsed.conceptsMissing : [],
      emotionalIndicators: Array.isArray(parsed.emotionalIndicators) ? parsed.emotionalIndicators : []
    };

  } catch (err) {
    console.error('[LinguisticAnalyzer] Analysis failed, using fallback profile:', err);

    // Return a neutral fallback profile
    return getDefaultProfile(submission);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateEnum<T extends string>(value: any, allowed: T[], fallback: T): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
}

/**
 * Heuristic-based fallback profile when the AI analysis fails.
 * Uses simple text analysis to make reasonable guesses.
 */
function getDefaultProfile(submission: string): LinguisticProfile {
  const lower = submission.toLowerCase();
  const wordCount = submission.split(/\s+/).length;

  // Simple heuristic tone detection
  let tone: LinguisticProfile['tone'] = 'neutral';
  if (lower.includes('i don\'t understand') || lower.includes('confused') || lower.includes('not sure')) {
    tone = 'confused';
  } else if (lower.includes('frustrat') || lower.includes('i can\'t') || lower.includes('impossible')) {
    tone = 'frustrated';
  } else if (lower.includes('i believe') || lower.includes('clearly') || lower.includes('therefore')) {
    tone = 'confident';
  }

  // Engagement heuristic based on length
  const engagementLevel: LinguisticProfile['engagementLevel'] =
    wordCount > 300 ? 'high' : wordCount > 100 ? 'medium' : 'low';

  // Reasoning depth heuristic
  const reasoningDepth: LinguisticProfile['reasoningDepth'] =
    (lower.includes('because') || lower.includes('therefore') || lower.includes('however'))
      ? 'moderate' : 'surface';

  return {
    tone,
    clarity: 'partially_clear',
    reasoningDepth,
    engagementLevel,
    conceptsCovered: [],
    conceptsMissing: [],
    emotionalIndicators: []
  };
}



