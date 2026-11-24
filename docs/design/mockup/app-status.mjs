import { activityDayLabel } from "./activity-feed.mjs";

const pageColors = { blue: "Blue", green: "Green", purple: "Purple" };
const checkStates = {
  up: ["Up", "success"],
  down: ["Down", "danger"],
  unknown: ["Waiting for a check", "neutral"],
  paused: ["Paused", "neutral"],
};

function demoState(instance) {
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, index) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13 + index)).toISOString());
  const monitors = [
    { id: "website", label: "Website", environment: "Production" },
    { id: "api", label: "API", environment: "Production" },
    { id: "staging", label: "Test website", environment: "Staging" },
  ].map(monitor => ({
    ...monitor,
    checks: monitor.id === "staging" ? [] : days.map((date, index) => ({
      at: date,
      state: monitor.id === "website" && index === 11 ? "down" : "up",
    })),
  }));
  return {
    days,
    monitors,
    outages: [{
      id: 1, service: "website", title: "Website was temporarily unavailable", visible: true,
      updates: [
        { at: days[11], message: "Some visitors could not open the website." },
        { at: new Date(Date.parse(days[11]) + 22 * 60_000).toISOString(), message: "The website is responding again." },
      ],
      resolved: true,
    }],
    draft: { title: instance.name, color: "blue", services: ["website", "api"] },
    notice: "",
  };
}

const publicationKey = (team, app) => `platfolio-mockup:status:v1:${team}/${app}`;

function readPublication(team, app) {
  try {
    const value = JSON.parse(localStorage.getItem(publicationKey(team, app)));
    return typeof value?.title === "string" && Array.isArray(value.days) &&
      Array.isArray(value.monitors) && Array.isArray(value.outages) ? value : null;
  } catch {
    return null;
  }
}

