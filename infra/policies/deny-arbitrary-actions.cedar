// Default-deny fallback: an action the Gateway routes through policy but that
// isn't explicitly permitted elsewhere is denied rather than silently
// allowed. Cedar's own evaluation is implicit-deny already; this statement
// exists to make that behavior visible in the policy source and to produce
// an explicit DENY audit record (prompt.md #45) instead of an ambiguous one.

forbid(
  principal,
  action == Action::"execute_arbitrary_request",
  resource
);
