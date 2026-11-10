# Teardown accounting (2026-11-10) — the claim an empty orphan list was making

**The problem.** `deleteInstance` swept for survivors *after* `projectDelete`. Once the project is unreadable,
"everything was removed" and "nothing can be seen" produce the same answer: the first tenant-shaped run
reported `orphans: []` while the provisioned database appeared in **neither** list. A clean array was being
read as a full accounting, and it was not one.

**The fix is a snapshot and three states.** Everything that existed is recorded before anything is removed,
then each item is classified:

| State | Meaning |
| --- | --- |
| `removed` | the provider deleted it individually and that call succeeded |
| `releasedWithProject` | it existed, was not individually deleted, and is now unreachable — which on Railway includes every bucket, since **there is no bucket delete mutation at all**, and any service whose individual delete was refused before the project went |
| `orphans` | it existed and is **still reachable** after `projectDelete` — the only case that deserves the word |

A refusal is still recorded in `failures` with its reason, so #80's guarantee ("a real refusal never
disappears") survives unchanged. Only the label moved, which is the distinction between renaming a thing and
relaxing a check.

**Live verification:**

```
 12s applied verified=true services=[["api","live"]] notes=[]
 16s removed : ["service:production/api","project:platfolio-account-check"]
 16s released: ["bucket:50741c40-1fca-4df5-95d2-761c9eda46ce"]
 16s orphans : []  failures: []
 16s unreadable after delete, as expected
```

**Two findings from building the tests, both of the same familiar family:**

1. **The double was more forgiving than the API.** `project.buckets`, `project.services`, `project.volumes`
   and `project.environments` all answered for a project that had been deleted, so the provider classified a
   bucket as an orphan and my test "failed" while the code was right. The mock now refuses reads on a deleted
   project — the same correction pattern as `serviceInstanceUpdate` returning `true` while doing nothing.
2. **The mock rebuilds its options from a whitelist**, so a new flag (`keepProjectAfterDelete`) was silently
   dropped and the orphan branch stayed untested. That is the exact bug that once made
   `templateNeverReveals` vacuous, now documented at the constructor so the third occurrence is less likely.

**One imprecision left on purpose:** released buckets are named by Railway's bucket id rather than the plan
name, because `project.buckets` returns ids. Making it readable needs a name lookup; the current record is
accurate but noisier than it should be.

Deploys consumed by the verification: one (plus its delete).
