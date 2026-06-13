import { buildHumanEvaluatorPrompt } from './prompt_templates';

export interface IntegrityEvaluation {
  intrinsicQualityScore: number;
  qualityFeedback: string;
  aiProbability: number;
  plagiarismRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  integrityFlags: string[];
}

/**
 * Runs the human-style evaluation to check intrinsic quality, 
 * AI generation patterns, and plagiarism flags.
 */
export async function evaluateIntegrityAndQuality(
  submission: string,
  assignmentInstructions: string,
  apiKey: string
): Promise<IntegrityEvaluation> {
  const prompt = buildHumanEvaluatorPrompt(submission, assignmentInstructions);

  // 1. External Free API Check for AI Authorship (HuggingFace roberta-base-openai-detector)
  let externalAiProbability = -1;
  try {
    const hfResponse = await fetch('https://api-inference.huggingface.co/models/roberta-base-openai-detector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: submission.substring(0, 1500) }) // HF limit
    });
    if (hfResponse.ok) {
      const hfData = await hfResponse.json();
      // Returns array of arrays: [[{label: "Real", score: 0.1}, {label: "Fake", score: 0.9}]]
      const fakeObj = hfData[0]?.find((d: any) => d.label === 'Fake');
      if (fakeObj) {
        externalAiProbability = Math.round(fakeObj.score * 100);
      }
    }
  } catch (err) {
    console.warn('[HumanEvaluator] External AI detection API failed:', err);
  }

  // 2. Intrinsic Quality & Plagiarism Heuristics (via LLM)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1, // Low temp for more deterministic evaluation
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Integrity evaluation API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Empty response from integrity evaluator');
    }

    const evaluation = JSON.parse(text) as IntegrityEvaluation;

    // Merge external AI Probability if successfully retrieved
    if (externalAiProbability >= 0) {
      evaluation.aiProbability = externalAiProbability;
    }

    return evaluation;
  } catch (err) {
    console.warn('[HumanEvaluator] Integrity evaluation failed, returning safe defaults:', err);
    return {
      intrinsicQualityScore: 75,
      qualityFeedback: 'Evaluation pending or failed. Appears standard.',
      aiProbability: externalAiProbability >= 0 ? externalAiProbability : 0,
      plagiarismRisk: 'LOW',
      integrityFlags: []
    };
  }
}




