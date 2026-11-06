# Scaffold

A portable starter for project instructions and agent skills. It helps an agent
understand the work, preserve existing decisions and verify its claims without
selecting an application architecture, language, framework, forge or branch model.

## Adopt the starter

1. Inspect the target project's existing instructions, skill locations and policies.
   Use the [initialization skill](.agents/skills/initialize-project/SKILL.md) when
   setup is requested; discovery alone does not authorize copying or replacement.
2. Reconcile [AGENTS.md](AGENTS.md) with existing guidance. Preserve applicable
   project decisions and user work rather than overwriting an instruction file.
3. Copy selected skill directories from [.agents/skills/](.agents/skills/) into
   the destination supported by the target's agent environment. Keep every selected
   skill's resources and include referenced skills or reconcile their procedures/links.
   Skills refer to the project root's AGENTS.md; the root also links back to skills.
   Update both directions for the actual directory name and relative depth, even when
   only the directory name changes. Check discovery using the target's agent environment.
4. Record project facts in the project's existing canonical location. The optional
   [configuration guide](docs/project-configuration.md) identifies useful facts;
   it does not choose values or require a new configuration format.
5. Verify discovery, links and representative tasks before relying on the package.
   Installation does not authorize dependencies, an application skeleton, publication
   or changes to branch protections. Review the diff before adopting it.

The portable package is AGENTS.md and the selected skills. This README, the
changelog and maintenance/validation documents describe this repository; they are
not instructions to impose on a target project. No runtime or dependency installation
is needed to copy the Markdown package. Preserve applicable license and attribution
requirements when distributing material; copying guidance does not relicense a project.

## Skills

Load a skill for its actual task, not simply because it is installed.

| Skill | Use |
| --- | --- |
| [brainstorming](.agents/skills/brainstorming/SKILL.md) | Resolve material uncertainty about intent or approach. |
| [writing-plans](.agents/skills/writing-plans/SKILL.md) | Organize an agreed outcome with meaningful dependencies. |
| [verification-before-completion](.agents/skills/verification-before-completion/SKILL.md) | Establish evidence for a precise claim. |
| [systematic-debugging](.agents/skills/systematic-debugging/SKILL.md) | Reproduce and diagnose a failure before correcting it. |
| [documentation-writer](.agents/skills/documentation-writer/SKILL.md) | Write or update task-focused documentation. |
| [doc-coauthoring](.agents/skills/doc-coauthoring/SKILL.md) | Collaborate on a substantial document with unresolved content. |
| [writing-skills](.agents/skills/writing-skills/SKILL.md) | Maintain useful, consistent agent guidance. |
| [find-skills](.agents/skills/find-skills/SKILL.md) | Investigate a demonstrated capability gap. |
| [initialize-project](.agents/skills/initialize-project/SKILL.md) | Adopt guidance in a selected project without replacing its choices. |
| [release-workflow](.agents/skills/release-workflow/SKILL.md) | Apply the project's actual change and delivery policy. |
| [github-ops](.agents/skills/github-ops/SKILL.md) | Optional adapter for authorized GitHub operations. |
| [gh-cli](.agents/skills/gh-cli/SKILL.md) | Optional GitHub CLI fallback when needed. |

The GitHub adapters are optional. Other skills work with available tools and project
policies; they do not require a forge, build system or particular agent host.

## Maintain this repository

Use [maintenance policy](docs/MAINTAINING.md) for this repository's own issue,
branch and review requirements. Use the [validation checklist](docs/validation.md)
to check the package. These maintenance choices are not portable defaults.
