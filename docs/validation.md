# Validate the instruction package

The delivered artifact is Markdown guidance. No application build, test framework or
hosted CI is assumed. Record the revision and checks actually performed; this checklist
does not establish a pass by its existence. Behavioral walkthroughs are not downstream
runtime tests or proof of universal agent compliance.

## Structural and content checks

- Each skill directory contains a SKILL.md with valid frontmatter, a matching lowercase
  hyphenated name and a nonempty, narrowly scoped description. Use an available format
  validator; report a fallback structural check accurately if a full parser is unavailable.
- Resolve every local Markdown link, including anchors. Required skills/resources exist;
  no removed helper, unavailable execution framework or host-specific tool is required.
- Inspect the full portable package for fenced or indented code, command recipes and
  implementation examples, including inline examples. Metadata is permitted. Instructions
  may identify actual target-project checks without prescribing a stack or sample code.
- Search for copied project identities, personal paths, fixed branch/forge assumptions,
  architecture prescriptions, obsolete resources and contradictory authority rules.
- Check adoption instructions, skill inventory, changed-file scope and diff whitespace.
  Existing configuration and user edits must survive adoption and experiments.

## Decision scenarios

For substantial workflow changes, give an independent reader the relevant guidance
and the requests below without these expected results. Inspect concrete proposed
actions and artifacts. Compare an unchanged baseline with the revision when available;
record disagreements and recheck after corrections. Direct walkthroughs can suffice
for narrow edits. Evaluations remain isolated and perform no external writes.

| Request and conditions | Expected observable decision |
| --- | --- |
| Correct an approved document in a project with no build, tracker or forge. | Make the bounded correction; validate prose/links without inventing commands or infrastructure. |
| Plan a change to a library using its own language and public API; native execution is already authorized. | Preserve its architecture, interfaces and execution method; no missing framework or repeated approval gate. |
| Verify an external API while updating documentation. | Consult primary evidence within authorized access; distinguish researched facts from tested behavior. |
| Inspect one GitHub PR's CI. | Inspect that PR and relevant checks only; no stale closures, unsolicited comments or recurring monitoring. |
| Diagnose a website failure that depends on local state while another person's edits are present. | Isolate the reproduction, preserve working files and verify affected behavior before broader confirmation. |
| Adopt guidance in an existing project with different instructions, branches and license. | Verify identity/source/destination; reconcile rather than overwrite; preserve license and stop before unrequested implementation. |
| Change a CLI's installed behavior. | Test the actual installed/built entry path and default wiring when available; report missing environments explicitly. |
| Prepare a release whose candidate advances or whose issue has no acceptance evidence. | Refresh scope/checks; withhold unsupported completion/closure; preserve publication authority and published identities. |

Also distinguish three verification states: a required check that passed, a required
check unavailable or failing, and a check that does not apply. No build is normal for
prose; missing required CI is not green CI. Reuse evidence only while its relevant
inputs and environment are unchanged.
