export interface CriterionVerdict {
  criterion_name: string;
  score: number;
  max_score: number;
  status: "full" | "partial" | "missing";
  justification: string;
  evidence_anchor: string;
  missing_keywords: string[];
  dimension: "content" | "structure";
  supporting_materials: string[];
  covered_concepts?: string[];
  required_concepts?: string[];
  criterion_id?: string; // Keep for backward compatibility internally if needed
  ai_generated?: boolean;
  ungrounded_full?: boolean;
}

export interface LinguisticProfile {
  tone: string;
  clarity: string;
  reasoning_depth: string;
  engagement_level: string;
  conceptsCovered?: string[];
  conceptsMissing?: string[];
  emotionalIndicators?: string[];
}

export interface IntegrityEvaluation {
  ai_authorship_probability: number;
  plagiarism_risk: string;
  integrity_flags: string[];
}

export interface GradingOutput {
  assignment_id?: string;
  student_id?: string;
  content_score: number;
  structure_score: number;
  total: number;
  content_max?: number;
  structure_max?: number;
  total_max?: number;
  overall_confidence: number;
  flag_for_human: boolean;
  misconception_hint: string;
  rag_coverage_level: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  strong_match_count: number;
  referenced_materials: string[];
  criteria_verdicts: CriterionVerdict[];
  integrityEvaluation?: IntegrityEvaluation;
  linguisticProfile?: LinguisticProfile;
  topic_mastery_radar?: Record<string, number>;
  confidence?: number;
  _pipeline_duration_seconds?: number;
  missing_concepts_summary?: string[];
}
