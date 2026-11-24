import { deploymentSnapshots, environmentSecretNames } from "./fixtures.mjs";

export const appManagementTitle = "Manage app";

const actions = {
  suspend: {
    title: "Suspend",
    reviewTitle: "Review suspension",
    summary: "Pause the app and keep its data.",
    effects: [
      ["Running services", "Stop the app’s running services in Production and Staging. People lose access to those services until you restart them."],
      ["Railway data", "Keep the Railway project, databases, stored files, and backups. Railway may still charge for what you keep."],
      ["Connections", "Keep your domain settings and code on GitHub. Platfolio pauses deployments until you restart the app."],
    ],
  },
  resume: {
    title: "Resume",
    reviewTitle: "Review resume",
    summary: "Restart the app with its saved settings and data.",
    effects: [
      ["Running services", "Restart the paused services with the settings last used in each environment."],
      ["Railway data", "Use the same databases and stored files."],
      ["Verification", "Check that the app responds and its secure web addresses work. The previous check is from before the restart."],
    ],
  },
  remove: {
    reviewTitle: "Review removal",
    summary: "End Platfolio management. Keep the app and its data with your team.",
    effects: [
      ["Running services", "Keep each service in its current state. Running services continue to run and suspended services stay stopped."],
      ["Railway data", "The team keeps its project, databases, volumes, backups, and domains. Railway may still charge for the resources your team keeps."],
      ["Handoff", "Set up your team’s own way to deploy before removing the Platfolio workflow from GitHub. Remove Platfolio’s access to this app and keep any connections other apps still need. A status page published through Platfolio is taken down."],
    ],
  },
};

export function lifecycleStatus(instance) {
  if (instance.lifecycle === "removed") return "Removed from Platfolio · Demo";
  if (instance.lifecycle === "suspended") return "Suspended · Demo";
  if (instance.lifecycle === "resumed") return "Resumed · Demo";
  return "Managed · Demo";
}

export function sampleExport(team, instance) {
  const revisions = Object.values(deploymentSnapshots).map(run => [
    `- ${run.label}: ${run.release ? `release ${run.release}, ` : ""}commit ${run.commit}`,
    `  - Site: ${run.hosts.site}`,
    `  - API: ${run.hosts.api}`,
    `  - OIDC issuer: ${run.issuer}`,
  ].join("\n"));
  return [
    `# ${team.slug}/${instance.slug} — sample export`,
    "Design preview. This file contains a configuration inventory and a restore checklist. Actual backups and credentials stay with the team.",
    `Source repository: https://github.com/${instance.repository}`,
    "## Recorded environments",
    revisions.join("\n"),
    "## Secret inventory (names only)",
    Object.entries(environmentSecretNames).map(([name, note]) => `- ${name}: ${note}`).join("\n"),
    "## Restore and verify independently",
    [
      "1. Check out each applied revision. Keep the Compose manifest, environment registry, rendered Railway configuration, and deployment workflow.",
      "2. Take PostgreSQL dumps and volume backups from the team’s Railway project. Record checksums and verify that the backups can be restored.",
      "3. Restore into an isolated environment. Supply secrets from the team’s own store and verify the database, site, API, and sign-in before routing traffic.",
      "4. Move deployment ownership to the team’s workflow. Retire the Platfolio workflow and revoke instance-specific access after independent verification.",
    ].join("\n"),
  ].join("\n\n") + "\n";
}

