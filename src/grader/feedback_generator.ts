/**
 * feedback_generator.ts
 * Model 3 — Evaluation: Generates pedagogically scaffolded feedback.
 * Takes raw grading results + linguistic profile and produces personalized,
 * context-aware educational feedback with scaffolding strategies.
 */

import { buildFeedbackRefinementPrompt, type LinguisticProfile, type PersonaConfig } from './prompt_templates';

export interface ScaffoldedFeedback {
  conceptualFeedback: string;
  technicalFeedback: string;
  encouragement: string;
  nextSteps: string[];
  socraticQuestions: string[];
  scaffoldingLevel: 'high_support' | 'moderate_support' | 'low_support' | 'challenge';
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate scaffolded educational feedback
// ─────────────────────────────────────────────────────────────────────────────

export async function generateScaffoldedFeedback(
  rawFeedback: string,
  linguisticProfile: LinguisticProfile,
  persona: PersonaConfig | null,
  maxPoints: number,
  suggestedGrade: number,
  apiKey: string
): Promise<ScaffoldedFeedback> {
  const prompt = buildFeedbackRefinementPrompt(
    rawFeedback,
    linguisticProfile,
    persona,
    maxPoints,
    suggestedGrade
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
            temperature: 0.4,  // Moderate creativity for personalized feedback
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Feedback generation API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Empty response from feedback generator');
    }

    const parsed = JSON.parse(text);

    return {
      conceptualFeedback: parsed.conceptualFeedback || 'Review the assignment requirements and ensure all key concepts are addressed.',
      technicalFeedback: parsed.technicalFeedback || 'Focus on improving the technical depth and accuracy of your response.',
      encouragement: parsed.encouragement || 'Keep working hard — each assignment is a step forward in your learning journey.',
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : ['Review course materials for this topic.'],
      socraticQuestions: Array.isArray(parsed.socraticQuestions) ? parsed.socraticQuestions : [],
      scaffoldingLevel: validateScaffoldingLevel(parsed.scaffoldingLevel)
    };

  } catch (err) {
    console.error('[FeedbackGenerator] Scaffolded feedback generation failed, using fallback:', err);
    return getFallbackFeedback(linguisticProfile, suggestedGrade, maxPoints);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateScaffoldingLevel(value: any): ScaffoldedFeedback['scaffoldingLevel'] {
  const allowed = ['high_support', 'moderate_support', 'low_support', 'challenge'];
  if (typeof value === 'string' && allowed.includes(value)) {
    return value as ScaffoldedFeedback['scaffoldingLevel'];
  }
  return 'moderate_support';
}

/**
 * Generates fallback scaffolded feedback when the AI call fails.
 * Uses the linguistic profile to determine appropriate scaffolding.
 */
function getFallbackFeedback(
  profile: LinguisticProfile,
  grade: number,
  maxPoints: number
): ScaffoldedFeedback {
  const percentage = (grade / maxPoints) * 100;

  let scaffoldingLevel: ScaffoldedFeedback['scaffoldingLevel'] = 'moderate_support';
  let encouragement = 'Keep up the good work!';

  if (profile.tone === 'frustrated') {
    scaffoldingLevel = 'high_support';
    encouragement = 'Learning is a journey, and every attempt brings you closer to mastery. Don\'t give up — you\'re making progress.';
  } else if (profile.tone === 'confused') {
    scaffoldingLevel = 'high_support';
    encouragement = 'It\'s okay to find this challenging. Understanding comes with practice, and asking questions is a sign of growth.';
  } else if (percentage >= 85) {
    scaffoldingLevel = 'challenge';
    encouragement = 'Excellent work! You clearly have a strong grasp of the material. Consider exploring some advanced topics to push your understanding further.';
  } else if (percentage < 60) {
    scaffoldingLevel = 'high_support';
    encouragement = 'This is a learning opportunity. Focus on the core concepts and don\'t hesitate to reach out for help during office hours.';
  }

  const nextSteps: string[] = [];
  if (profile.conceptsMissing.length > 0) {
    nextSteps.push(`Review these concepts: ${profile.conceptsMissing.slice(0, 3).join(', ')}`);
  }
  nextSteps.push('Re-read the assignment instructions and compare with your submission');
  if (profile.reasoningDepth === 'surface') {
    nextSteps.push('Practice explaining your reasoning step-by-step in future submissions');
  }

  return {
    conceptualFeedback: profile.conceptsMissing.length > 0
      ? `Consider revisiting the following concepts that were not fully addressed: ${profile.conceptsMissing.join(', ')}.`
      : 'Your conceptual understanding appears solid. Continue building on this foundation.',
    technicalFeedback: profile.clarity === 'unclear'
      ? 'Focus on organizing your response more clearly. Use structured paragraphs, and make sure each point connects logically to the next.'
      : 'Your technical approach is reasonable. Look for opportunities to add more specific details and examples.',
    encouragement,
    nextSteps,
    socraticQuestions: [
      'What was the main goal of this assignment, and how does your submission address it?',
      'If you could revise one part of your submission, what would it be and why?'
    ],
    scaffoldingLevel
  };
}