export function createAppStatus({ heading, teamHeading, panel, link, badge, escape, authError, go, path, publicPath, isOwner, feed }) {
  const sessions = new Map();
  let current;

  function statusBadge(state) {
    return badge(...checkStates[state]);
  }

  function currentState(monitor, instance) {
    const last = monitor.checks.at(-1);
    if (instance.lifecycle === "suspended") return "paused";
    if (instance.lifecycle === "resumed" && last?.at < instance.lifecycleChangedAt) return "unknown";
    return last?.state ?? "unknown";
  }

  function monitorRows(monitors, days, { privateView = false } = {}) {
    return `<ul class="resource-list status-monitors">${monitors.map(monitor => {
      const state = monitor.state;
      const last = monitor.checks.at(-1);
      const history = days.map(at => {
        const checks = monitor.checks.filter(check => check.at.slice(0, 10) === at.slice(0, 10));
        const down = checks.some(check => check.state === "down");
        const description = `${activityDayLabel(at)} · ${down ? "An outage was detected" : checks.length ? "Checks passed" : "No checks"}`;
        return { at, description, tone: down ? "danger" : checks.length ? "success" : "neutral", size: checks.length ? "medium" : "baseline" };
      });
      return `<li>
        <div class="status-monitor-label">
          <div class="item-text"><strong>${escape(monitor.label)}</strong>${privateView ? `<span>${monitor.environment}</span>` : ""}</div>
          ${statusBadge(state)}
        </div>
        ${feed.dailyHistory(`${monitor.label} checks by day (UTC)`, history)}
        <p class="muted">${last ? `Last checked ${feed.timestamp(last.at)}` : "No checks recorded yet."}</p>
      </li>`;
    }).join("")}</ul>`;
  }

  function monitorPanel(monitors, days, options) {
    return panel("Service checks", `<p class="muted">14 days of sample checks. A day shows an outage if any check that day failed.</p>
      ${monitorRows(monitors, days, options)}
      <p class="status-key"><span data-tone="success">Passed</span><span data-tone="danger">Outage detected</span><span data-tone="neutral">No checks</span></p>`);
  }

  function outageList(outages, monitors, { privateView = false } = {}) {
    return outages.length ? feed.timeline(outages.map(outage => {
      const monitor = monitors.find(item => item.id === outage.service);
      const latest = outage.updates.at(-1);
      return {
        title: outage.title, at: latest.at,
        tags: [outage.resolved ? ["Resolved", "success"] : ["Ongoing", "danger"]],
        detail: `${monitor.label}${privateView ? ` · ${outage.visible ? "Included when published" : "Team only"}` : ""}`,
        content: `<ol class="status-update-list" aria-label="Outage updates">
          ${[...outage.updates].reverse().map(update => `<li>
            ${feed.timestamp(update.at)}<p>${escape(update.message)}</p>
          </li>`).join("")}
        </ol>`,
      };
    })) : '<p class="empty-state">No outages have been reported.</p>';
  }

  function projection(session, instance) {
    const { title, color, services } = session.draft;
    const monitors = session.monitors.filter(monitor => monitor.environment === "Production" && services.includes(monitor.id))
      .map(monitor => ({
        id: monitor.id, label: monitor.label, state: currentState(monitor, instance),
        checks: monitor.checks.slice(-50).map(({ at, state }) => ({ at, state })),
      }));
    const outages = session.outages.filter(outage => outage.visible && monitors.some(monitor => monitor.id === outage.service))
      .map(({ service, title, resolved, updates }) => ({ service, title, resolved, updates: updates.map(({ at, message }) => ({ at, message })) }));
    return { title, color, days: [...session.days], monitors, outages, publishedAt: new Date().toISOString() };
  }

  function visitorContent(publication, preview = false) {
    const down = publication.monitors.some(monitor => monitor.state === "down");
    const pending = publication.monitors.some(monitor => monitor.state !== "up");
    const paused = publication.monitors.every(monitor => monitor.state === "paused");
    const status = down ? "Some services are down" : paused ? "Service checks are paused"
      : pending ? "Waiting for checks" : "All listed services are up";
    const color = Object.hasOwn(pageColors, publication.color) ? publication.color : "blue";
    return `<div class="status-visitor-content" data-color="${color}">
      <header class="status-brand">
        <span class="status-brand-mark" aria-hidden="true">${escape(Array.from(publication.title)[0]?.toUpperCase() || "S")}</span>
        <div><p>${preview ? "Public page preview · Sample data" : "Public status · Sample data"}</p>
          <${preview ? "h2" : "h1"}${preview ? "" : ' tabindex="-1"'}>${escape(publication.title)} status</${preview ? "h2" : "h1"}></div>
      </header>
      <div class="status-summary" data-state="${down ? "down" : pending ? "unknown" : "up"}">
        <strong>${status}</strong><p>${preview ? "This is what visitors will see." : `Published ${feed.timestamp(publication.publishedAt)}`}</p>
      </div>
      ${monitorPanel(publication.monitors, publication.days)}
      ${panel("Outage reports", outageList(publication.outages, publication.monitors))}
    </div>`;
  }

  function publicPage(team, app) {
    const publication = readPublication(team, app);
    return `<main class="status-public" id="main">${publication ? visitorContent(publication)
      : heading("Status page unavailable", "The team can publish a status page from its app workspace.")}</main>`;
  }

  function page(team, instance) {
    const key = `${team.slug}/${instance.slug}`;
    const publication = readPublication(team.slug, instance.slug);
    if (!sessions.has(key)) {
      const session = demoState(instance);
      if (publication) {
        session.draft = { title: publication.title, color: publication.color, services: publication.monitors.map(item => item.id) };
        session.days = publication.days;
        for (const monitor of session.monitors) {
          const saved = publication.monitors.find(item => item.id === monitor.id);
          if (saved) monitor.checks = saved.checks;
        }
        session.outages = publication.outages.map((outage, index) => ({ ...outage, visible: true, id: index + 1 }));
      }
      sessions.set(key, session);
    }
    const session = sessions.get(key);
    const editable = isOwner(team);
    const monitors = session.monitors.map(monitor => ({ ...monitor, state: currentState(monitor, instance) }));
    const href = path(team.slug, instance.slug);
    const visitorUrl = publicPath(team.slug, instance.slug);
    current = { team, instance, session, href };
    const status = session.notice;
    session.notice = "";
    return `${teamHeading(team, "Status", "See whether your app is up and share updates when something goes wrong.")}
      <div id="app-status">
        <p class="muted status-disclaimer">Sample checks and outages for this walkthrough.</p>
        ${status ? `<p class="notice" role="status">${escape(status)}</p>` : ""}
        <div class="page-columns">
          <div>
            ${monitorPanel(monitors, session.days, { privateView: true })}
            ${panel("Outages", outageList(session.outages, session.monitors, { privateView: true }))}
          </div>
          <div>
            ${panel("Public page", `${badge(publication ? "Published in demo" : "Private", publication ? "success" : "neutral")}
              <p class="muted">${publication ? `Last published ${feed.timestamp(publication.publishedAt)}. Publish again to share new checks and outage updates.`
                : "Visitors see only the production services you select and the outage reports you include."}</p>
              ${publication ? `<div class="actions">${link(visitorUrl, "Open public page", "button secondary")}</div>` : ""}
              ${editable ? `<form class="form" data-status-form="publish">
                <label for="public-status-name">Public display name</label>
                <input id="public-status-name" name="title" required maxlength="60" value="${escape(session.draft.title)}">
                <label for="public-status-color">Brand color</label>
                <select id="public-status-color" name="color">${Object.entries(pageColors).map(([key, label]) =>
                  `<option value="${key}"${key === session.draft.color ? " selected" : ""}>${label}</option>`).join("")}</select>
                <fieldset class="form-group status-service-settings"><legend>Show these services</legend>
                  ${session.monitors.filter(monitor => monitor.environment === "Production").map(monitor =>
                    `<label><input type="checkbox" name="services" value="${monitor.id}"${session.draft.services.includes(monitor.id) ? " checked" : ""}> ${monitor.label}</label>`).join("")}
                </fieldset>
                <p class="input-help">Publishing shares a preview in this browser.</p>
                ${authError()}
                <div class="actions"><button class="button primary" type="submit" value="publish">${publication ? "Publish updates" : "Publish demo page"}</button>
                  <button class="button secondary" type="submit" value="preview">Preview</button>
                  ${publication ? '<button class="button quiet" type="button" data-status-action="unpublish">Unpublish</button>' : ""}</div>
              </form>` : '<p class="muted">A team owner can publish this page.</p>'}`, "context-panel")}
          </div>
        </div>
        <dialog class="team-dialog status-preview" aria-label="Preview public status page">
          <div data-status-preview></div>
          <div class="actions"><button type="button" class="button secondary" data-status-action="close">Close preview</button></div>
        </dialog>
      </div>`;
  }

  function connect(root) {
    const view = root.querySelector("#app-status");
    if (!view) return;
    const { team, instance, session, href } = current;
    if (!isOwner(team)) return;
    const key = publicationKey(team.slug, instance.slug);
    const dialog = view.querySelector("dialog");
    const refresh = message => {
      session.notice = message;
      go(href, { replace: true });
    };

    view.addEventListener("click", event => {
      const action = event.target.closest("[data-status-action]")?.dataset.statusAction;
      if (action === "close") dialog.close();
      if (action === "unpublish") {
        try {
          unpublish(team, instance);
        } catch {
          refresh("This browser could not remove the public preview.");
          return;
        }
        refresh("Public page unpublished. Your team can still see this status page.");
      }
    });

    view.addEventListener("submit", event => {
      const form = event.target;
      if (form.dataset.statusForm !== "publish") return;
      event.preventDefault();
      const data = new FormData(form);
      const services = data.getAll("services").filter(id =>
        session.monitors.some(monitor => monitor.id === id && monitor.environment === "Production"));
      const title = String(data.get("title") ?? "").trim();
      if (!title || !services.length) {
        form.querySelector(".form-error").textContent = "Enter a display name and select at least one service.";
        return;
      }
      session.draft = { title, color: data.get("color"), services };
      const publication = projection(session, instance);
      if (event.submitter?.value === "preview") {
        dialog.querySelector("[data-status-preview]").innerHTML = visitorContent(publication, true);
        dialog.showModal();
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify(publication));
      } catch {
        form.querySelector(".form-error").textContent = "This browser could not save the public preview.";
        return;
      }
      refresh("Public status page published in this browser.");
    });
  }

  function unpublish(team, instance) {
    if (readPublication(team.slug, instance.slug)) localStorage.removeItem(publicationKey(team.slug, instance.slug));
  }

  return { page, publicPage, connect, unpublish };
}
