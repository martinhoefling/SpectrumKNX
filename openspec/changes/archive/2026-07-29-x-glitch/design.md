## Context

See proposal.md - Why. The UI elements for closing the Visualization panel and clearing selected targets are already present in the codebase. This design outlines how to verify their presence and correctness.

## Goals / Non-Goals

**Goals:**
- Verify that the Visualization panel header contains an X button that triggers the `onClose` callback.
- Verify that the Targets sidebar header contains an X button that clears target selection (triggers `onTargetsChange([])`).

**Non-Goals:**
- Writing new UI components or changing existing behaviors, as they are already correctly implemented.

## Decisions

### 1. Verification and Specification Alignment
We will align the OpenSpec specifications with the existing codebase by documenting the current behaviors. No new code changes are needed because the UI buttons and actions are already present in `Visualizer.tsx` and `VisualizerSidebar.tsx`.
- **Rationale**: Re-implementing or changing the current working close/clear buttons is unnecessary and would risk breaking existing tests.
- **Alternatives considered**: Modifying the icon styles. This was rejected as the current styling matches the design guidelines.

## Risks / Trade-offs

None.
