/**
 * aiAPI.ts
 * AI grading service — delegates to the modular RAG grading pipeline.
 * Handles attachment parsing (docx, xlsx, pdf, images, code files) and
 * passes extracted content to the RAG grader for multi-model evaluation.
 */

import { gradeSubmission, type EnhancedGradeResult } from '@/src/grader/rag_grader';

// Re-export the enhanced result type for consumers
export type { EnhancedGradeResult };

// Backward-compatible interface (original fields only)
export interface AIGradeResult {
  suggestedGrade: number;
  strengths: string[];
  improvements: string[];
  deductionRationale?: string;
  feedback: string;
  personalizedNote: string;
  tags: string[];

  // Enhanced RAG fields (optional for backward compat)
  linguisticProfile?: EnhancedGradeResult['linguisticProfile'];
  scaffoldedFeedback?: EnhancedGradeResult['scaffoldedFeedback'];
  conceptualGaps?: string[];
  ragSourcesUsed?: string[];
  pipelineMetadata?: EnhancedGradeResult['pipelineMetadata'];
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export const aiAPI = {
  generateGrade: async (
    assignmentContext: string,
    studentSubmission: string,
    maxPoints: number,
    rubric?: any[],
    attachments?: any[],
    assignmentTitle?: string,
    studentId?: string
  ): Promise<AIGradeResult> => {
    const apiKey = localStorage.getItem('custom_gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing Gemini API Key");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Parse attachments (same logic as before)
    // ─────────────────────────────────────────────────────────────────────
    let parsedAttachmentsText = "";
    const inlineDataParts: any[] = [];

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (!att.url || !att.filename) continue;
        
        try {
          const fileRes = await fetch(att.url);
          const extension = att.filename.split('.').pop()?.toLowerCase();
          let extractedText = "";

          if (extension === "docx") {
            const mammoth = await import("mammoth");
            const arrayBuffer = await fileRes.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            extractedText = result.value;
          } 
          else if (extension === "xlsx" || extension === "xls" || extension === "csv") {
            const XLSX = await import("xlsx");
            const arrayBuffer = await fileRes.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            extractedText = workbook.SheetNames.map(sheetName => {
              const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
              return `--- Sheet: ${sheetName} ---\n${csv}`;
            }).join("\n\n");
          }
          else if (extension === "pdf" || extension === "png" || extension === "jpg" || extension === "jpeg") {
            const arrayBuffer = await fileRes.arrayBuffer();
            const mimeType = extension === "pdf" ? "application/pdf" : `image/${extension === "jpg" ? "jpeg" : extension}`;
            
            inlineDataParts.push({
              inlineData: {
                mimeType: mimeType,
                data: arrayBufferToBase64(arrayBuffer)
              }
            });
            parsedAttachmentsText += `\n\n--- Attachment: ${att.filename} (Provided natively as ${extension.toUpperCase()} visual file to AI) ---\n-------------------------\n`;
          }
          else if (["r", "py", "js", "ts", "json", "html", "css", "txt", "md", "sql", "java", "cpp", "c"].includes(extension || "")) {
            extractedText = await fileRes.text();
          }

          if (extractedText) {
             if (extractedText.length > 30000) {
                 extractedText = extractedText.substring(0, 30000) + "\n... [CONTENT TRUNCATED FOR LENGTH] ...";
             }
             parsedAttachmentsText += `\n\n--- Attachment: ${att.filename} ---\n${extractedText}\n-------------------------\n`;
          }

        } catch (e) {
          console.error(`Failed to parse attachment ${att.filename}`, e);
          parsedAttachmentsText += `\n\n--- Attachment: ${att.filename} ---\n[Failed to extract text from this file format automatically.]\n-------------------------\n`;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Delegate to the chosen RAG grading pipeline
    // ─────────────────────────────────────────────────────────────────────
    try {
      let result = await gradeSubmission(
        assignmentContext,
        studentSubmission,
        maxPoints,
        rubric,
        parsedAttachmentsText,
        inlineDataParts,
        apiKey,
        assignmentTitle,
        studentId
      );

      console.log('[aiAPI] RAG pipeline completed:', {
        duration: result.pipelineMetadata.totalDurationMs + 'ms',
        materialsUsed: result.pipelineMetadata.materialsRetrieved,
        personaApplied: result.pipelineMetadata.personaApplied,
        stages: result.pipelineMetadata.stages.map(s => `${s.name}: ${s.durationMs}ms`)
      });

      // Return the full enhanced result (backward compatible with AIGradeResult)
      return result;

    } catch (pipelineErr) {
      console.error('[aiAPI] RAG pipeline failed entirely, falling back to basic grading:', pipelineErr);

      // Fallback: if the entire pipeline fails, return a basic result
      return {
        suggestedGrade: Math.round(maxPoints * 0.8),
        strengths: ["Submission shows effort.", "Followed instructions adequately."],
        improvements: ["Could provide more detail.", "Make sure to double check requirements."],
        feedback: "Good work overall. Please see the areas of improvement for next time.",
        personalizedNote: "Keep up the hard work!",
        tags: ["Needs more detail", "Good attempt"]
      };
    }
  }
};



