/**
 * One-shot / CLI reconcile of Smartlead SENT history into outreach_emails.
 *
 * Usage:
 *   SMARTLEAD_API_KEY=… npx tsx src/scripts/reconcile-smartlead-lead.ts \
 *     --project-id=… --campaign-id=3585682 --lead-id=4111518004 \
 *     [--recipient=abarnett@venturelogistics.com] [--batch-name='Smartlead history - CFO']
 */
import "dotenv/config";
import { reconcileSmartleadLead } from "../services/smartlead-reconcile.js";

function arg(name: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
}

const projectId = arg("project-id");
const campaignId = arg("campaign-id");
const leadId = arg("lead-id");
const recipientEmail = arg("recipient") || undefined;
const batchName = arg("batch-name") || undefined;
const contactId = arg("contact-id") || undefined;

if (!projectId || !campaignId || !leadId) {
  console.error(
    "Required: --project-id= --campaign-id= --lead-id=  Optional: --recipient= --batch-name= --contact-id="
  );
  process.exit(1);
}

const result = await reconcileSmartleadLead({
  projectId,
  campaignId,
  leadId,
  recipientEmail,
  batchName,
  contactId,
});
console.log(JSON.stringify(result, null, 2));
