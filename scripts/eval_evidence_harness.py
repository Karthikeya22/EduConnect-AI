#!/usr/bin/env python
"""Evaluation harness scaffolding for evidence-protocol ablations.

Configs (evidence access must be reported explicitly per config):
  - A / stabilized_pipeline (baseline)
  - B / verification_only
  - C / coverage_recovery
  - D / obligation_recovery
  - direct_model_baseline, full_context_baseline (legacy aliases)

Does NOT invent benchmark results or human labels. Emits machine-readable
per-criterion records for fixtures supplied on stdin or --fixture path.
Compare strategies at equal budget ceilings; report actual resource counters.

Run:
  set PYTHONPATH=.
  py scripts/eval_evidence_harness.py --config coverage_recovery --fixture grading_server/tests/fixtures/evidence/sample_case.json
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.evidence.adapters import EvidenceAdapters
from grading_server.evidence.node import run_evidence_pipeline

CONFIGS = {
    "A": {
        "experiment_mode": "baseline",
        "evidence_access": "stabilized_ordinary_grading",
        "notes": "Experiment A — stabilized ordinary grading; no controller calls.",
        "budget_ceiling": "recovery_budget_v1",
    },
    "B": {
        "experiment_mode": "verification_only",
        "evidence_access": "ledger_plus_verify_no_recovery",
        "notes": "Experiment B — verification only; no recovery controller.",
        "budget_ceiling": "recovery_budget_v1",
    },
    "C": {
        "experiment_mode": "coverage_recovery",
        "evidence_access": "ledger_verify_bounded_recovery",
        "notes": "Experiment C — existing coverage recovery.",
        "budget_ceiling": "recovery_budget_v1",
    },
    "D": {
        "experiment_mode": "obligation_recovery",
        "evidence_access": "obligation_gate_plus_controller",
        "notes": "Experiment D — obligation-driven recovery (opt-in research).",
        "budget_ceiling": "recovery_budget_v1",
        "obligation_controller_version": "obligation-ctrl-v1",
    },
    "direct_model_baseline": {
        "experiment_mode": "baseline",
        "evidence_access": "full_submission_text_to_model_only",
        "notes": "No evidence protocol recovery; compare as direct grading baseline when wired.",
    },
    "full_context_baseline": {
        "experiment_mode": "baseline",
        "evidence_access": "full_context_when_fits",
        "notes": "Same references as other configs when isolating pipeline effects.",
    },
    "stabilized_pipeline": {
        "experiment_mode": "baseline",
        "evidence_access": "rag_top_k_plus_guards",
        "notes": "Alias of A — stabilized ordinary grading (mode baseline).",
    },
    "verification_only": {
        "experiment_mode": "verification_only",
        "evidence_access": "ledger_plus_verify_no_recovery",
        "notes": "Alias of B — validate evidence; no targeted recovery.",
    },
    "coverage_recovery": {
        "experiment_mode": "coverage_recovery",
        "evidence_access": "ledger_verify_bounded_recovery",
        "notes": "Alias of C — coverage-aware recovery extension.",
    },
    "obligation_recovery": {
        "experiment_mode": "obligation_recovery",
        "evidence_access": "obligation_gate_plus_controller",
        "notes": "Alias of D — obligation-driven recovery.",
        "obligation_controller_version": "obligation-ctrl-v1",
    },
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--config", choices=sorted(CONFIGS), required=True)
    p.add_argument("--fixture", type=Path, help="JSON fixture with submission_text + verdicts")
    p.add_argument("--repeat", type=int, default=1)
    args = p.parse_args()
    meta = CONFIGS[args.config]
    print(json.dumps({"harness": "eval_evidence_harness", "config": args.config, **meta}, indent=2))

    if not args.fixture:
        print(json.dumps({"status": "ready", "message": "No fixture; no scores invented."}))
        return 0

    data = json.loads(args.fixture.read_text(encoding="utf-8"))
    records = []
    for i in range(args.repeat):
        adapters = EvidenceAdapters(
            assess_evidence=lambda **kw: {
                "label": "insufficient",
                "justification": "harness default mock",
                "evidence_ids": kw.get("evidence_ids") or [],
            }
        )
        verts, block, flag = run_evidence_pipeline(
            experiment_mode=meta["experiment_mode"],
            verdicts=list(data.get("verdicts") or []),
            submission_text=str(data.get("submission_text") or ""),
            rubric_criteria=list(data.get("rubric_criteria") or []),
            presented_chunk_texts=list(data.get("presented_chunk_texts") or []),
            adapters=adapters,
            extraction_failed=bool(data.get("extraction_failed")),
            extraction_limitations=list(data.get("extraction_limitations") or []),
        )
        for v in verts:
            records.append(
                {
                    "repeat": i,
                    "criterion_id": v.get("criterion_id"),
                    "score": v.get("score"),
                    "max_score": v.get("max_score"),
                    "status": v.get("status"),
                    "claim": v.get("criterion_claim"),
                    "flag_for_human": flag,
                    "experiment_mode": block.experiment_mode,
                    "evidence_access": meta["evidence_access"],
                }
            )
    print(json.dumps({"records": records, "n": len(records)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
