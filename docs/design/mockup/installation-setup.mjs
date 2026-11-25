export function createInstallationSetup({ heading, escape, link }) {
  const demos = new Map();

  function page(team) {
    const state = demos.get(team.slug) ?? { vault: "key", railway: false, marketplace: false };
    demos.set(team.slug, state);
    const panel = (title, status, content) => `<section class="panel">
      <div class="setup-panel-heading"><h3>${title}</h3>${status ? `<span class="badge">${status}</span>` : ""}</div>
      ${content}
    </section>`;
    const action = (id, label) => `<button class="button primary" type="button" data-install-setup="${id}">${label}</button>`;
    const vaultReady = state.vault === "ready";
    const download = (label, file) =>
      `<p><a href="data:application/json,%7B%22demo%22%3Atrue%7D" download="${file}">${label}</a></p>`;
    const vaultAction = {
      key: "<p>Save the owner key first. It lets you retrieve your recovery file if you leave this page during setup.</p>" +
        action("prepare", "Create owner key"),
      prepared: download("Download owner key", "platfolio-owner-key.demo.json") + action("initialize", "Initialize OpenBao"),
      recovery: download("Download OpenBao recovery file", "platfolio-openbao-recovery.demo.json") +
        action("unlock", "I saved the recovery file. Unlock OpenBao"),
      ready: "",
    };
    const starter = `/dashboard/teams/${escape(team.slug)}/create-instance?template=starter-web&step=connections`;
    return `${heading(team, "Connections")}
      <h2>Set up Platfolio</h2>
      <p>Set up secret storage, connect Railway, then connect the marketplace to install Starter Web.</p>
      <div class="installation-setup">
        ${panel("Secret storage", vaultReady ? "Ready" : state.vault === "recovery" ? "Locked" : "Ready to set up",
          "<p>OpenBao keeps app credentials in your Railway project. Keep your recovery file private so you can unlock it after a restart.</p>" +
          vaultAction[state.vault])}
        ${panel("Railway", state.railway ? "Connected" : "Connection required", state.railway ? "" : vaultReady
          ? "<p>Review the requested access in Railway. Your authorization is stored in your OpenBao.</p>" +
            "<p>In Railway, select only the Starter Web project.</p>" + action("railway", "Connect Railway")
          : "<p>Unlock OpenBao to connect Railway.</p>")}
        ${panel("Marketplace", state.marketplace ? "Connected" : "Connection required",
          "<p>Use a one-time code from your hub team to get a saved copy of the Starter Web release.</p>" +
          (state.marketplace ? "<p>Connected. Your marketplace team can revoke access without stopping your apps.</p><p>Saved release <strong>Starter Web 0.1.0</strong></p>"
            : vaultReady ? `<form class="form" data-install-marketplace>
                <label for="demo-marketplace-code">Marketplace connection code</label>
                <input id="demo-marketplace-code" placeholder="Use the sample code demo" autocomplete="off" required pattern="demo">
                <div class="actions"><button class="button primary" type="submit">Connect marketplace</button></div>
              </form>` : "<p>Unlock OpenBao to check this connection.</p>"))}
      </div>
      <p>${link(starter, "Set up Starter Web")}</p>`;
  }

  function connect(root, team, render) {
    const state = team && demos.get(team.slug);
    if (!state) return;
    const vault = { prepare: "prepared", initialize: "recovery", unlock: "ready" };
    for (const button of root.querySelectorAll("[data-install-setup]")) {
      button.addEventListener("click", () => {
        const action = button.dataset.installSetup;
        if (action === "railway") state.railway = true;
        else state.vault = vault[action];
        render();
      });
    }
    root.querySelector("[data-install-marketplace]")?.addEventListener("submit", event => {
      event.preventDefault();
      state.marketplace = true;
      render();
    });
  }

  return { page, connect, clear: () => demos.clear() };
}
