const el = (id) => document.getElementById(id);
let currentJob;
let pollTimer;

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

function selectedAccounts() {
  return Array.from(document.querySelectorAll("#agents input:checked")).map((box) => box.value);
}

async function refreshState() {
  const state = await api("/api/state");
  const checked = new Set(selectedAccounts());
  el("limits").textContent =
    `${state.accounts.length} agents · ${state.limits.maxMessagesPerAccountPerDay} messages/account/day · ` +
    `${state.limits.minSecondsBetweenMessages}s between sends · ${state.limits.maxConcurrentAgents} browsers at once`;

  el("agents").replaceChildren(
    ...state.accounts.map((account) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = account.id;
      box.checked = checked.size === 0 ? true : checked.has(account.id);
      const item = document.createElement("li");
      const text = document.createElement("div");
      text.innerHTML =
        `<div class="who">${account.id}</div>` +
        `<div class="state">${account.email}</div>` +
        `<div class="state">${account.session}</div>`;
      item.append(box, text);
      return item;
    }),
  );

  el("history-list").replaceChildren(
    ...(state.history.length === 0
      ? [Object.assign(document.createElement("li"), { textContent: "Nothing sent yet." })]
      : state.history.map((record) => {
          const item = document.createElement("li");
          item.className = "card";
          item.innerHTML =
            `<div class="state">${record.sentAt} · ${record.accountId}</div>` +
            `<a href="${record.listingUrl}" target="_blank" rel="noreferrer">${record.listingUrl}</a>` +
            `<div class="state">${record.preview}</div>`;
          return item;
        })),
  );
}

function formParams(form) {
  const params = {};
  for (const field of form.elements) {
    if (!field.name) continue;
    if (field.type === "checkbox") params[field.name] = field.checked;
    else if (field.value.trim() !== "") params[field.name] = field.value.trim();
  }
  params.accounts = selectedAccounts();
  return params;
}

async function startJob(type, params) {
  el("result").replaceChildren();
  currentJob = await api("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ type, params }),
  });
  render(currentJob);
  poll();
}

function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!currentJob) return;
    const job = await api(`/api/jobs/${currentJob.id}`);
    currentJob = job;
    render(job);
    if (job.status !== "done" && job.status !== "failed") poll();
  }, 900);
}

function render(job) {
  const status = el("job-status");
  status.textContent = `${job.label} — ${job.status}`;
  status.className = `badge ${job.status}`;

  el("console").replaceChildren(
    ...job.lines
      .filter((line) => line.level !== "debug")
      .map((line) => {
        const row = document.createElement("div");
        row.className = line.level;
        row.innerHTML = `<span class="scope">${line.at.slice(11, 19)} [${line.scope}]</span> ${escapeHtml(line.message)}`;
        return row;
      }),
  );
  el("console").scrollTop = el("console").scrollHeight;

  renderPrompt(job);
  if (job.status === "done") renderResult(job.result);
  if (job.status === "failed") {
    el("result").replaceChildren(
      Object.assign(document.createElement("div"), { className: "error", textContent: job.error }),
    );
  }
}

function renderPrompt(job) {
  const box = el("prompt");
  if (!job.prompt) {
    box.classList.add("hidden");
    box.replaceChildren();
    return;
  }
  if (box.dataset.for === `${job.id}:${job.prompt.question}`) return;
  box.dataset.for = `${job.id}:${job.prompt.question}`;
  box.classList.remove("hidden");

  const question = document.createElement("pre");
  question.textContent = job.prompt.question;
  const actions = document.createElement("div");
  actions.className = "actions";

  if (job.prompt.kind === "confirm") {
    const yes = Object.assign(document.createElement("button"), { textContent: "Approve" });
    const no = Object.assign(document.createElement("button"), {
      textContent: "Cancel",
      className: "ghost",
    });
    yes.onclick = () => answer({ approved: true });
    no.onclick = () => answer({ approved: false });
    actions.append(yes, no);
  } else {
    const input = document.createElement("input");
    input.placeholder = "code";
    const send = Object.assign(document.createElement("button"), { textContent: "Submit" });
    send.onclick = () => answer({ text: input.value });
    actions.append(input, send);
  }
  box.replaceChildren(question, actions);
}

async function answer(body) {
  el("prompt").classList.add("hidden");
  await api(`/api/jobs/${currentJob.id}/answer`, { method: "POST", body: JSON.stringify(body) });
  poll();
}

function renderResult(result) {
  const listings = collectListings(result);
  const target = el("result");
  if (listings.length > 0) {
    target.replaceChildren(
      ...listings.map((listing) => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML =
          `<span class="price">${listing.priceText || "—"}</span>${escapeHtml(listing.title)}` +
          `<div><a href="${listing.url}" target="_blank" rel="noreferrer">${listing.url}</a></div>`;
        return card;
      }),
    );
    return;
  }
  const dump = document.createElement("pre");
  dump.textContent = JSON.stringify(result, null, 2);
  target.replaceChildren(dump);
  void refreshState();
}

function collectListings(result) {
  if (!Array.isArray(result)) return [];
  const found = [];
  for (const entry of result) {
    if (Array.isArray(entry?.value)) found.push(...entry.value);
  }
  return found.filter((listing) => listing?.url && listing?.title);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.onclick = () => {
    for (const other of document.querySelectorAll(".tab")) other.classList.remove("active");
    tab.classList.add("active");
    for (const view of document.querySelectorAll(".view")) view.classList.add("hidden");
    el(tab.dataset.tab).classList.remove("hidden");
  };
}

for (const form of document.querySelectorAll("form[data-command]")) {
  form.onsubmit = (event) => {
    event.preventDefault();
    void startJob(form.dataset.command, formParams(form));
  };
}

el("agents-panel").querySelector("button[data-command='login']").onclick = () =>
  void startJob("login", { accounts: selectedAccounts() });

void refreshState();
setInterval(() => void refreshState(), 15_000);
