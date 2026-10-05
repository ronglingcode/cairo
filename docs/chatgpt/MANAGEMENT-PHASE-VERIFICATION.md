# Management implementation checks

## T22

Added a bounded internal management representation with clause-linked conditions,
exit/protection actions, explicit quantity basis/rounding, fixed-at-attachment
levels, optional allocations, once/rearm semantics and actual-fill dependencies.
Unknown shapes, ambiguous quantities, undefined levels, duplicate actions and
dependency cycles are rejected. Unsupported mandatory clauses block monitoring;
independent unavailable-source rules retain explicit coverage issues. No trader
policy defaults or generated code are installed.

Typecheck and five targeted checks passed: two distinct authored styles, exact
wording, stable action identity across rule renames, invalid/ambiguous inputs,
unavailable current sources and existing artifact persistence compatibility.
