import { recordedChecksId } from "./fixtures.mjs";
import { activityDayLabel } from "./activity-feed.mjs";
const dayKey = date => date.toISOString().slice(0, 10);
const scopeLabel = { deployment: "Deployment", lifecycle: "App management", configuration: "Configuration", domain: "Domain", team: "Team", template: "Template" };

export function createTeamActivity({ panel, link, badge, escape, environmentPath, feed }) {
  const demoEvents = new Map();

  function record(team, actor, event) {
    if (!demoEvents.has(team.slug)) demoEvents.set(team.slug, []);
    demoEvents.get(team.slug).unshift({ ...event, actor, at: event.at ?? new Date().toISOString() });
  }

  function timeline(team) {
    const captured = team.instances.flatMap(instance => Object.entries(instance.recordedEnvironments ?? {}).map(([env, run]) => ({
      kind: "deployment",
      label: `${run.label} deployment checks passed`,
      detail: `${instance.name} · ${run.release ? `Release ${run.release} · ` : ""}${run.commit}`,
      at: run.observedAt,
      actor: "Deployment check",
      href: instance.lifecycle === "removed" ? undefined : environmentPath(team.slug, instance.slug, env, "deployments", recordedChecksId),
      captured: true,
    })));
    return [...captured, ...(demoEvents.get(team.slug) ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  }

  function deploymentActivity(events) {
    const deployments = events.filter(event => event.kind === "deployment");
    if (!deployments.length) return panel("Deployment activity", '<p class="empty-state">Once a deployment is checked, it will appear here.</p>');

    const utc = new Date();
    const days = Array.from({ length: 14 }, (_, index) =>
      new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate() - 13 + index)));
    const counts = new Map();
    for (const event of deployments.filter(item => item.captured)) {
      const key = dayKey(new Date(event.at));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = days.reduce((sum, date) => sum + (counts.get(dayKey(date)) ?? 0), 0);
    const history = days.map(at => {
      const count = counts.get(dayKey(at)) ?? 0;
      return {
        at, description: `${activityDayLabel(at)}: ${count} ${count === 1 ? "deployment" : "deployments"} passed`,
        tone: count ? "success" : "neutral", size: count >= 2 ? "full" : count ? "medium" : "baseline",
      };
    });
    return panel("Deployment activity", `
      <p class="muted"><strong>${total}</strong> ${total === 1 ? "deployment" : "deployments"} checked in the last 14 days</p>
      ${feed.dailyHistory("Deployments that passed checks each day (UTC)", history)}
      <ul class="resource-list deployment-activity-list">${deployments.slice(0, 5).map(event => {
        const summary = `<span class="item-text"><strong>${escape(event.label)}</strong><span>${escape(event.detail)} · ${feed.timestamp(event.at)}</span></span>
          ${event.captured ? badge("Passed", "success") : badge("Requested · Demo", "attention")}`;
        return `<li>${event.href
          ? `<a class="list-link" data-route href="${escape(event.href)}">${summary}<span class="chevron" aria-hidden="true">›</span></a>`
          : `<div class="resource-row">${summary}</div>`}</li>`;
      }).join("")}</ul>`, "profile-activity");
  }

  function activityLog(events, morePath) {
    const shown = morePath ? events.slice(0, 5) : events;
    return panel("Activity log", shown.length ? `
      ${feed.timeline(shown.map(event => ({
        title: event.label, href: event.href, at: event.at, tags: [[scopeLabel[event.kind]]],
        detail: `${event.actor} · ${event.detail}${event.captured ? "" : " · Demo"}`,
      })))}
      ${morePath && events.length > shown.length ? `<div class="actions">${link(morePath, "All activity", "button secondary")}</div>` : ""}`
      : '<p class="empty-state">No hosting activity recorded for this team yet.</p>');
  }

  function profile(team, morePath) {
    const events = timeline(team);
    return deploymentActivity(events) + activityLog(events, morePath);
  }

  return { record, profile, log: team => activityLog(timeline(team)), clear: () => demoEvents.clear() };
}
