## ADDED Requirements

### Requirement: Spike script validates three biometric properties
Before any implementation begins, a Python spike script SHALL validate that fine-tuned model outputs are usable as a biometric signal by testing three properties: stability, distinctness, and signal gap.

#### Scenario: Stability property confirmed
- **WHEN** the same fine-tuned model runs inference on the same challenge at temperature=0 across multiple runs
- **THEN** the output is identical across all runs (bit-for-bit reproducible)

#### Scenario: Distinctness property confirmed
- **WHEN** two models fine-tuned independently on the same genesis corpus subset (different random seeds) each produce outputs for the same 100 held-out challenges
- **THEN** mean Hamming similarity between the two models' outputs is ≤ 0.60

#### Scenario: Signal gap confirmed
- **WHEN** an authentic model is compared against its own stored outputs and a different model is compared against those same stored outputs
- **THEN** authentic similarity is ≥ 0.90 AND different-model similarity is ≤ 0.60, yielding a gap of ≥ 0.30

### Requirement: Spike result determines go/no-go
The spike SHALL produce a structured result file and a clear go/no-go decision that gates all subsequent implementation work.

#### Scenario: Go decision — gap sufficient
- **WHEN** the signal gap is ≥ 0.30
- **THEN** the spike result file records `decision: go`, mean similarity scores for all three comparisons, and the model/quantization configuration used

#### Scenario: No-go decision — gap insufficient
- **WHEN** the signal gap is < 0.20
- **THEN** the spike result file records `decision: no-go`, the observed scores, and the reason; no implementation work begins

#### Scenario: Inconclusive — gap in marginal range
- **WHEN** the signal gap is between 0.20 and 0.30
- **THEN** the spike result file records `decision: inconclusive` and the next candidate configuration to test (different model size, quantization, or output length)