export function createInstanceLifecycle({ heading, panel, link, badge, escape, authError, go, path, teamPath, isOwner, recordActivity, unpublishStatus }) {
  let current;

  function review(action, instance, exportLink) {
    const { reviewTitle, effects } = actions[action];
    return `<dialog class="team-dialog lifecycle-dialog" data-lifecycle-review="${action}" aria-labelledby="review-${action}">
      <h2 id="review-${action}">${reviewTitle}</h2>
      <dl class="facts"><div><dt>App</dt><dd>${escape(instance.name)} · Production and Staging</dd></div>
        ${effects.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      ${action === "remove" ? `<div class="actions">${exportLink}</div>` : ""}
      <form class="form" data-lifecycle-confirm="${action}">
        ${action === "remove" ? `<label for="confirm-instance">Type <code>${escape(instance.slug)}</code> to confirm</label>
          <input id="confirm-instance" name="instance" autocomplete="off" spellcheck="false" required aria-describedby="lifecycle-error">
          <div id="lifecycle-error">${authError()}</div>` : ""}
        <div class="actions">
          <button class="button secondary" type="button" data-lifecycle-cancel autofocus>Cancel</button>
          <button class="button ${action === "remove" ? "danger" : "primary"}" type="submit">${action === "remove"
            ? "Confirm removal in demo" : `Simulate ${action === "suspend" ? "suspension" : "resume"}`}</button>
        </div>
      </form>
    </dialog>`;
  }

  function page(team, instance) {
    const owner = isOwner(team);
    const removed = instance.lifecycle === "removed";
    const suspended = instance.lifecycle === "suspended";
    const actionsAllowed = removed ? [] : [suspended ? "resume" : "suspend", "remove"];
    current = { team, instance, actionsAllowed };
    const lastOutcome = {
      suspended: "Production and Staging are paused in the demo. Your team keeps its data in Railway.",
      resumed: "Restarted in the demo. The last deployment checks were before the restart. Both environments need a new check.",
      removed: instance.removedWhileSuspended
        ? "Management ended in the demo. The app stays paused in the team’s Railway project. Download your settings and see how to run the app on your own."
        : "Management ended in the demo. The running app stays with the team in Railway. Download your settings and see how to run the app on your own.",
    }[instance.lifecycle];
    const status = lastOutcome ? `<p class="notice" role="status">${lastOutcome}</p>` : "";
    const exportLink = `<a class="button secondary" download="${team.slug}-${instance.slug}-sample-export.md"
      href="${path(team.slug, instance.slug)}/sample-export.md">Download sample export</a>`;
    const exportPanel = panel("Export", `<p>Take your app’s settings and a guide to restoring them. Get backups of databases and stored files from your team’s Railway project.</p>
      <ul class="coverage-list">
        <li>App versions, settings, and deployment steps</li>
        <li>Names of passwords and keys and where to set them</li>
        <li>How to back up, restore, and deploy the app on your own</li>
      </ul>
      ${owner ? `<div class="actions">${exportLink}</div>` : '<p class="muted">Ask a team owner to export this instance.</p>'}`);
    const controls = removed
      ? panel("Run the app on your own", `<ol class="coverage-list">
          <li>Check the app and its backups in your Railway project.</li>
          <li>Set up your team’s own way to deploy. Then remove the Platfolio setup from GitHub.</li>
          <li>Remove Platfolio’s access to this app. Keep any connections other apps still need.</li>
        </ol><div class="actions">${link(teamPath(team.slug), "Back to team workspace", "button secondary")}</div>`)
      : panel("Pause or restart", `<ul class="resource-list lifecycle-action-list">
        ${["suspend", "resume"].map(action => `<li class="resource-row">
          <div class="item-text"><strong>${actions[action].title}</strong><span>${actions[action].summary}</span></div>
          ${owner && actionsAllowed.includes(action)
            ? `<button class="button secondary" type="button" data-lifecycle-action="${action}">${actions[action].reviewTitle}</button>`
            : owner ? `<span class="muted">${suspended ? "Already suspended" : "Available after suspension"}</span>` : ""}
        </li>`).join("")}</ul>
        ${owner ? "" : '<p class="muted">A team owner can suspend or resume the instance.</p>'}`);
    const removal = removed ? "" : panel("Remove from Platfolio", `
      <p>End management for this instance. Its Railway project and data stay with your team. If another app depends on this one, plan how it will stay connected before you remove it.</p>
      ${owner ? '<div class="actions"><button class="button secondary" type="button" data-lifecycle-action="remove">Review removal</button></div>'
        : '<p class="muted">A team owner can remove this instance.</p>'}`, "context-panel");
    return `${heading(team, appManagementTitle, "See what each action changes for Production and Staging.")}
    <div id="instance-lifecycle">
      ${status}
      <div class="page-columns"><div>${controls}${removal}</div>
        <div>${panel("App status", `${badge(lifecycleStatus(instance), suspended ? "attention" : "neutral")}
          <dl class="facts"><div><dt>Railway project</dt><dd>Team-owned · ${escape(instance.name)}</dd></div>
          <div><dt>Repository</dt><dd>${escape(instance.repository)}</dd></div></dl>`, "context-panel")}${exportPanel}</div>
      </div>
      ${owner ? actionsAllowed.map(action => review(action, instance, exportLink)).join("") : ""}
    </div>`;
  }

  function connect(root) {
    const view = root.querySelector("#instance-lifecycle");
    if (!view) return;
    const { team, instance, actionsAllowed } = current;
    view.addEventListener("click", event => {
      const opener = event.target.closest("[data-lifecycle-action]");
      if (opener) view.querySelector(`[data-lifecycle-review="${opener.dataset.lifecycleAction}"]`).showModal();
      const cancel = event.target.closest("[data-lifecycle-cancel]");
      if (cancel) cancel.closest("dialog").close();
    });
    view.addEventListener("submit", event => {
      const form = event.target;
      const action = form.dataset.lifecycleConfirm;
      if (!action) return;
      event.preventDefault();
      if (!isOwner(team) || !actionsAllowed.includes(action)) return;
      if (action === "remove" && new FormData(form).get("instance") !== instance.slug) {
        form.querySelector(".form-error").textContent = "Enter the app name shown above.";
        return;
      }
      if (action === "remove") {
        try {
          unpublishStatus(team, instance);
        } catch {
          form.querySelector(".form-error").textContent = "This browser could not remove the public status preview. Try again.";
          return;
        }
        instance.removedWhileSuspended = instance.lifecycle === "suspended";
      }
      instance.lifecycle = { suspend: "suspended", resume: "resumed", remove: "removed" }[action];
      instance.lifecycleChangedAt = new Date().toISOString();
      const href = path(team.slug, instance.slug);
      recordActivity(team, {
        kind: "lifecycle",
        label: { suspend: "Instance suspended", resume: "Instance resumed", remove: "Management removed" }[action],
        detail: `${instance.name} · Production and Staging`,
        href,
      });
      form.closest("dialog").close();
      go(href, { replace: true });
    });
  }

  return { page, connect };
}
