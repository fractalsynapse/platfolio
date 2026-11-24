const steps = [
  ["template", "Template"],
  ["connections", "Connections"],
  ["environments", "Environments"],
  ["plan", "Deployment plan"],
];
const slugPattern = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const branches = ["main", "staging", "release"];
const label = environment => environment === "production" ? "Production" : "Staging";
const formValue = (data, name) => String(data.get(name) ?? "").trim();
export const isSetupStep = value => steps.slice(1).some(([step]) => step === value);

function environmentNames(template) {
  return template.staging ? ["staging", "production"] : ["production"];
}

export function createInstanceSetup({ heading, panel, link, escape, authError, go, teamPath, createInstancePath }) {
  const drafts = new Map();
  const path = (team, template, step = "template") =>
    `${createInstancePath(team)}?template=${template.id}${step === "template" ? "" : `&step=${step}`}`;

  function draftFor(team, template) {
    const key = `${team.slug}/${template.id}`;
    if (!drafts.has(key)) drafts.set(key, { name: template.id, github: false, railway: false });
    return drafts.get(key);
  }

  function progress(team, template, current, draft = draftFor(team, template)) {
    const available = draft.environments ? 3 : draft.targets ? 2 : 1;
    return `<nav class="setup-steps" aria-label="Instance setup steps"><ol>
      ${steps.map(([step, title], index) => `<li>
        ${step === current ? `<span aria-current="step">${title}</span>`
          : index <= available ? link(path(team, template, step), title) : `<span>${title}</span>`}
      </li>`).join("")}
    </ol></nav>`;
  }

  function facts(entries) {
    return `<dl class="facts">${entries.map(([term, value]) =>
      `<div><dt>${escape(term)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
  }

  function targets(team, template) {
    const repository = `platfolio-fixtures/${template.id}`;
    return {
      github: [`${repository}-tenant`, `${repository}-sandbox`],
      railway: [`${team.slug} Railway workspace`, `${team.slug} Railway sandbox`],
    };
  }

  function connectionFields(provider, providerLabel, fieldLabel, choices, selected, connected) {
    return `<fieldset class="setup-fields" data-setup-provider="${provider}">
      <legend>${providerLabel}</legend>
      <p class="input-help" data-connection-status>${connected ? "Demo access connected." : "Demo access required."}</p>
      <button type="button" class="button secondary" data-connect="${provider}"${connected ? " hidden" : ""}>Connect ${providerLabel}</button>
      <label for="setup-${provider}">${fieldLabel}</label>
      <select id="setup-${provider}" name="${provider}" required${connected ? "" : " disabled"}>
        ${choices.map(choice => `<option value="${escape(choice)}"${selected === choice ? " selected" : ""}>${escape(choice)} (demo)</option>`).join("")}
      </select>
    </fieldset>`;
  }

  function connections(team, template, draft) {
    const demo = targets(team, template);
    return panel("Where your app will run", `<form class="form setup-form" data-instance-setup="connections">
      <p>Pick the GitHub repository that holds your app’s code and the Railway workspace your team will use to host it. Start by copying the template into your own repository.</p>
      <div class="setup-name">
        <label for="setup-instance-name">App name</label>
        <input id="setup-instance-name" name="name" value="${escape(draft.name)}" maxlength="40" pattern="[a-z0-9](?:[a-z0-9\\-]{0,38}[a-z0-9])?" required aria-describedby="setup-instance-name-help">
        <p class="input-help" id="setup-instance-name-help">Use lowercase letters, numbers, and hyphens. This becomes ${escape(team.slug)}/&lt;name&gt;.</p>
      </div>
      <div class="setup-environments">
        ${connectionFields("github", "GitHub", "GitHub repository", demo.github, draft.targets?.repository, draft.github)}
        ${connectionFields("railway", "Railway", "Railway workspace", demo.railway, draft.targets?.workspace, draft.railway)}
      </div>
      ${authError()}
      <div class="actions">
        <button class="button primary" type="submit"${draft.github && draft.railway ? "" : " disabled"}>Configure environments</button>
        ${link(path(team, template), "Back to template", "button secondary")}
      </div>
    </form>`);
  }

  function environmentFields(template, environment, previous) {
    const setting = template.setupInputs?.setting;
    const branch = previous?.branch ?? template[environment];
    const value = previous?.value ?? setting?.value;
    const branchOptions = [...new Set([branch, ...branches])];
    return `<fieldset class="setup-fields">
      <legend>${label(environment)}</legend>
      <label for="${environment}-branch">${label(environment)} GitHub branch</label>
      <select id="${environment}-branch" name="${environment}-branch">
        ${branchOptions.map(item => `<option value="${escape(item)}"${item === branch ? " selected" : ""}>${escape(item)}</option>`).join("")}
      </select>
      ${setting ? `<label for="${environment}-setting">${label(environment)} ${escape(setting.label)}</label>
        <input id="${environment}-setting" name="${environment}-setting" type="${setting.type ?? "text"}"
          value="${escape(value)}"${setting.type === "number" ? ' min="1" step="1" required' : ' maxlength="100"'}
          aria-describedby="${environment}-setting-help">
        <p class="input-help" id="${environment}-setting-help"><code>${escape(setting.name)}</code> · Non-secret setting</p>` : ""}
      <p class="input-help">${template.kind === "Worker" ? "This runs in the background and has no public web address." : "Railway provides a web address. You can use your own domain once you point it to the app."}</p>
    </fieldset>`;
  }

  function environments(team, template, draft) {
    return panel("Environment settings", `<form class="form setup-form" data-instance-setup="environments">
      <p>${template.staging ? "Use staging to test changes and production to run the version people use." : "This template runs one version in production."}</p>
      <div class="setup-environments">
        ${environmentNames(template).map(environment => environmentFields(template, environment, draft.environments?.[environment])).join("")}
      </div>
      ${authError()}
      <div class="actions"><button class="button primary" type="submit">Review deployment plan</button>
        ${link(path(team, template, "connections"), "Back to connections", "button secondary")}</div>
    </form>`);
  }

  function obligations(template) {
    const { secrets = [], references = [] } = template.setupInputs ?? {};
    const registry = `https://github.com/${template.repository}/blob/${template.commit}/environment.yaml`;
    return panel("Settings, passwords, and keys", `
      ${secrets.length ? `<p>Set these values in the locations listed before you launch the app.</p>
        ${facts(secrets)}` : ""}
      ${references.length ? `<p>Connections set up for you</p><ul>${references.map(item => `<li><code>${escape(item)}</code></li>`).join("")}</ul>` : ""}
      ${!secrets.length && !template.publisherTeam ? "<p>This template starts without any passwords or keys from your team.</p>" : ""}
      <p><a href="${escape(registry)}" target="_blank" rel="noopener">View the settings file in GitHub</a></p>`);
  }

  function plan(team, template, draft) {
    const resources = environmentNames(template).map(environment => {
      const config = draft.environments[environment];
      const setting = template.setupInputs?.setting;
      const hostname = setting?.name === "KC_HOSTNAME" && config.value;
      const ingress = hostname ? `${template.ingress} · ${hostname} needs DNS setup` : `${template.ingress} · Starts with a Railway web address`;
      return panel(label(environment), facts([
        ["Deploy branch", config.branch],
        ["Services", template.service],
        ["Data", template.resource],
        ["Public access", template.kind === "Worker" ? "No public web address" : ingress],
        ...(setting ? [[setting.name, config.value || "Template default"]] : []),
      ]), `plan-environment plan-${environment}`);
    }).join("");

    return `<div class="setup-plan">${panel("Where this app will run", `<p>This preview shows what the app needs. Setup will confirm the exact version of your code before deploying it.</p>${facts([
      ["App", `${team.slug}/${draft.name}`],
      ["Template source", `${template.repository} @ ${template.commit.slice(0, 7)}`],
      ["GitHub repository", draft.targets.repository],
      ["Railway workspace", draft.targets.workspace],
      ["Proposed Railway project", draft.name],
      ["Runs the deployment", "GitHub Actions"],
    ])}`, "plan-targets")}
    <div class="setup-environments">${resources}</div>
    ${obligations(template)}
    ${panel("Approve setup in GitHub", `<p>Setup prepares a pull request in <strong>${escape(draft.targets.repository)}</strong> so you can review the proposed hosting settings and deployment steps in GitHub.</p>
      <p>Once the changes are approved and merged, GitHub Actions can deploy the app and report the result for production or staging.</p>`)}
    <div class="actions">
      ${link(path(team, template, "connections"), "Edit connections", "button secondary")}
      ${link(path(team, template, "environments"), "Edit environments", "button secondary")}
      ${link(teamPath(team.slug), "Back to team workspace", "button secondary")}
    </div></div>`;
  }

  function page(team, template, requested) {
    const draft = draftFor(team, template);
    const current = !draft.targets ? "connections" : requested === "plan" && !draft.environments ? "environments" : requested;
    const titles = {
      connections: "Connect repository and workspace",
      environments: "Configure environments",
      plan: "Review deployment plan",
    };
    const render = { connections, environments, plan }[current];
    return `${heading(team, titles[current], current === "plan" ? "Preview only. Review the proposed changes before opening an install pull request." : template.title)}
      ${progress(team, template, current, draft)}
      ${requested !== current ? '<p class="notice">Complete this step to continue. Setup drafts reset when the mockup reloads.</p>' : ""}
      ${render(team, template, draft)}`;
  }

  function connect(root, team, template) {
    const form = root.querySelector("[data-instance-setup]");
    if (!form || !team || !template) return;
    const draft = draftFor(team, template);
    const nextButton = form.querySelector('button[type="submit"]');

    form.addEventListener("click", event => {
      const button = event.target.closest("button[data-connect]");
      if (!button) return;
      const provider = button.dataset.connect;
      draft[provider] = true;
      const field = form.elements.namedItem(provider);
      field.disabled = false;
      button.closest("fieldset").querySelector("[data-connection-status]").textContent = "Demo access connected.";
      button.hidden = true;
      nextButton.disabled = !draft.github || !draft.railway;
      field.focus();
    });

    form.addEventListener("submit", event => {
      event.preventDefault();
      const data = new FormData(form);
      const error = form.querySelector(".form-error");
      if (form.dataset.instanceSetup === "connections") {
        const name = formValue(data, "name");
        if (!draft.github || !draft.railway) return;
        if (!slugPattern.test(name) || team.instances.some(item => item.slug === name)) {
          error.textContent = "Choose an available app name with lowercase letters, numbers, and internal hyphens.";
          return;
        }
        const repository = formValue(data, "github");
        const workspace = formValue(data, "railway");
        const allowed = targets(team, template);
        if (!allowed.github.includes(repository) || !allowed.railway.includes(workspace)) {
          error.textContent = "Choose a connected repository and Railway workspace.";
          return;
        }
        draft.name = name;
        draft.targets = { repository, workspace };
        go(path(team, template, "environments"));
        return;
      }

      const configured = Object.fromEntries(environmentNames(template).map(environment => [environment, {
        branch: formValue(data, `${environment}-branch`),
        value: formValue(data, `${environment}-setting`),
      }]));
      if (configured.staging?.branch === configured.production.branch) {
        error.textContent = "Choose different deploy branches for staging and production.";
        return;
      }
      draft.environments = configured;
      go(path(team, template, "plan"));
    });
  }

  return { path, progress, page, connect, clear: () => drafts.clear() };
}
