export type RetrievalStatus = "ok" | "no_useful_matches" | "no_corpus" | "infrastructure_error";

export type ExperimentMode =
  | "baseline"
  | "verification_only"
  | "coverage_recovery"
  | "obligation_recovery";

export type ObligationState =
  | "supported"
  | "contradicted"
  | "inspected_not_demonstrated"
  | "unresolved";

export interface EvidenceObligation {
  criterion_id: string;
  requirement_ids?: string[];
  requirement_text?: string;
  submission_evidence_needed?: boolean;
  reference_evidence_needed?: boolean;
  available_supporting_ids?: string[];
  available_contradictory_ids?: string[];
  extraction_limitations?: string[];
  inspection_limitations?: string[];
  ambiguity_notes?: string[];
  state?: ObligationState;
}

/** Must match grading_server/evidence/offsets.py — Unicode code points, not UTF-16. */
export const OFFSET_ENCODING = "unicode_codepoint" as const;

export type ClaimType =
  | "demonstrated"
  | "partially_demonstrated"
  | "contradicted"
  | "assessed_not_demonstrated"
  | "unresolved";

export interface SourceLocation {
  offset_encoding: typeof OFFSET_ENCODING | string;
  start_offset?: number | null;
  end_offset?: number | null;
  page?: number | null;
  block_id?: string | null;
  bbox?: number[] | null;
  original_document_location?: "available" | "unavailable";
}

export interface SourceUnit {
  source_unit_id: string;
  artifact_id: string;
  submission_version: string;
  extraction_version: string;
  content_hash: string;
  source_location: SourceLocation;
  text: string;
  extraction_status: "ok" | "failed" | "partial" | "unavailable";
  extraction_limitations?: string[];
  presentation?: string;
}

export interface CoverageSummary {
  artifact_extent: "known" | "unknown";
  known_unit_count: number;
  presented_unit_count: number;
  extraction_failed_count: number;
  not_processed_count: number;
  omitted_budget_count: number;
  denominator_note?: string;
}

export interface CriterionClaim {
  criterion_id: string;
  requirement_id?: string | null;
  claim_type: ClaimType;
  judgment?: string;
  submission_evidence_ids?: string[];
  reference_evidence_ids?: string[];
  evidence_check_status?: string;
  processing_limitations?: string[];
  recovery_attempts?: Array<{
    round?: number;
    status?: string;
    action?: string;
    reason?: string;
    judgment_changed?: boolean;
    stop_reason?: string | null;
    obligation_state_before?: string | null;
    obligation_state_after?: string | null;
    inspected_unit_ids?: string[];
    recovered_evidence_ids?: string[];
    [key: string]: unknown;
  }>;
  review_reasons?: string[];
  semantic_label?: string | null;
  semantic_justification?: string | null;
  original_score?: number | null;
  revised_score?: number | null;
  change_reason?: string | null;
  obligation?: EvidenceObligation | null;
  obligation_state?: ObligationState | null;
  gate_decision?: string | null;
}

export interface EvidenceBlock {
  evidence_protocol_version?: number;
  experiment_mode?: ExperimentMode;
  recovery_budget_version?: string;
  obligation_controller_version?: string | null;
  source_units?: SourceUnit[];
  coverage?: CoverageSummary;
  claims?: CriterionClaim[];
  obligations?: EvidenceObligation[];
  labels?: string[];
}

export interface CriterionVerdict {
  criterion_name: string;
  /** null = not assessed (processing failure); 0 = genuinely assessed zero. */
  score: number | null;
  max_score: number;
  status: "full" | "partial" | "missing" | "not_assessable";
  failure_kind?: "processing_failed" | "reference_unavailable" | null;
  retrieval_status?: RetrievalStatus | null;
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
  criterion_claim?: CriterionClaim | null;
  submission_evidence_ids?: string[];
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
  /** Absent on results written before versioning: treat as legacy/unverified. */
  result_schema_version?: number;
  assignment_id?: string;
  student_id?: string;
  /** Absent on results cached before this field existed; treat as complete only if total is a number. */
  assessment_status?: "complete" | "partial" | "processing_failed";
  /** null unless every required criterion was assessed. */
  content_score: number | null;
  structure_score: number | null;
  total: number | null;
  content_max?: number;
  structure_max?: number;
  total_max?: number;
  /** Assessed criteria only; never rescaled to total_max. */
  partial_subtotal?: { earned: number; assessed_max: number; failed_criteria: string[] } | null;
  retrieval_status?: RetrievalStatus;
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
  experiment_mode?: ExperimentMode;
  evidence_protocol_version?: number | null;
  evidence?: EvidenceBlock | null;
  extracted_submission_text?: string;
  /** Assessment policy metadata — separate from assessment_status. */
  policy_id?: string | null;
  policy_version?: number | null;
  policy_content_hash?: string | null;
  policy_origin?: "instructor" | "inferred" | "approved_template" | "formative" | string | null;
  policy_lifecycle?: "draft" | "frozen_provisional" | "approved" | "superseded" | string | null;
  policy_provisional?: boolean;
  policy_formative_only?: boolean;
  policy_label?: string | null;
  assessment_policy?: AssessmentPolicy | null;
  policy_lookup_status?: string | null;
  rubric_missing?: boolean;
}

export type PolicyOrigin = "instructor" | "inferred" | "approved_template" | "formative";
export type PolicyLifecycle = "draft" | "frozen_provisional" | "approved" | "superseded";

export interface PolicySourceExcerpt {
  requirement_id: string;
  excerpt: string;
  location?: string | null;
  source_document_version?: string | null;
  content_hash?: string | null;
}

export interface PolicyCriterion {
  criterion_id: string;
  title: string;
  description: string;
  source_requirement_ids?: string[];
  source_excerpts?: PolicySourceExcerpt[];
  provenance: "explicit_requirement" | "inferred_interpretation" | "template_assumption" | string;
  max_points: number;
  weight: number;
  performance_descriptors?: Array<{ level: string; description: string; min_ratio: number }>;
  evidence_policy?: "submission_sufficient" | "requires_reference" | string;
  disclosed_assumptions?: string[];
  dimension?: "content" | "structure";
}

export interface AssessmentPolicy {
  policy_id: string;
  version: number;
  content_hash: string;
  course_id: string;
  assignment_id: string;
  origin: PolicyOrigin | string;
  lifecycle: PolicyLifecycle | string;
  assignment_context_hash: string;
  assignment_context_version?: string;
  source_document_versions?: string[];
  criteria: PolicyCriterion[];
  maximum_score?: number | null;
  weighting_mode?: string;
  weighting_assumptions?: string[];
  formative_only?: boolean;
  diagnostic?: string | null;
  disclosed_assumptions?: string[];
  created_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
}
