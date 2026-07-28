export interface HowToGuideSection {
  id: string;
  title: string;
  markdown: string;
}

export const sections: HowToGuideSection[] = [
  {
    id: "start-here",
    title: "Start here",
    markdown: `
Voitech is the app you are using right now. Velvetech is the client whose outbound campaign you run inside it. When you log in as the Velvetech user, the app pins you to the Velvetech account automatically. You do not need to pick a project.

Across the top of the page you see a row of buttons. Here is what each one is for:

- **Companies**: the list of target accounts.
- **Contacts**: the list of people at those accounts.
- **Conversations**: your inbox of replies from email and LinkedIn.
- **Sync**: pulls fresh contacts, tags, and connection status in from GetSales.
- **Launch**: upload a CSV of companies and start **research** on them (dossier only). Other pipelines (proactive sequence, accept LinkedIn, draft reply) are separate — see [Which pipeline to run](#which-pipeline).
- **n8n results**: the raw output of every research or messaging run, in case you need to check the details.
- **Email Studio**: where you review and approve email drafts (and LinkedIn drafts that need human review).
- **Sequence Studio**: where you review a contact's full sequence (email, LinkedIn, InMail) in one place.
- **Plays**: short, repeatable operator recipes (for example re-engaging people who already replied).
- **How-to Guide**: this page.

The **Data Flow Diagram** linked at the top of this guide covers the research pipeline only (CSV → company brief / POV). It does not describe accepts, reply drafting, or email ↔ LinkedIn sync.

If you only remember one thing from this page, remember the order: research first, then messages, then review, then send. The next section walks through that in full.
`,
  },
  {
    id: "big-picture",
    title: "The big picture",
    markdown: `
Every account you work moves through the same seven steps.

1. **Pick an account.** Open a company from the Companies list, or open one of its contacts.
2. **Run research.** The app looks up the company and its people and builds a short brief on them (the "dossier"). Nothing gets sent until this step is done.
3. **Generate the sequence.** Once research is fresh, the app writes a draft email, a draft LinkedIn message, and a draft InMail message for each contact.
4. **Review and approve.** You read every draft, leave comments if something is wrong, and approve it once it is ready. A draft cannot be approved while it still has open comments.
5. **Send.**
   - Email goes out through **Smartlead**. You never click a "send" button in this app for email. Once your draft is approved, Smartlead picks it up and sends it on schedule. The app only finds out afterward, when Smartlead tells it the email went out.
   - LinkedIn and InMail messages go out through **GetSales**. Here you do take an action: once a draft is approved, you push it to GetSales from Sequence Studio, and GetSales runs the actual send.
6. **Watch for replies.** Replies show up in Conversations, whether they came in by email or LinkedIn. When someone **accepts** a LinkedIn connection and research for that company already exists, the app can also start an Accept LinkedIn follow-up sequence automatically — see [When someone accepts on LinkedIn](#when-someone-accepts).
7. **Check the numbers.** Analytics shows you how the campaign is performing.

The one rule that matters most: **you cannot skip research.** If you try to generate messages for a contact whose research is missing or old, the app will refuse and tell you research is needed first.
`,
  },
  {
    id: "page-by-page",
    title: "Page by page",
    markdown: `
### Companies
A searchable table of target accounts. Click a company to open its company card. You can filter by industry, employee count, or status, and search by name or website.

### Contacts
A searchable table of people. Click a contact to open their contact card. You can filter by role or search by name.

### Company card
This is where most of your work happens. Opening a company shows you:

- The company profile (industry, size, location).
- The full list of contacts at that company, with filters for reply status, connection status, and priority.
- The account's research brief (the dossier), once research has run.
- An account summary the app writes for you, covering every conversation at the account and a suggested next step.
- A **Run research** button. Click it to kick off research for every contact currently shown in the roster (or just the filtered ones, if you have filters on). While it runs, a status tag appears next to the research section: it says "Research running..." and updates on its own, then flips to "Research complete" when it finishes, or "Research failed" if something went wrong. You do not need to refresh the page or guess when it is done, just watch that tag.
- A **Sequence Studio** button at the top of the page. Click it to jump straight into Sequence Studio filtered to this company's eligible contacts.

### Conversations
Your inbox. It lists every open thread, whether it started on email or LinkedIn, with a status showing whether a thread needs your attention, has no response yet, or already got a reply. Open a thread to read the full back and forth and to draft a reply.

From a thread you can also:

- **Generate** — ask the app to draft **three** reply variants using the thread, sibling company conversations, curated notes, and research/POV. Pick one, edit or refine, then **Send via GetSales**.
- **Start reply conversation** — build richer context (company notes, hypothesis, other people at the same company and their threads), then copy that context or open it in Cursor so you can produce reply variants.

Neither of those enrolls anyone in a GetSales sequence; they only help you write the next human reply. Details: [Conversations: drafting a reply](#conversations-drafting-a-reply).

### Sync
Pulls the latest data from GetSales into Voitech: contacts, tags, and LinkedIn connection status. Run this when something looks out of date — for example a contact you know accepted a LinkedIn invite still shows as not connected, or a lead was updated in GetSales and is missing here.

This **Sync** button is not the same as the automatic email ↔ LinkedIn stop/enroll rules that run outside the app. Those are covered in [How email and LinkedIn stay in sync](#email-linkedin-sync).

### Launch
Use this to research a whole batch of companies at once instead of one at a time from a company card. You paste or upload a CSV with a company name and domain per row, the app shows you a preview so you can catch mistakes before anything runs, and you click Launch. If a company was already researched recently, the app flags it and asks whether you really want to spend the credits to research it again.

**Launch in the top nav is the CSV research page.** Other jobs (proactive sequence, full pipeline, draft reply, accept LinkedIn) are different pipelines — see [Which pipeline to run](#which-pipeline).

### n8n results
Every research or messaging run leaves a record here: what ran, when, how many companies and contacts it covered, and whether anything failed. Use this page when you need to double check exactly what a research run produced, or to see the raw research output for a specific company.

### Email Studio
Where email drafts live. Each draft has a status such as needs review, comments made, final check, or approved. Open a draft to read it, generate or regenerate it with the AI, leave comments on specific lines, and mark comments as resolved once addressed. You can only approve a draft once every comment on it is resolved. Approving does not send the email. Sending happens through Smartlead, and this app only learns "sent" happened once Smartlead confirms it.

LinkedIn drafts that need human review (for example a failed automatic critique after an accept, or a manual Draft reply) also show up here for approve-before-send.

### Sequence Studio
Shows a contact's full sequence (email, LinkedIn message, InMail) side by side, along with the research facts (POV) the drafts were built from. From here you can mark which research facts should be prioritized, open a draft in Email Studio for detailed editing, and once a LinkedIn or InMail draft is approved, push it to GetSales so GetSales can send it.

### Plays
A catalog of repeatable operator recipes. Some plays are ready to run (for example re-engaging leads who already replied); others are marked coming soon. Open a play, set its parameters, and run it when you need that pattern.
`,
  },
  {
    id: "common-tasks",
    title: "Common tasks",
    markdown: `
### Research one company
Open the company's card. Click **Run research**. Watch the status tag next to the research section until it says complete.

### Research a batch of companies
Go to **Launch**. Paste or upload your CSV of company names and domains. Check the preview for errors. Click **Launch research**.

### Know when a research run is finished
On a company card, watch the status tag next to **Run research**. It updates on its own every few seconds: running, then complete, partial, or failed. For a batch launched from the Launch page, open **n8n results** and look up the run by name or date; it shows the same status.

### Generate and approve an email
Open **Email Studio**. Find the contact (search by name, company, or subject). Open the draft. If it needs a first draft, click generate. Read it. If everything looks right and there are no open comments, click **Approve**.

### Comment on a draft and get it fixed
Open the draft in Email Studio. Highlight the piece of text you want changed, type your comment, and add it. Once you have added every comment you want, click regenerate; the AI addresses each open comment in the new draft. Read the new version, resolve the comments that were fixed, and repeat if anything is still off.

### Push a LinkedIn or InMail draft to GetSales
Open **Sequence Studio** and find the contact. Make sure the draft's status is approved (approve it first if it is not). Click the push action for that channel. GetSales takes it from there.

### Handle a reply
Open **Conversations**. Threads that need attention are flagged. Open the thread, read the message, and draft your reply (manually, with **Generate**, or with **Start reply conversation**).

If the person just **accepted** a LinkedIn connection, that is a different path from an inbox reply — see [When someone accepts on LinkedIn](#when-someone-accepts). Channel stop rules after a reply are in [How email and LinkedIn stay in sync](#email-linkedin-sync).

### Check how the campaign is doing
Open **Analytics** (visible in the admin menu; ask an admin if you cannot see it) for connection, reply, and pipeline numbers across the whole campaign.
`,
  },
  {
    id: "which-pipeline",
    title: "Which pipeline to run",
    markdown: `
Not every job is the CSV **Launch** page. These are the pipelines you will hear about:

- **Research** — builds company and contact dossiers (POV and deep research). Run from a company card (**Run research**) or from **Launch** (CSV batch). Nothing is sent.
- **Proactive sequence** — writes draft email, LinkedIn message, and InMail from **fresh** research. Review in Email Studio / Sequence Studio before anything goes out.
- **Full pipeline** — research first, then proactive messaging for the same contacts.
- **Accept LinkedIn** — after someone accepts a connection, fills the post-accept LinkedIn follow-up messages. Usually starts **automatically** when GetSales reports the accept (if research already exists). You can also launch it manually when needed.
- **Draft reply** — writes a short, research-backed LinkedIn reply for one lead. Always human-approved before send. This is **not** the same as Accept LinkedIn, and it does **not** fire on every accept by itself.

**Messaging and Accept LinkedIn both need fresh research** (company POV and deep research, roughly within the last 30 days). If research is missing or stale, the app refuses and asks you to research first.
`,
  },
  {
    id: "when-someone-accepts",
    title: "When someone accepts on LinkedIn",
    markdown: `
When a prospect accepts a LinkedIn connection request, GetSales notifies Voitech. Voitech then tries to start the **Accept LinkedIn** pipeline for that person.

For that to work:

1. The contact must already be synced into Voitech (run **Sync** if they are missing or look stale).
2. The company must already have research (POV and deep research). If research is missing, the accept run is skipped — research the company, then retry or wait for the next accept path your team uses.

What happens next:

- If the automatic copy check **passes**, the follow-up LinkedIn messages can be pushed into GetSales for the existing accept sequence.
- If the check **fails**, the draft is marked for human review (often labeled needs human). Open **Email Studio** or **Sequence Studio**, fix or approve, then push.

**Draft reply** is different: it is a separate, manual pipeline for a human-gated first DM. It does not auto-run on every accept.

The app also ignores repeat accept events for the same lead for about **seven days**, so webhook retries do not launch the same job twice.
`,
  },
  {
    id: "email-linkedin-sync",
    title: "How email and LinkedIn stay in sync",
    markdown: `
Two different things share the word "sync":

1. **Sync in Voitech** — the button that refreshes contacts and connection status from GetSales into this app.
2. **Channel automation** — background rules that keep Smartlead email and GetSales LinkedIn from talking over each other.

Channel rules operators should know:

- After the **first email** goes out, LinkedIn enrollment in GetSales is delayed on purpose (about **20 minutes**) so bounces can land first.
- A **bounce** moves the lead onto a LinkedIn-only track. Do not strip bounce tags by hand.
- A **reply on either channel** should stop the other channel's automation. Answer in the tool where the reply arrived (Smartlead for email, GetSales for LinkedIn).
- Do **not** manually enroll people into GetSales batch flows that the campaign already manages — that creates duplicate or empty message steps.

If connection status or enrollment looks wrong in Voitech, run **Sync** first. If the other channel is still sending after a reply, escalate — the stop rule may have missed the lead.
`,
  },
  {
    id: "approving-and-sending",
    title: "Approving and sending by channel",
    markdown: `
- **Email** — approve in Email Studio. Smartlead sends on its schedule. Status becomes "sent" only when Smartlead reports back. Approved is not the same as sent.
- **Proactive LinkedIn / InMail** — approve the draft, then **push from Sequence Studio** to GetSales.
- **Accept LinkedIn sequence** — may push automatically when the copy check passes. If it needs human review, fix or approve in Email Studio / Sequence Studio, then push.
- **Draft reply** — always approve before anything is sent.
- **Open comments block approve** on any draft that uses comments. Resolve them first.
`,
  },
  {
    id: "conversations-drafting-a-reply",
    title: "Conversations: drafting a reply",
    markdown: `
When someone has already written back (or you need the next message in an open thread):

1. Open **Conversations** and select the thread.
2. Read the history and any related contacts on the company card or related-contacts panel.
3. Draft the next message yourself, or use one of the helpers:

### Generate
Opens the generate popup. Choose a model and light style presets (methodology defaults to **None**), optionally type extra instructions, then generate. The app pulls this thread, **sibling company conversations**, curated company/contact notes, research, and prioritized POV facts, then returns **three** distinct variants. Pick one, edit manually and/or refine with follow-up instructions, then **Send via GetSales** from the conversation’s sender. Drafts are also saved to pending.

### Start reply conversation
Builds a fuller context pack: company context, optional hypothesis, the prospect, and conversations with **other people at the same company**. You can copy that context, or open it in Cursor to produce **three reply variants**. Use this when you want a portable context pack outside the in-app Generate flow.

**Generate** can send via GetSales after you confirm. **Start reply conversation** does not send — it only helps you draft.
`,
  },
  {
    id: "plays",
    title: "Plays",
    markdown: `
**Plays** are short recipes for jobs you repeat often (for example re-engaging leads who already replied). Open **Plays** from the top nav, pick a play, set its parameters, and run it.

- Plays marked **ready** can be run today.
- Plays marked **coming soon** are listed so you know what is planned; they are not runnable yet.

A play does not replace research, approve, or the channel sync rules above — it packages a common sequence of those steps.
`,
  },
  {
    id: "rules-and-gotchas",
    title: "Rules and gotchas",
    markdown: `
- **Research must be fresh before messages or Accept LinkedIn can run.** If research is missing or older than about 30 days, the app blocks messaging and accept launches until you research again.
- **Accept runs are skipped** when the contact is not synced into Voitech or the company has no research. Run **Sync**, then **Run research**, then retry the accept path if needed.
- **One accept launch per lead per about seven days.** Retries and duplicate webhooks in that window are ignored (failed runs do not permanently block a retry).
- **You cannot approve a draft while it has open comments.** Resolve every comment first.
- **Only Smartlead can mark an email "sent."** Nobody in this app clicks a send button for email. If a status still says approved and not sent, that is expected until Smartlead's own send goes out and reports back. Approved ≠ sent.
- **LinkedIn and InMail drafts must be approved before they can be pushed to GetSales** (except Accept LinkedIn cases that auto-push after a passing copy check).
- **Email bodies leave this app through Smartlead, not through a button here.** Once approved, they are picked up by Smartlead on its own schedule.
- **The status tag on a company card only tracks a run you launched from that card.** If you navigate away and come back, or if research was launched from the Launch page instead, check **n8n results** for its status.
- **Nav Launch is CSV research.** Do not assume it starts proactive messaging, accept sequences, or draft reply — pick the right pipeline.
`,
  },
  {
    id: "glossary",
    title: "Glossary",
    markdown: `
- **Voitech**: the app itself.
- **Velvetech**: the client account and campaign you are running inside Voitech.
- **n8n**: the automation tool running in the background that does the research and drafts the messages. You do not need to open it directly; the app surfaces everything you need.
- **POV**: point of view. The set of researched facts about a company or contact that the messages are built from.
- **Dossier**: the research brief the app builds for a company or contact.
- **Sequence**: the set of planned touches for a contact, for example an email followed by a LinkedIn message.
- **Accept LinkedIn / Accept sequence**: the post-accept LinkedIn follow-up messages filled (and sometimes auto-pushed) when someone accepts a connection and research already exists.
- **Draft reply**: a separate, always human-approved LinkedIn reply draft. Not the same as Accept LinkedIn, and not auto-fired on every accept.
- **Critique / needs human**: automatic copy check failed; a person must review or edit before send or push.
- **Sync (button)**: refreshes contacts, tags, and connection status from GetSales into Voitech.
- **Channel sync**: background rules that enroll or pause Smartlead vs GetSales so the two channels do not conflict.
- **Campaign**: the group of contacts and messages Smartlead or GetSales is actively sending for.
- **Smartlead**: the outside tool that sends approved emails and reports back when they go out.
- **GetSales**: the outside tool that sends LinkedIn messages and InMail, and that the app pulls connection and reply status from.
- **Launch run**: one research or messaging job you started, whether for one contact or a whole batch.
- **Play**: a saved operator recipe for a repeatable job (re-engage, follow-up, and so on).
`,
  },
];
