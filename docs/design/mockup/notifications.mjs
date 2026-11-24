const events = {
  "deployment-failed": { label: "Deployment fails", mark: "!" },
  "status-outage": { label: "Service goes down", mark: "↓" },
  "secret-updated": { label: "Password or key is updated", mark: "↻" },
};

const environmentLabels = { all: "All environments", production: "Production", staging: "Staging" };
const environmentLabel = environment => environmentLabels[environment] ?? environment;
const appsIn = team => team?.instances.filter(app => app.lifecycle !== "removed") ?? [];

function environmentsFor(app) {
  const environments = Object.keys(app.recordedEnvironments ?? {});
  return ["all", ...(environments.length ? environments : app.templateSource?.staging ? ["production", "staging"] : ["production"])];
}

export function createNotifications({ person, teams, activeTeam, heading, panel, link, badge, escape, authError, update, emailSettingsPath }) {
  let editing;
  let nextId = 1;

  function option(value, label, selected) {
    return `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`;
  }

  function resolve(teamSlug, appSlug) {
    const team = teams().find(item => item.slug === teamSlug);
    const app = appsIn(team).find(item => item.slug === appSlug);
    return app ? { team, app } : null;
  }

  function rules() {
    return (person().notificationRules ?? []).flatMap(rule => {
      const scope = resolve(rule.team, rule.app);
      return scope ? [{ rule, ...scope }] : [];
    });
  }

  function delivery(rule, team) {
    const current = person();
    const verified = new Set(current.emails.filter(email => email.verified).map(email => email.address));
    return [rule?.email, current.teamEmails[team?.slug], current.defaultEmail].find(address => verified.has(address));
  }

  function ruleList(rows) {
    if (!rows.length) return `<div class="empty-state notification-empty">
      <strong>No notification rules yet</strong>
      <p>Start with an app and an event you want to hear about.</p>
    </div>`;
    const paused = rows.filter(({ rule }) => rule.paused).length;
    return `<p class="muted notification-count">${rows.length - paused} active${paused ? ` · ${paused} paused` : ""}</p>
      <ul class="resource-list notification-rules">${rows.map(({ rule, team, app }) => {
        const address = delivery(rule, team);
        const event = events[rule.event];
        const scope = `${team.name} / ${app.name}`;
        const environment = environmentLabel(rule.environment);
        return `<li class="notification-rule" data-event="${rule.event}" data-paused="${rule.paused}">
          <div class="notification-rule-header">
            <span class="notification-event-mark" aria-hidden="true">${event.mark}</span>
            <div class="item-text notification-rule-title">
              <h3>${event.label}</h3>
              <span>${escape(scope)}</span>
            </div>
            ${badge(rule.paused ? "Paused" : "Active", rule.paused ? "neutral" : "success")}
          </div>
          <dl class="facts notification-rule-details">
            <div><dt>Environment</dt><dd>${escape(environment)}</dd></div>
            <div><dt>Send to</dt><dd>${address ? escape(address) : "No verified delivery address"}
              ${rule.email ? "" : '<span class="notification-default">Default</span>'}</dd></div>
          </dl>
          <div class="actions notification-rule-actions">
            ${["Edit", rule.paused ? "Resume" : "Pause", "Remove"].map(action =>
              `<button type="button" class="button ${action === "Edit" ? "secondary" : "quiet"}" data-notification-action="${action.toLowerCase()}" data-rule="${rule.id}"
                aria-label="${escape(`${action} rule: ${scope} · ${event.label} · ${environment}`)}">${action}</button>`).join("")}
          </div>
        </li>`;
      }).join("")}</ul>`;
  }

  function appOptions(team, selected) {
    const apps = appsIn(team);
    return apps.length ? apps.map(app => option(app.slug, app.name, selected)).join("")
      : option("", "No apps on this team", "");
  }

  function environmentOptions(app, selected) {
    return app ? environmentsFor(app).map(environment => option(environment, environmentLabel(environment), selected)).join("")
      : option("", "Choose an app first", "");
  }

  function page() {
    const current = person();
    const memberships = teams();
    const rows = rules();
    const selected = editing?.person === current.id ? rows.find(entry => entry.rule.id === editing.rule) : undefined;
    const team = selected?.team ?? activeTeam() ?? memberships[0];
    const app = selected?.app ?? appsIn(team)[0];
    const verified = current.emails.filter(email => email.verified);
    const rule = selected?.rule;
    const address = team ? delivery(null, team) : undefined;
    const defaultsLabel = address ? `Use default · ${address}` : "Use default · No verified address";
    const form = team ? `<form class="form notification-editor" data-notification-form data-editing="${rule?.id ?? ""}">
      <fieldset class="form-group notification-fieldset">
        <legend>App scope</legend>
        <div class="notification-scope-fields">
          <label for="notification-team">Team
            <select id="notification-team" name="team">${memberships.map(item => option(item.slug, item.name, team.slug)).join("")}</select>
          </label>
          <label for="notification-app">App
            <select id="notification-app" name="app" required${app ? "" : " disabled"}>${appOptions(team, app?.slug)}</select>
          </label>
        </div>
        <label for="notification-environment">Environment</label>
        <select id="notification-environment" name="environment"${app ? "" : " disabled"}>${environmentOptions(app, rule?.environment)}</select>
      </fieldset>
      <fieldset class="form-group notification-fieldset">
        <legend>Event and delivery</legend>
        <label for="notification-event">Notify me when</label>
        <select id="notification-event" name="event">${Object.entries(events).map(([id, event]) => option(id, event.label, rule?.event)).join("")}</select>
        <label for="notification-email">Send to</label>
        <select id="notification-email" name="email">
          ${option("", defaultsLabel, rule?.email || "")}
          ${verified.map(email => option(email.address, email.address, rule?.email)).join("")}
        </select>
      </fieldset>
      ${authError()}
      <div class="actions"><button class="button primary" type="submit"${app && verified.length ? "" : " disabled"}>${rule ? "Save rule" : "Add rule"}</button>
        ${rule ? '<button class="button secondary" type="button" data-notification-action="cancel">Cancel editing</button>' : ""}</div>
    </form>` : '<p class="muted">Join a team to see its apps here.</p>';

    return `${heading("Notifications", "Choose which app events you want to hear about. The demo saves your rules for this session.")}
      <div id="notification-rules" class="page-columns">
        ${panel("Your rules", ruleList(rows))}
        <div>
          ${panel(rule ? "Edit rule" : "Add a rule", form)}
          ${panel("Email delivery", `<p class="muted">Manage the verified addresses your rules use by default. Password and key updates identify the setting that changed.</p>
            <div class="actions">${link(emailSettingsPath, "Email delivery settings", "button secondary")}</div>`, "context-panel")}
        </div>
      </div>`;
  }

  function connect(root) {
    const view = root.querySelector("#notification-rules");
    if (!view) return;
    const form = view.querySelector("[data-notification-form]");
    const current = person();
    if (form) {
      const { team, app, environment, email } = form.elements;
      form.addEventListener("change", event => {
        if (event.target !== team && event.target !== app) return;
        const selected = teams().find(item => item.slug === team.value);
        if (event.target === team) {
          app.innerHTML = appOptions(selected);
          const address = delivery(null, selected);
          email.options[0].textContent = address ? `Use default · ${address}` : "Use default · No verified address";
        }
        const scope = resolve(team.value, app.value);
        app.disabled = environment.disabled = !scope;
        environment.innerHTML = environmentOptions(scope?.app);
        form.querySelector('[type="submit"]').disabled = !scope || !current.emails.some(item => item.verified);
      });

      form.addEventListener("submit", event => {
        event.preventDefault();
        const data = new FormData(form);
        const scope = resolve(data.get("team"), data.get("app"));
        const environment = data.get("environment");
        const eventType = data.get("event");
        const emailAddress = data.get("email");
        const error = form.querySelector(".form-error");
        if (!scope || !environmentsFor(scope.app).includes(environment) || !Object.hasOwn(events, eventType)) {
          error.textContent = "Choose an app, an environment, and an event.";
          return;
        }
        if (emailAddress ? !current.emails.some(item => item.verified && item.address === emailAddress) : !delivery(null, scope.team)) {
          error.textContent = "Choose a verified email address.";
          return;
        }
        const existing = rules().find(({ rule }) => rule.id === form.dataset.editing)?.rule;
        const saved = current.notificationRules ??= [];
        if (saved.some(rule => rule.id !== existing?.id && rule.team === scope.team.slug && rule.app === scope.app.slug &&
          rule.event === eventType && (rule.environment === environment || rule.environment === "all" || environment === "all"))) {
          error.textContent = "A rule already covers this event and environment. Edit that rule or choose a different scope.";
          return;
        }
        const fields = { team: scope.team.slug, app: scope.app.slug, environment, event: eventType, email: emailAddress };
        if (existing) Object.assign(existing, fields);
        else saved.push({ ...fields, id: `rule-${nextId++}`, paused: false });
        editing = undefined;
        update(existing ? "Notification rule saved." : "Notification rule added.");
      });
    }

    view.addEventListener("click", event => {
      const control = event.target.closest("[data-notification-action]");
      if (!control) return;
      const action = control.dataset.notificationAction;
      if (action === "cancel") {
        editing = undefined;
        update("");
        return;
      }
      const rule = rules().find(entry => entry.rule.id === control.dataset.rule)?.rule;
      if (!rule) return;
      if (action === "edit") {
        editing = { person: current.id, rule: rule.id };
        update("");
        document.querySelector("#notification-team")?.focus();
      } else if (action === "remove") {
        current.notificationRules = current.notificationRules.filter(item => item.id !== rule.id);
        editing = undefined;
        update("Notification rule removed.");
      } else {
        rule.paused = action === "pause";
        update(rule.paused ? "Notification rule paused." : "Notification rule resumed.");
      }
    });
  }

  function removeAddress(current, address) {
    for (const rule of current.notificationRules ?? []) {
      if (rule.email === address) rule.email = "";
    }
  }

  return { page, connect, removeAddress };
}
