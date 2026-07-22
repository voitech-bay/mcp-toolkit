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
- **Sync**: pulls fresh data in from GetSales.
- **Launch**: upload a list of companies and start research on them.
- **n8n results**: the raw output of every research run, in case you need to check the details.
- **Email Studio**: where you review and approve email drafts.
- **Sequence Studio**: where you review a contact's full sequence (email, LinkedIn, InMail) in one place.
- **How-to Guide**: this page.

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
6. **Watch for replies.** Replies show up in Conversations, whether they came in by email or LinkedIn.
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

### Sync
Pulls the latest data (contacts, tags, connection status) in from GetSales. Run this if something looks out of date, for example a contact you know accepted a LinkedIn invite still shows as not connected.

### Launch
Use this to research a whole batch of companies at once instead of one at a time from a company card. You paste or upload a CSV with a company name and domain per row, the app shows you a preview so you can catch mistakes before anything runs, and you click Launch. If a company was already researched recently, the app flags it and asks whether you really want to spend the credits to research it again.

### n8n results
Every research run leaves a record here: what ran, when, how many companies and contacts it covered, and whether anything failed. Use this page when you need to double check exactly what a research run produced, or to see the raw research output for a specific company.

### Email Studio
Where email drafts live. Each draft has a status such as needs review, comments made, final check, or approved. Open a draft to read it, generate or regenerate it with the AI, leave comments on specific lines, and mark comments as resolved once addressed. You can only approve a draft once every comment on it is resolved. Approving does not send the email. Sending happens through Smartlead, and this app only learns "sent" happened once Smartlead confirms it.

### Sequence Studio
Shows a contact's full sequence (email, LinkedIn message, InMail) side by side, along with the research facts (POV) the drafts were built from. From here you can mark which research facts should be prioritized, open a draft in Email Studio for detailed editing, and once a LinkedIn or InMail draft is approved, push it to GetSales so GetSales can send it.
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
Open **Conversations**. Threads that need attention are flagged. Open the thread, read the message, and draft your reply. For LinkedIn accept notifications and other automated follow ups, the app may already have started a reply draft for you to review in Email Studio.

### Check how the campaign is doing
Open **Analytics** (visible in the admin menu; ask an admin if you cannot see it) for connection, reply, and pipeline numbers across the whole campaign.
`,
  },
  {
    id: "rules-and-gotchas",
    title: "Rules and gotchas",
    markdown: `
- **Research must be fresh before messages can be generated.** If research is missing or old, the app blocks message generation for that contact until you research them again.
- **You cannot approve a draft while it has open comments.** Resolve every comment first.
- **Only Smartlead can mark an email "sent."** Nobody in this app clicks a send button for email. If a status still says approved and not sent, that is expected until Smartlead's own send goes out and reports back.
- **LinkedIn and InMail drafts must be approved before they can be pushed to GetSales.** The push action will refuse otherwise.
- **Email bodies leave this app through Smartlead, not through a button here.** Once approved, they are picked up by Smartlead on its own schedule.
- **The status tag on a company card only tracks a run you launched from that card.** If you navigate away and come back, or if research was launched from the Launch page instead, check **n8n results** for its status.
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
- **Campaign**: the group of contacts and messages Smartlead or GetSales is actively sending for.
- **Smartlead**: the outside tool that sends approved emails and reports back when they go out.
- **GetSales**: the outside tool that sends LinkedIn messages and InMail, and that the app pulls connection and reply status from.
- **Launch run**: one research or messaging job you started, whether for one contact or a whole batch.
`,
  },
];
