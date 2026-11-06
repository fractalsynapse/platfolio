---
name: writing-skills
description: Use when creating, revising or validating project-local agent skills and instruction resources.
---

# Maintain useful guidance

Follow the [project instructions](../../../AGENTS.md). A skill should improve a concrete
agent decision with little context overhead. Keep shared policy canonical; link to it
rather than copying permissions, release rules or project purpose into each skill.

Before editing, identify a realistic request or observed failure and the desired outcome.
Inspect the current instructions and relevant callers/resources. For a substantial
workflow rewrite, compare baseline decisions with revised decisions in isolated scenarios.
Use independent readers when authorized and useful; narrow corrections may use direct
walkthroughs. Record what was actually evaluated, not a manufactured failing history.

Give each skill a matching lowercase hyphenated name and a concise description of its
trigger. Include exclusions when they prevent likely misrouting. Keep the procedure
self-contained and proportional. Use references only for needed detail, verify they
exist and remove obsolete callers with removed resources. Avoid mandatory dependencies
on an uninstalled skill, agent host, model or execution framework.

In a generic starter, use prose steps, decision criteria and acceptance descriptions.
Do not include code examples, shell recipes, sample application structures or a required
technology/architecture. Metadata describes the skill format and may remain. Target-specific
contracts and commands can be discovered during actual project work without embedding
sample implementations in reusable guidance.

Validate metadata, references, scope and consistency, then apply realistic requests to
inspect the resulting decisions. Distinguish static validation from behavioral evidence;
a single scenario is not proof of universal compliance. Exercise interacting skills
together where their boundaries matter. Avoid fixed evaluation quotas without a measured
need. Preserve existing work while revising; never delete drafts to satisfy a ritual.

Use [verification](../verification-before-completion/SKILL.md) for claims and
[release-workflow](../release-workflow/SKILL.md) for the project's applicable review
and delivery process. Installation or external publication is a separate authorized action.
