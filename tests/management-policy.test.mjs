import test from "node:test"
import assert from "node:assert/strict"
import { validateManagementPolicy, resolveRuleQuantity, ruleSemanticKey } from "../src/engine/ManagementPolicy.mts"
import { policyBook } from "./fixtures/management.mjs"
test("distinct authored styles retain quantity bases and wording without installing defaults", () => {
  for (const style of ["partial", "whole"]) {
    const book = policyBook(style)
    const checked = validateManagementPolicy(book.interpretation.management, book.interpretation, book.markdown)
    assert.equal(checked.monitorable, true)
    assert.deepEqual(checked.issues, [])
    assert.equal(resolveRuleQuantity(checked.policy.rules[0].action.quantity, 10, 10), style === "partial" ? 5 : 10)
    assert.equal(checked.policy.levels.length, 0)
    assert.equal(ruleSemanticKey({ ...checked.policy.rules[0], id: "renamed" }, book.interpretation), ruleSemanticKey(checked.policy.rules[0], book.interpretation))
  }
})
test("ambiguous quantities, undefined levels, cycles and mandatory unresolved clauses prevent activation", () => {
  const book = policyBook()
  const checked = value => validateManagementPolicy(value, book.interpretation, book.markdown)
  const input = () => structuredClone(book.interpretation.management)
  let policy = input(); policy.rules[0].action.quantity = { basis: "some" }; assert.throws(() => checked(policy), /ambiguous/)
  policy = input(); policy.rules[0].action.orderType = "stop"; policy.rules[0].action.stopLevel = "undefined"; assert.throws(() => checked(policy), /Undefined/)
  policy = input(); policy.rules[0].dependencies = [{ ruleId: "exit", state: "filled" }]; assert.throws(() => checked(policy), /Cyclic/)
  policy = input(); policy.rules[0].condition = { kind: "live-price", conditionId: "target" }; assert.match(checked(policy).issues[0], /unavailable/)
  book.interpretation.clauses[0].coverage = "unsupported"; book.interpretation.clauses[0].mandatory = true
  assert.equal(validateManagementPolicy({ ...input(), rules: [] }, book.interpretation, book.markdown).monitorable, false)
  assert.throws(() => resolveRuleQuantity({ basis: "initial", value: .5 }, 10, 3), /excessive/)
})
