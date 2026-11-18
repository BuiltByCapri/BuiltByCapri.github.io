// Sends an inquiry from the contact form to Capri's inbox through Resend.
// The visitor's address goes in reply_to, so answering the email answers them.
// A filled-in "company_site" field is the honeypot: bots fill every field,
// people never see it, and the request is thanked without sending anything.

const LIMITS = { name: 120, email: 200, phone: 40, project: 4000, timeline: 120, source: 40, business: 160, stage: 60, estimate: 20, item: 200 };

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// The homepage plan builder sends its picks as short lists.
function list(value) {
  return Array.isArray(value) ? value.slice(0, 20).map((v) => clean(v, LIMITS.item)).filter(Boolean) : [];
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const body = req.body || {};
  const wantsJson = (req.headers.accept || "").includes("application/json");
  const done = (status, payload, anchor) =>
    wantsJson ? res.status(status).json(payload) : res.redirect(303, `/work/${anchor}#contact`);

  if (clean(body.company_site, 200)) return done(200, { ok: true }, "?sent=1");

  const name = clean(body.name, LIMITS.name);
  const email = clean(body.email, LIMITS.email);
  const project = clean(body.project, LIMITS.project);
  const timeline = clean(body.timeline, LIMITS.timeline);
  // The QR page takes a phone number instead of an email, since people at an event often give one.
  const phone = clean(body.phone, LIMITS.phone);
  const source = clean(body.source, LIMITS.source);
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const hasPhone = phone.replace(/\D/g, "").length >= 7;

  const business = clean(body.business, LIMITS.business);
  const stage = clean(body.stage, LIMITS.stage);
  const problems = list(body.problems);
  const services = list(body.services);
  const estimate = clean(body.estimate, LIMITS.estimate);

  if (!name || !(project || problems.length) || !(hasEmail || hasPhone)) {
    return done(400, { error: "Add your name, a working email or phone number, and a line about the project." }, "?sent=0");
  }
  const reach = [hasEmail && email, hasPhone && phone].filter(Boolean).join(" · ");

  const lines = [
    business && `Business: ${business}`,
    stage && `Stage: ${stage}`,
    problems.length && `\nWhat's going on:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    services.length && `\nRecommended:\n${services.map((s) => `- ${s}`).join("\n")}`,
    estimate && `\nEstimated starting investment: ${estimate}`,
    project && `\n${problems.length ? "Notes:\n" : ""}${project}`,
  ].filter(Boolean).join("\n");

  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  if (!key || !to) {
    console.error("RESEND_API_KEY or CONTACT_TO is not set.");
    return done(503, { error: "The form isn't connected right now. Email me instead." }, "?sent=0");
  }

  const text = `${name} <${reach}>\n${source ? `From: ${source}\n` : ""}${timeline ? `Timeline: ${timeline}\n` : ""}\n${lines}`;
  const html =
    `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(reach)}&gt;</p>` +
    (source ? `<p>From: ${escapeHtml(source)}</p>` : "") +
    (timeline ? `<p>Timeline: ${escapeHtml(timeline)}</p>` : "") +
    `<p style="white-space:pre-wrap">${escapeHtml(lines)}</p>`;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Built by Capri <inquiries@builtbycapri.com>",
      to: [to],
      ...(hasEmail ? { reply_to: email } : {}),
      subject: `${source ? `${source}: ` : ""}New inquiry from ${name}${business ? `, ${business}` : ""}${estimate ? ` (${estimate})` : ""}`,
      text,
      html,
    }),
  }).catch((err) => {
    console.error("Resend request failed:", err);
    return null;
  });

  if (!sent || !sent.ok) {
    if (sent) console.error("Resend refused the email:", sent.status, await sent.text());
    return done(502, { error: "That didn't send. Try again in a minute." }, "?sent=0");
  }
  return done(200, { ok: true }, "?sent=1");
};
