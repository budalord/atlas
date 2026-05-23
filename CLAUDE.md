# Working Rules

These rules favor precision over speed. For trivial one-off tasks, use judgment.

## Rule 1: Surgical Changes Only

- Only modify code directly required by the request.
- Do NOT "improve" adjacent code, reformat, or refactor things that work.
- Preserve existing style even if you'd write it differently.
- Only clean up dead code/imports YOU introduced — never pre-existing ones.
- Every line changed must trace back to an explicit requirement.

## Rule 2: Goal-Driven Execution

- Before coding, convert vague requests into verifiable success criteria.
  - "add validation" → "write tests for invalid inputs, then make them pass"
  - "fix the bug" → "reproduce the bug as a failing test, then make it pass"
- For multi-step tasks, write a brief plan + how each step will be verified.
- Iterate until verification actually passes — not "should pass" or "looks right".
- If you can't verify, say so explicitly instead of declaring done.
