# Prepare Forge's required gate

[FOR-39](https://linear.app/outfitter/issue/FOR-39) owns activation of a required gate on `outfitter-dev/forge`. The [definition](../examples/github/forge-main-ruleset.json) is disabled and has an empty status selection until the live trial establishes the approved producer and context. The preparation command below refuses missing or invalid producer inputs and emits a disabled payload for review.

The definition requires a PR and resolved review threads, uses zero native approval-count requirements, and has no bypass actors or merge queue. Forge evaluates independent review itself. The allowed squash and rebase methods match the repository settings read on November 24, 2026. `strict_required_status_checks_policy` is false because Forge binds its decision to the independently admitted head and base; a changed base requires a fresh gate evaluation. Before activation, the informational FOR-38 trial must show that a changed base invalidates the old decision and produces a fresh evaluation of the admitted head/base pair. After activation, repeat that case to verify GitHub enforces the refreshed result.

On November 24, repository rulesets and effective rules for `main` were empty, and the legacy branch-protection endpoint returned 404. Existing Actions `check` and CodeQL jobs continue to run. Matt must decide whether either becomes an additional required check. If the activation-time readback finds existing requirements, preserve them in the reviewed payload and verify their current producer IDs. An old empty inventory cannot authorize removing a newer rule.

## Prepare the reviewed payload

First complete [FOR-38](https://linear.app/outfitter/issue/FOR-38)'s real PR trial. Record its source revision, head/base, gate verdict, Buildkite job, status context and producing App identity. Read the actual GitHub App integration ID; a bot account ID, an installation ID or the pilot's producer ID cannot substitute for the Forge trial's producer. The proposed `forge/gate` context still needs approval.

From a verified Forge checkout, set both values from that record and render the disabled payload. The command performs no network request.

```sh
(
set -eu
: "${FORGE_GATE_CONTEXT:?Set the approved status context}"
: "${FORGE_GATE_INTEGRATION_ID:?Set the verified GitHub App integration ID}"
payload="$(mktemp "${TMPDIR:-/tmp}/forge-main-ruleset.XXXXXX")"
trap 'rm -f "$payload"' 0
trap 'exit 1' HUP INT TERM
jq --arg context "$FORGE_GATE_CONTEXT" \
  --argjson integration_id "$FORGE_GATE_INTEGRATION_ID" '
  if ($context | test("\\A[!-~](?:[ -~]*[!-~])?\\z")) and
     ($integration_id | type == "number" and . > 0 and . <= 9007199254740991 and floor == .)
  then .rules[1].parameters.required_status_checks =
    [{context: $context, integration_id: $integration_id}]
  else error("Expected an approved context and a positive integer integration ID")
  end
' examples/github/forge-main-ruleset.json > "$payload"
trap - 0
printf '%s\n' "$payload"
)
```

Review the rendered payload and the exact diff from the latest effective rules before sending it to Matt for activation approval. Include any additional required checks explicitly, each with its observed integration ID. Record the approved payload digest and repository identity. `FORGE_GATE_INTEGRATION_ID` is a public identifier, not a token.

## Activate and qualify

Matt approves activation after correct live statuses exist. The accountable operator then creates or updates the uniquely identified ruleset with that reviewed payload and `enforcement` set to `active`, preserving any existing approved requirements. Treat an uncertain write as unknown and read back before retrying. Match an existing ruleset by recorded numeric ID and repository; duplicate names cannot identify a safe update target.

Read both the stored definition and all active rules applying to `main` through GitHub's [rules API](https://docs.github.com/en/rest/repos/rules). Save the ruleset ID, approved source revision, effective producer IDs, context, branch condition, bypass actors and merge-method settings. Check inherited organization rules as well. An accepted API response alone does not establish effective enforcement.

```sh
gh api repos/outfitter-dev/forge/rulesets --paginate
gh api repos/outfitter-dev/forge/rulesets/APPROVED_RULESET_ID
gh api repos/outfitter-dev/forge/rules/branches/main --paginate
```

On controlled Forge PRs, demonstrate that the wrong App posting the same context cannot satisfy the rule, a failed gate blocks landing, and a qualified gate allows landing. Repeat the already qualified base-change case after a pass, then record that GitHub blocks landing until the fresh head/base verdict qualifies. [FOR-40](https://linear.app/outfitter/issue/FOR-40) retains the live two-layer stack and Climb acceptance cases. Report any unobserved scenario as pending.

## Roll back

Before activation, name the operator with repository administration access, confirm that operator can disable this specific ruleset, and save the previous definition and effective rules. With no bypass actors, a broken required status can block every normal landing path.

If qualification fails, the accountable operator disables the recorded Forge ruleset by setting its `enforcement` to `disabled` through the update endpoint, then reads its definition and effective `main` rules again. Preserve its ID and definition for diagnosis. If activation modified a pre-existing rule, restore its captured previous definition instead. Other inherited rules can continue to enforce requirements, so record what still applies. Re-enable only after the failure is repaired, fresh trial evidence exists and Matt approves activation again.

The preparation remains usable while activation is pending. Deployment, repository settings and live status publication require their own authority under [standing delivery policy](../AGENTS.md#standing-delivery-authority).
