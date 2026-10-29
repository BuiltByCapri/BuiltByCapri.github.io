// Sends an inquiry from the contact form to Capri's inbox through Resend.
// The visitor's address goes in reply_to, so answering the email answers them.
// A filled-in "company_site" field is the honeypot: bots fill every field,
// people never see it, and the request is thanked without sending anything.

const LIMITS = { name: 120, email: 200, project: 4000, timeline: 120 };

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
    wantsJson ? res.status(status).json(payload) : res.redirect(303, `/${anchor}#contact`);

  if (clean(body.company_site, 200)) return done(200, { ok: true }, "?sent=1");

  const name = clean(body.name, LIMITS.name);
  const email = clean(body.email, LIMITS.email);
  const project = clean(body.project, LIMITS.project);
  const timeline = clean(body.timeline, LIMITS.timeline);

  if (!name || !project || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return done(400, { error: "Add your name, a working email and a line about the project." }, "?sent=0");
  }

  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  if (!key || !to) {
    console.error("RESEND_API_KEY or CONTACT_TO is not set.");
    return done(503, { error: "The form isn't connected right now. Email me instead." }, "?sent=0");
  }

  const text = `${name} <${email}>\n${timeline ? `Timeline: ${timeline}\n` : ""}\n${project}`;
  const html =
    `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>` +
    (timeline ? `<p>Timeline: ${escapeHtml(timeline)}</p>` : "") +
    `<p style="white-space:pre-wrap">${escapeHtml(project)}</p>`;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Built by Capri <inquiries@builtbycapri.com>",
      to: [to],
      reply_to: email,
      subject: `New inquiry from ${name}`,
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
