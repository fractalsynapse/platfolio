import { deploymentSnapshots, environmentSecretNames, recordedChecksId } from "./fixtures.mjs";

export const environmentSections = {
  overview: "Overview",
  deployments: "Deployments",
  configuration: "Configuration",
  domains: "Domains",
};

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  timeZoneName: "short", timeZone: "America/New_York",
});
const buildLabel = run => run.release ? `Release ${run.release}` : "Test build";
const timestamp = date => `<time datetime="${date}">${dateTime.format(new Date(date))}</time>`;
const deploymentChecks = ["The website and API responded", "The expected app version was running", "The database was ready", "Key pages opened"];
const services = { site: "Site", api: "Control plane API" };
const domainStages = [
  ["Awaiting DNS", "Waiting for DNS", "Pending"],
  ["Verified", "Pending", "Pending"],
  ["Verified", "Issued", "Pending verification"],
  ["Verified", "Issued", "Ready"],
];
const domainChecks = ["Simulate DNS check", "Simulate certificate issuance", "Simulate HTTPS check"];
const domainFeedback = [
  "DNS verified in the demo. Certificate issuance is pending.",
  "Certificate issued in the demo. HTTPS verification is pending.",
  "HTTPS verified in the demo.",
];

export function createEnvironmentManagement({ heading, panel, link, navLink, badge, escape, authError, go, path, lifecyclePath, canManage, recordActivity }) {
  const sessions = new Map();
  let current;
  const historicalStatus = () => badge("Checks passed", "success");
  const action = (label, name, value = "", style = "secondary", accessibleName) =>
    `<button type="button" class="button ${style}" data-env-action="${name}" data-value="${escape(value)}"${accessibleName ? ` aria-label="${escape(accessibleName)}"` : ""}>${label}</button>`;

  function list(team, instance) {
    const status = instance.lifecycle === "suspended" ? badge("Suspended · Demo", "attention")
      : instance.lifecycle === "resumed" ? badge("Needs a new check · Demo", "attention") : historicalStatus();
    return `<p class="muted">The most recent checks for each environment.</p>
      <ul class="resource-list env-list">${Object.entries(deploymentSnapshots).map(([env, run]) =>
        `<li><a href="${path(team.slug, instance.slug, env)}" data-route class="list-link">
          <span class="environment-symbol" data-environment="${env}" aria-hidden="true"></span>
          <span class="item-text"><strong>${run.label}</strong>
            <span>${buildLabel(run)} · <code>${run.commit}</code></span>
            <span>Last checked ${timestamp(run.observedAt)}</span>
          </span>
          ${status}<span class="chevron" aria-hidden="true">›</span>
        </a><nav class="environment-shortcuts" aria-label="${run.label} shortcuts">
          ${Object.entries(environmentSections).filter(([name]) => name !== "overview").map(([name, title]) =>
            link(path(team.slug, instance.slug, env, name), title)).join("")}
        </nav></li>`).join("")}</ul>`;
  }

  function overview(run, url) {
    return `<div class="page-columns">
      ${panel("Last checked deployment", `${historicalStatus()}
        <dl class="facts fact-grid"><div><dt>Build</dt><dd>${buildLabel(run)}</dd></div>
        <div><dt>GitHub commit</dt><dd><code>${run.commit}</code></dd></div></dl>
        <p class="panel-meta">Last checked ${timestamp(run.observedAt)}</p>
        <div class="actions">${link(url("deployments", recordedChecksId), "View deployment checks", "button secondary")}</div>`, "deployment-panel")}
      ${panel("App addresses", `<ul class="source-links env-quick-links">
        ${Object.entries(run.hosts).map(([service, host]) => `<li><a href="https://${host}" target="_blank" rel="noopener">${services[service]} · ${host}</a></li>`).join("")}
      </ul>`, "context-panel")}
    </div>`;
  }

  function deployments(instance, run, url, session, detail, editable) {
    if (detail) {
      const captured = detail === recordedChecksId || detail === "captured-smoke";
      const request = session.requests.find(item => item.id === detail);
      if (!captured && !request) return panel("Deployment unavailable", `<p>Open a deployment from this environment’s history.</p>
        <div class="actions">${link(url("deployments"), "Deployment history", "button secondary")}</div>`);
      return `<div class="page-columns">
        ${panel(captured ? "Deployment check results" : "Demo redeploy request", `
          ${captured ? historicalStatus() : badge("Requested · Demo", "attention")}
          <dl class="facts fact-grid"><div><dt>Build</dt><dd>${buildLabel(run)}</dd></div>
          <div><dt>GitHub commit</dt><dd><code>${run.commit}</code></dd></div>
          <div><dt>Environment</dt><dd>${run.label}</dd></div>
          <div><dt>${captured ? "Checked on" : "Requested on"}</dt><dd>${timestamp(captured ? run.observedAt : request.at)}</dd></div></dl>
          ${captured ? "" : '<p class="muted">This request was added to the demo history.</p>'}
          <div class="actions">${link(url("deployments"), "Deployment history", "button secondary")}</div>`, "deployment-panel")}
        ${captured ? panel("What we checked", `<ul class="coverage-list">
          ${deploymentChecks.map(check => `<li>${check}</li>`).join("")}
          <li>Sign-in and access · ${run.protocolChecks} of ${run.protocolChecks} checks passed</li></ul>`, "context-panel") : ""}
      </div>`;
    }
    const rows = [
      ...session.requests.map(request => [request.id, "Demo redeploy", badge("Requested", "attention"), request.at]),
      [recordedChecksId, buildLabel(run), historicalStatus(), run.observedAt],
    ];
    return `<div class="page-columns">
      ${panel("Deployment history", `<ul class="resource-list env-list">${rows.map(([id, label, status, at]) =>
        `<li><a href="${url("deployments", id)}" data-route class="list-link">
          <span class="item-text"><strong>${label}</strong><span><code>${run.commit}</code> · ${timestamp(at)}</span></span>
          ${status}<span class="chevron" aria-hidden="true">›</span>
        </a></li>`).join("")}</ul>`)}
      ${editable ? panel("Redeploy a build", `<p class="muted">Review which version will run and where before you deploy it again.</p>
        <div class="actions">${action("Review redeploy", "review-deploy")}</div>`, "context-panel") : ""}
    </div>
    ${editable ? `<dialog class="team-dialog" aria-labelledby="redeploy-title">
      <h2 id="redeploy-title">Review demo redeploy</h2>
      <dl class="facts fact-grid"><div><dt>Instance</dt><dd>${escape(instance.name)}</dd></div>
      <div><dt>Environment</dt><dd>${run.label}</dd></div>
      <div><dt>Build</dt><dd>${buildLabel(run)} · <code>${run.commit}</code></dd></div></dl>
      <p class="muted">This adds a request to the ${run.label} demo history.</p>
      <div class="actions">${action("Cancel", "cancel-deploy")}${action("Request demo redeploy", "deploy", "", "primary")}</div>
    </dialog>` : ""}`;
  }

  function secretFeedback(count) {
    if (count === 1) return "Marked as set in the demo. The app still needs to be checked.";
    return count ? `Replaced in demo · ${count - 1} ${count === 2 ? "replacement" : "replacements"} this session.` : "";
  }

  function configuration(run, session, editable) {
    return `<div class="page-columns">
      ${panel("Passwords and keys", `<p class="muted">These private values help your app connect to other services. In the demo, use the buttons to mark a value as set.</p>
        <ul class="resource-list">${Object.entries(environmentSecretNames).map(([name, description]) => {
          const count = session.deliveries.get(name) ?? 0;
          const buttonLabel = count ? "Replace in demo" : "Set in demo";
          return `<li class="secret-row">
            <div class="item-text"><strong class="env-value"><code>${name}</code></strong><span>${description}</span></div>
            <div class="badge-list" data-secret-presence>${count ? badge("Set · Demo", "success") : badge("Setup unconfirmed")}
              ${badge("App still needs a check")}</div>
            ${editable ? `<div class="actions">${action(buttonLabel, "set-secret", name, "secondary", `${buttonLabel} ${name}`)}</div>` : ""}
            <p class="secret-feedback muted" role="status" aria-atomic="true">${secretFeedback(count)}</p>
          </li>`;
        }).join("")}</ul>`)}
      ${panel("How people sign in", `<dl class="facts"><div><dt>Recorded sign-in provider URL</dt>
        <dd class="env-value">${run.issuer}</dd></div>
        ${session.issuerDraft ? `<div><dt>Proposed provider URL · Demo</dt><dd class="env-value">${escape(session.issuerDraft)}</dd></div>` : ""}</dl>
        ${editable ? `<form class="form" data-env-form="issuer">
          <label for="issuer-url">Propose a sign-in provider URL</label>
          <input id="issuer-url" name="issuer" type="url" required value="${escape(session.issuerDraft ?? run.issuer)}" aria-describedby="issuer-help">
          <span class="input-help" id="issuer-help">Use the URL your sign-in provider calls its issuer. This previews the change for ${run.label}.</span>
          ${authError()}
          <div class="actions"><button class="button primary" type="submit">Review change</button>
            ${session.issuerDraft ? action("Discard proposal", "discard-issuer") : ""}</div>
        </form>` : ""}`, "context-panel")}
    </div>`;
  }

  function dnsRecords(domain) {
    const records = [
      ["CNAME", domain.host, `${domain.service}.railway.example.test`],
      ["TXT", `_railway-verify.${domain.host}`, "railway-verify=demo-only"],
    ];
    return `<div class="env-dns"><h3>DNS records · Demo</h3>
      <p class="secret-feedback muted" role="status"></p>
      <p class="input-help">These sample records show what you would add in your domain provider’s DNS settings to point the address to your app.</p>
      ${records.map(([type, name, value]) => `
        <dl class="facts fact-grid"><div><dt>Type</dt><dd>${type}</dd></div>
        <div><dt>Name</dt><dd><code>${escape(name)}</code></dd></div>
        <div><dt>Value</dt><dd><code>${value}</code></dd></div></dl>
        ${action(`Copy ${type} record`, "copy-record", `${name}\t${type}\t${value}`)}`).join("")}</div>`;
  }

  function domains(run, session, editable) {
    return `<div class="page-columns">
      ${panel("Web addresses", `<p class="muted">Addresses from the last checked build and any domains you add in this demo.</p>
        <ul class="resource-list">
          ${Object.entries(run.hosts).map(([service, host]) => `<li class="env-domain-row">
            <div class="item-text"><strong>${host}</strong><span>${services[service]}</span></div>
            ${badge("Secure connection checked", "success")}<span class="muted">Last checked ${timestamp(run.observedAt)}</span>
          </li>`).join("")}
          ${session.domains.map(domain => `<li class="env-domain-row" id="domain-${escape(domain.host)}" tabindex="-1">
            <div class="item-text"><strong>${escape(domain.host)}</strong><span>${services[domain.service]} · Demo</span></div>
            <dl class="facts fact-grid">${["DNS", "Certificate", "HTTPS"].map((label, index) =>
              `<div><dt>${label}</dt><dd>${domainStages[domain.stage][index]}</dd></div>`).join("")}</dl>
            <details class="env-domain-records"${domain === session.domains.at(-1) && domain.stage === 0 ? " open" : ""}>
              <summary>DNS setup</summary>${dnsRecords(domain)}
            </details>
            ${editable ? `<div class="actions">
              ${domainChecks[domain.stage] ? action(domainChecks[domain.stage], "check-domain", domain.host) : ""}
              ${action("Remove demo domain", "remove-domain", domain.host)}
            </div>` : ""}
          </li>`).join("")}
        </ul>`)}
      ${editable ? panel("Attach a custom domain", `<form class="form" data-env-form="domain">
        <label for="domain-host">Domain name</label>
        <input id="domain-host" name="host" placeholder="app.example.test" required maxlength="253" autocapitalize="none" spellcheck="false">
        <label for="domain-service">Service</label>
        <select id="domain-service" name="service">${Object.entries(services).map(([key, label]) =>
          `<option value="${key}">${label}</option>`).join("")}</select>
        ${authError()}
        <div class="actions"><button class="button primary" type="submit">Add demo domain</button></div>
      </form>`, "context-panel") : ""}
    </div>`;
  }

  function page(team, instance, env, section, detail) {
    const key = `${team.slug}/${instance.slug}/${env}`;
    if (!sessions.has(key)) sessions.set(key, { deliveries: new Map(), requests: [], domains: [], issuerDraft: null, notice: "" });
    const session = sessions.get(key);
    const run = deploymentSnapshots[env];
    const url = (name, id) => path(team.slug, instance.slug, env, name, id);
    const suspended = instance.lifecycle === "suspended";
    const editable = canManage(team) && !suspended;
    current = { url, session, section, editable, team, instance, run };
    const tabs = (label, links) => `<nav class="account-tabs" aria-label="${label}">${links.join("")}</nav>`;
    const views = {
      overview: () => overview(run, url),
      deployments: () => deployments(instance, run, url, session, detail, editable),
      configuration: () => configuration(run, session, editable),
      domains: () => domains(run, session, editable),
    };

    const description = env === "production" ? "The version people use." : "A separate place to test changes.";
    return `${heading(team, run.label, description)}
      <div id="environment-view">
        <div class="environment-navigation">
          ${tabs("Target environment", Object.entries(deploymentSnapshots).map(([name, item]) =>
            navLink(path(team.slug, instance.slug, name, section), item.label, env === name)))}
          ${tabs("Environment pages", Object.entries(environmentSections).map(([name, label]) =>
            navLink(url(name), label, section === name)))}
        </div>
        ${suspended ? `<div class="notice environment-banner"><p>Paused in the demo. The checks shown are from before the pause.</p>${link(lifecyclePath(team.slug, instance.slug), "Open resume options", "button secondary")}</div>`
          : instance.lifecycle === "resumed" ? '<p class="notice">Restarted in the demo. This environment needs a new check.</p>' : ""}
        ${canManage(team) ? "" : '<p class="muted">A team owner can change this environment.</p>'}
        <p id="environment-notice" class="notice env-notice" role="status" tabindex="-1">${escape(session.notice)}</p>
        ${views[section]()}
      </div>`;
  }

  function connect(root) {
    const view = root.querySelector("#environment-view");
    if (!view) return;
    const { url, session, section, editable, team, instance, run } = current;
    const record = (kind, label, detail, href = url(section), at) => recordActivity(team, {
      kind, label, detail: `${instance.name} · ${run.label}${detail ? ` · ${detail}` : ""}`, href, at,
    });
    session.notice = "";
    const update = (message, focusId = "environment-notice") => {
      session.notice = message;
      go(url(section), { replace: true, focus: false });
      document.getElementById(focusId)?.focus();
    };
    view.addEventListener("click", async event => {
      const control = event.target.closest("[data-env-action]");
      if (!control) return;
      const { envAction, value } = control.dataset;
      if (envAction === "copy-record") {
        const notice = control.closest(".env-dns").querySelector("[role=status]");
        try {
          await navigator.clipboard.writeText(value);
          notice.textContent = `${control.textContent.replace("Copy ", "")} copied.`;
        } catch {
          notice.textContent = "Clipboard unavailable. Select the record text to copy it.";
        }
        return;
      }
      if (!editable) return;
      if (envAction === "review-deploy") view.querySelector("dialog").showModal();
      if (envAction === "cancel-deploy") view.querySelector("dialog").close();
      if (envAction === "deploy") {
        const id = `demo-${session.requests.length + 1}`;
        const at = new Date().toISOString();
        const href = url("deployments", id);
        session.requests.unshift({ id, at });
        record("deployment", `${run.label} redeploy requested`, run.commit, href, at);
        go(href);
      }
      if (envAction === "set-secret") {
        const count = (session.deliveries.get(value) ?? 0) + 1;
        session.deliveries.set(value, count);
        const row = control.closest(".secret-row");
        row.querySelector("[data-secret-presence]").innerHTML =
          `${badge("Set · Demo", "success")}${badge("App still needs a check")}`;
        row.querySelector("[role=status]").textContent = secretFeedback(count);
        control.textContent = "Replace in demo";
        control.setAttribute("aria-label", `Replace in demo ${value}`);
        record("configuration", count === 1 ? "Password or key set" : "Password or key replaced", value);
        return;
      }
      if (envAction === "discard-issuer") {
        session.issuerDraft = null;
        update("Proposed sign-in change discarded.");
      }
      const domain = session.domains.find(item => item.host === value);
      if (domain && envAction === "check-domain" && domainChecks[domain.stage]) {
        const message = domainFeedback[domain.stage];
        domain.stage += 1;
        record("domain", ["DNS verified", "Certificate issued", "HTTPS verified"][domain.stage - 1], domain.host);
        update(message, `domain-${domain.host}`);
      }
      if (domain && envAction === "remove-domain") {
        session.domains = session.domains.filter(item => item !== domain);
        record("domain", "Domain removed", domain.host);
        update("Demo domain removed.");
      }
    });

    view.addEventListener("submit", event => {
      const form = event.target;
      if (!form.matches("[data-env-form]")) return;
      event.preventDefault();
      if (!editable) return;
      const data = new FormData(form);
      const error = form.querySelector(".form-error");
      if (form.dataset.envForm === "issuer") {
        const issuer = data.get("issuer").trim();
        const candidate = URL.parse(issuer);
        if (candidate?.protocol !== "https:" || candidate.username || candidate.password || candidate.search || candidate.hash) {
          error.textContent = "Enter your provider URL starting with https://. Leave out any username, password, or text after ? or #.";
          return;
        }
        session.issuerDraft = issuer;
        record("configuration", "Sign-in provider change proposed");
        update("Proposed sign-in change ready for review.", "issuer-url");
        return;
      }
      const host = data.get("host").trim().toLowerCase().replace(/\.$/, "");
      const service = data.get("service");
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(host) || !Object.hasOwn(services, service)) {
        error.textContent = "Enter a domain name like app.example.test and choose where it should go.";
        return;
      }
      const existing = Object.values(deploymentSnapshots).some(run => Object.values(run.hosts).includes(host)) ||
        [...sessions.values()].some(item => item.domains.some(domain => domain.host === host));
      if (existing) {
        error.textContent = "This domain name is already listed. Choose another one.";
        return;
      }
      session.domains.push({ host, service, stage: 0 });
      record("domain", "Domain added", host);
      update("Demo domain added. Review its DNS records to continue.", `domain-${host}`);
    });
  }

  return { list, page, connect, clear: () => sessions.clear() };
}
