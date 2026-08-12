import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabase } from "../services/supabase.js";

const PROJECT_ID = process.env.WELLORE_PROJECT_ID?.trim() || "0038d0db-aab2-40f1-9f6e-38d38e157f8f";
const HERE = dirname(fileURLToPath(import.meta.url));
const AI_TOOLKIT = process.env.AI_TOOLKIT_ROOT?.trim() || join(HERE, "../../../ai-toolkit");
const CANONICAL = join(AI_TOOLKIT, "projects/Wellore/context/canonical");

function readCanonical(name: string): string {
  const path = join(CANONICAL, name);
  if (!existsSync(path)) throw new Error(`Missing canonical digest: ${path}`);
  return readFileSync(path, "utf8").trim();
}

const documents = [
  {
    kind: "forbidden_claims",
    title: "Locked voice rules and anti-patterns",
    priority: 1,
    source_path: ".cursor/skills/wellore-email-copywriting/SKILL.md",
    content: `Locked rules for Wellore 3-touch cold email sequences. Canonical pack: projects/Wellore/context/MESSAGING-FOR-AGENTS.md. Violating any of these is a hard fail.

1. Never restate the subject-line game title as the opening of the body — the reader already saw it in the subject. Lead with the observation instead.
2. Greetings: E1 = "Hi Name,". E2/E3 = "Name," (no "Hi").
3. Word caps (hard): E1 under 70 words, E2 at most 60, E3 at most 50.
4. Casual lowercase tone — short, direct, no fluff. Always write "Awesomepiece" (never all-caps).
5. Prefer "pre reg" over "pre-reg". No em dashes in send copy.
6. No "about" before a number — write "35%", "140", not "about 35%".
7. No Oxford comma before "and" in lists (write "A, B and C").
8. Don't invent a prospect problem and state it as fact ("you still need X" / "still needs X"). Prefer "still cooking...", "can stack...", or "if GP art is still open...".
9. Don't imply the prospect has the case-study company's problem. The case is proof of Wellore's work only — never "studios like you" or "stuck just like you".
10. Plain / gamer language. Ban SaaS mush and AI-slop: "slate", "capacity", "art capacity", "cadence", "lane", "lanes", "overflow", "production queue", "own the calendar", "bandwidth", "creative bar", fluff "pipeline", "crunch", "slip", "lock down", plus consultant abstractions "map", "land", "stretch", "keep landing", "modular handoff", "combat fantasy". Prefer "catalog"/"titles"/named games, "outside art help", "updates kept landing", "both in one pass" / "that work".
11. E2 has research signal + production implication + a different proof dimension than E1, soft note only, no offer. Ban dead "already ships X next to Y" with no so-what.
12. E3: adjacent expertise + intro/CEO close. Prefer "cool to intro eng if packing sits with them?" and "open to 20 min with our CEO?" — ban "happy for an intro" and "worth 20 minutes with our CEO". Don't reuse that contact's E1/E2 case companies in the E3 close. Large-studio exception: when the contact's own company is itself a large studio or publisher, naming Wellore's real AAA partnerships/credits is allowed where relevant. Still never invent discipline-level work claims on those IPs.
13. Ban AI-ish filler: "split", "cleanly", "quietly", "the call is", "useful talk", "intro works".
14. One close per email — never stack two CTAs.
15. Never fabricate proof. Max ~2 related facts per proof paragraph.
16. Mobile upcoming cohort: only Battle Legion, Cat Snack Bar, ScourgeBringer Mobile, King God Castle, West Escape — with live Google Play install buckets.
17. Same-company full-body spin: opener, ask, proof wording, and CTA must all differ across co-workers.

Anti-patterns corrected 2026-08-12:
- "slate" / "mobile slate" / "puzzle slate" — Fix: catalog, titles, or name the games.
- "external art capacity" / "art capacity" — Fix: outside art help / hands.
- "update cadence held" — Fix: updates kept landing.
- "we cover both lanes" / "that lane sits elsewhere" — Fix: both in one pass / packing sits with them.
- "still needs station kits" — Fix: kits can stack / still cooking.
- "happy for an intro" / "worth 20 minutes with our CEO" — Fix: cool to intro eng... / open to 20 min with our CEO?
- "own the calendar" / "production queue" — Fix: already locked / still cooking.
- "Hi X, Cozy Cat Tree is already..." — restates the subject. Fix: drop the title, lead with the observation.
- E3 name-dropping Tencent/G5/Activision to a small/indie studio — Fix: portfolio case studios only (AAA OK only for large studio/publisher prospects).`,
  },
  {
    kind: "messaging_style",
    title: "3-touch sequence shape and format rules",
    priority: 10,
    source_path: ".cursor/skills/wellore-email-copywriting/SKILL.md",
    content: `Wellore writes 3-touch cold email sequences for game studio outreach (art/dev outsourcing).

Sequence shape:
- E1: lived observation / stage-diagnostic ask, plus one named Wellore case, plus a concrete CTA. Carries the first offer.
- E2: a different verified research signal, a different proof dimension than E1, soft note only. No offer.
- E3: an adjacent Wellore capability, an intro ask, and a CEO close naming portfolio clients. Carries the second and final offer.

Subjects: E1 = the exact upcoming game title only, 2-4 words. E2/E3 = short internal-sounding labels, not the same title again unless intentional.

Stage-diagnostic vocabulary (use this, not invented terms): announcement -> in_production -> playable_build -> pre_release. This is the ladder used to ask where a studio's upcoming title actually is, e.g. "still producing art for new worlds, or already packing it into playtests?".

Word caps are hard limits, count after every edit: E1 under 70 words, E2 at most 60, E3 at most 50.

Tone: casual lowercase body copy. Preserve proper product/platform casing where it matters (App Store, Google Play).`,
  },
  {
    kind: "product_truth",
    title: "Wellore service catalog and expertise by stage",
    priority: 15,
    source_path: "projects/Wellore/context/Wellore_Услуги_по_этапам_ПОЛНЫЙ.pdf, Wellore_Проблемы_по_этапам.pdf",
    content: `Wellore Limited (Hong Kong): 14+ years in game development, outsourcing, and startup acceleration. Full-cycle development on Unity and Unreal, or targeted team augmentation on any single part of the pipeline, from prototype to LiveOps.

Real AAA publisher partnerships: Tencent, Activision/Blizzard, THQ Nordic, G5. Real portfolio IP credits: Call of Duty, Battlefield 2042, Diablo series, SEI (credited generally, no discipline-level detail known — never invent specifics like "we did character art on Battlefield 2042"). Default proof in outreach copy is the 10 cleared portfolio cases. Naming these AAA partnerships/credits is allowed, and can land better than a portfolio case, specifically when the contact's own company is itself a large studio or publisher — matched-scale proof reads as credible to that audience. For a small or indie studio contact, keep using the 10 cleared cases only, not these names.

Wellore's own 6-stage delivery lifecycle (distinct from the announcement/in_production/playable_build/pre_release prospect-stage ladder used for diagnostic questions) with the core pain each stage closes:

1. Idea & Concept (Discovery & Concept) — pain: has an idea, no expertise to build it out. Wellore delivers: genre/tech-stack consulting, competitor and reference analysis, complexity/timeline/budget estimation, architecture and tech docs, onboarding and customer-journey design, brainstorms/hackathons with the client team, a promo teaser for pitch decks.
2. Prototype & Vertical Slice — pain: investors need a live MVP fast. Wellore delivers: interactive core-loop prototyping in Unity/Unreal, a vertical slice of the key scenario at target quality, an end-to-end working MVP, meta-system and economy design, concept art / UI-UX / first 3D content, content pipeline setup (assets, localization, configs).
3. Production — pain: a complex feature is needed and the team is afraid to break the project. Wellore delivers: full-cycle Unity/Unreal development, isolated feature/subsystem builds that don't touch core code, meta-logic and event-driven/live-update architecture, business logic, 3D art (characters, environments, props, VFX, animation), cinematics and promo content, gamification, Web3 when needed (wallets, smart contracts, tokenomics), AI-assisted tooling, CI/CD setup.
4. Stabilization / Alpha-Beta -> Release-ready — pain: release is a month out and the code is raw. Wellore delivers: stabilization of crashes/leaks, CPU/GPU/memory/network/IO performance optimization, backend profiling, bugfix and regression testing, full technical audit and code review, architecture and tech-debt analysis, security review (static analysis, pentest, data protection), scalability/stress/soak testing, UI/UX polish, milestone prep for alpha/beta/release/security audit.
5. Release & Porting — pain: needs to ship on a new platform without losing quality. Wellore delivers: desktop/mobile/web ports, platform-specific optimization (storage, API, permissions), cross-platform data sync and offline mode, platform service integration (sharing, notifications, biometrics), App Store/Google Play/Enterprise store checklist passage, input adaptation (mouse, touch, gamepad, voice), store promo content and trailers.
6. LiveOps & post-release support — pain: users are leaving after launch. Wellore delivers: live-event planning, regular balance/feature/bugfix updates, hotfixes without a client rebuild, feature flags and canary releases, push/in-game messaging, analytics (events, funnels, cohorts, retention), monetization/UX A/B testing, payment gateway integration and fraud protection, retention-campaign automation, uptime/SLO monitoring, business dashboards and reporting.

Any-stage services (not tied to one lifecycle step): project rescue (reanimating an abandoned project to release), independent technical audit and code review, building a complex feature as an isolated module, monetization/economy/analytics work, a Web3 layer, and straight team augmentation on any part of the pipeline.

Mobile expertise (Google Play), demonstrated by the 5 mobile portfolio cases specifically: LiveOps systems (seasonal events, Battle Pass, quest systems, Remote Config, Firebase Analytics), mobile-specific optimization (touch control adaptation, UI redesign, mid-range device performance, memory/load-time tuning), and monetization (ad SDK integration, IAP, F2P progression). This is real, verified expertise, not just PC/Steam work.`,
  },
  {
    kind: "proof_points",
    title: "10 cleared portfolio cases",
    priority: 20,
    source_path: "projects/Wellore/context/Wellore Portfolio Cases - All 10.md",
    content: `Only these 10 named cases are cleared for use in cold email copy (5 Aug founder mapping). Never invent metrics or deliverables beyond what's listed here; never confuse a prospect's own research dossier with a Wellore case.

PC/Steam cases:
1. PixelNAUTS - Lost Nova. Joined after vertical slice approval, needed to scale production. Team: 5 specialists, 6 months (Tech Lead, Unity Dev x2, 3D Environment Artist, Technical Artist/QA). Took ~35% of world-production tasks, ~140 environment assets, 18 interactive mechanics. Result: closed ~35% of world production, accelerated new-zone production by ~30%, internal team focused on core gameplay/UX/release prep.
2. Pine Studio - Escape Simulator. Joined after first playable, scaling room/content quantity. Team: 6 specialists, 8 months (Producer, Unity Dev x2, Level Designer, 3D Environment Artist, QA). Produced 220+ assets, 25+ game rooms. Result: accelerated new content release via parallel production, internal team focused on core mechanics/platform/UX.
3. RedDeer.Games - Tell Me Your Story. Joined after visual-direction approval, active content population. Team: 4 specialists, 4 months (Producer, 3D Artist x2, Unity Dev/QA). ~180 game objects/environment elements. Result: accelerated scene prep, reduced dev workload, team focused on mechanics and polish.
4. Raptor Claw - Captain Bones. Joined after vertical slice, moving to open-world zone expansion. Team: 5 specialists, 5 months (Producer, Unreal Dev, 3D Environment Artist x2, Technical Artist). ~200 assets, built a modular environment system for faster level assembly. Result: accelerated new-zone creation, team focused on AI/combat/balance.
5. Pandaria Games - Zombie Rollerz: Pinball Heroes. Joined after core prototype, preparing content/updates. Team: 4 specialists, 4 months (Producer, Unity Dev, 3D Artist, QA). ~160 assets. Result: stable content-release pipeline, accelerated update prep, team focused on systems/balance/LiveOps.

Mobile/Google Play cases:
6. Traplight - Battle Legion. Joined after soft launch with good retention, scaling content and LiveOps. Team: 6 specialists, 7 months (Producer, Unity Dev x2, Backend Dev, Technical Artist, QA). Built seasonal event system, Battle Pass, daily/weekly quests, ~15 new LiveOps mechanics, Firebase Analytics + Remote Config. Result: 10+ major updates released, content-prep cycle down ~35%, team focused on core gameplay/economy.
7. TREEPLLA - Cat Snack Bar. Joined after global launch, scaling content and mechanics. Team: 5 specialists, 5 months (Producer, Unity Dev, Gameplay Programmer, 3D Artist, QA). 180+ assets, new game stations/interactive elements. Result: new-content production up ~40%, reduced dev workload, team focused on economy/balance/LiveOps.
8. Flying Oak Games / Playdigious - ScourgeBringer Mobile. Joined when mobile port began, PC content already existed. Team: 6 specialists, 6 months (Producer, Unity Dev x2, Technical Artist, UI/UX Designer, QA). Adapted interfaces for touch, implemented mobile controls, optimized 200+ assets, mid-range device performance tuning. Result: mobile version adapted successfully, original game experience quality maintained, performance optimized for target device range.
9. AWESOMEPIECE - King God Castle. Joined after global release, active updates/seasonal content. Team: 6 specialists, 6 months (Producer, Unity Dev x2, Gameplay Programmer, Technical Artist, QA). Seasonal event system, multiple temporary game modes, ~20 new configs, Firebase Analytics + Remote Config. Result: 12+ major content updates, new-event prep time down ~40%, stable LiveOps pipeline.
10. Estoty - West Escape. Joined after soft launch with good retention, scaling globally. Team: 5 specialists, 5 months (Producer, Unity Dev, Gameplay Programmer, 3D Artist, QA). 170+ assets, modular location-assembly system, ad monetization/IAP integration support. Result: new-content production up ~35%, significantly reduced update-prep time, stable update/event process.`,
  },
  {
    kind: "examples",
    title: "Gold email examples",
    priority: 35,
    source_path: ".cursor/skills/wellore-email-copywriting/examples.md",
    content: `Use as shape references only — metrics must match MESSAGING-FOR-AGENTS pack / cleared portfolio cases. Prefer "Awesomepiece" not all-caps.

E1 Art Director gold. Subject: "Blast Voyage".
"Hi Patrick, saw your new match 3 cooking on GP

curious if board art, tile kits and event VFX are still on your plate, or soft launch builds are already locked?

on King God Castle for Awesomepiece (5M+ gp installs) we built seasonal events, temp game modes and special missions. event prep time down 40%

reply loot for a deeper rundown, or 'skip' to disappear ;)"
Why it works: title only in subject; stage fork; mobile case + gp installs; slang CTA; no slate/capacity.

E1 CEO kits fork. Subject: "Transport Tycoon Manager".
"Hi Ales, saw you guys cooking a fresh transport tycoon for GP

curious if you are still cranking station and vehicle kits, or already poking at store builds?

on West Escape for Estoty (5M+ gp installs) we made 170+ assets and modular locations. new content came 35% faster

just reply 'buff' if you want the one pager, or 'nerf' if you want me to leave you alone ;)"

E2 — signal with implication, no offer. Subject: "station kits".
"Ales, a fresh transport tycoon in pre reg sits next to titles you already ship, so station and vehicle kits can stack on live work

on West Escape for Estoty (5M+ gp installs) we also stood up exploration and progression loops with daily rewards so updates kept landing"
Why it works: so-what (kits stack); no "slate" / "still needs" / "cadence".

E3 — adjacent + preferred closes. Subject: "art to packing".
"Leïla, next to art drops we also plug into Unity packing and mid range performance

cool to intro eng if packing sits with them? our CEO can share Traplight, Estoty and Flying Oak"

CEO-buyer variant:
"Ales, when station kits and Unity wiring need to move together we can take both in one pass

open to 20 min with our CEO? he can share how we ran production with Traplight, Flying Oak and TREEPLLA"

Bad -> good:
- "slate" / "mobile slate" -> catalog / titles / name the games
- "external art capacity" -> outside art help
- "update cadence held" -> updates kept landing
- "we cover both lanes" -> we can take both in one pass
- "still needs shop layouts" -> still cooking shop layouts
- "happy for an intro if that lane sits elsewhere" -> cool to intro eng if packing sits with them?
- "worth 20 minutes with our CEO?" -> open to 20 min with our CEO?
- "Hi JeongHyun, Cozy Cat Tree is already installing..." -> drop title; lead with observation
- CEO close with Tencent/G5/Activision to a small/indie studio -> Traplight/Estoty/Flying Oak (AAA only when prospect is itself large)`,
  },
  {
    kind: "icp_angle_framework",
    title: "E3 adjacent capability by contact specialty",
    priority: 40,
    source_path: ".cursor/skills/wellore-email-copywriting/SKILL.md",
    content: `E3 must name one Wellore capability adjacent to (not inside) the contact's own specialty, then ask for an intro to whoever owns that adjacent work. Prefer "cool to intro eng if packing sits with them?" — never "happy for an intro" and never agency "lane/lanes" jargon. CEO close defaults to portfolio clients with "open to 20 min with our CEO?" (not "worth 20 minutes..."). When the contact's own company is itself a large studio/publisher, naming Wellore's real AAA partnerships/credits is allowed instead, without inventing discipline-level claims.

By contact specialty:
- art / creative -> adjacent: Unity/Unreal integration, packing, performance -> intro to engineering
- production -> adjacent: art production + engine integration -> intro to art or engineering
- technical -> adjacent: art/VFX volume, modular kits -> intro to art/content
- economic buyer -> adjacent: art + engineering under one partner -> intro to whoever owns packing/art
- marketing fallback -> adjacent: art production + LiveOps content -> intro to art or production

CTA patterns that work:
- E1 slang yes/no (buff/nerf, loot/skip, gg/ff)
- Conditional: "if GP art is still open beside App Store, happy to help on production volume"
- Soft E2: signal + proof only (no offer)

CTA patterns to avoid:
- "slate", "capacity", "cadence", "lane", "still needs"
- "what if we map ..." / "without stretching art"
- "you still need ..." as fact`,
  },
  {
    kind: "icp_angle_framework",
    title: "ICP and hard filters",
    priority: 25,
    source_path: "projects/Wellore/context/canonical/icp-and-filters.md",
    content: readCanonical("icp-and-filters.md"),
  },
  {
    kind: "product_truth",
    title: "Pains and buying signals",
    priority: 18,
    source_path: "projects/Wellore/context/canonical/pains-and-signals.md",
    content: readCanonical("pains-and-signals.md"),
  },
  {
    kind: "proof_points",
    title: "Narrative cases for outreach",
    priority: 22,
    source_path: "projects/Wellore/context/canonical/narrative-cases-for-outreach.md",
    content: readCanonical("narrative-cases-for-outreach.md"),
  },
  {
    kind: "meeting_summary",
    title: "Founder meeting decisions",
    priority: 28,
    source_path: "projects/Wellore/context/canonical/meeting-summaries.md",
    content: readCanonical("meeting-summaries.md"),
  },
];

const GTM_CONTEXT = {
  core_concept: `Wellore Limited (Hong Kong): 14+ years in game development, outsourcing, and startup acceleration. Full-cycle Unity/Unreal or targeted augmentation (prototype, art, features, optimization, ports, LiveOps). Tagline: Your Vision, Our Expertise.`,
  icp_description: readCanonical("icp-and-filters.md"),
  pains_and_signals: readCanonical("pains-and-signals.md"),
  expertise_and_differentiators: `Six-stage delivery (concept → LiveOps) plus any-stage rescue, audit, modular features, monetization/analytics, Web3, and team augmentation. Mobile LiveOps/monetization expertise demonstrated in cleared mobile portfolio cases. One messaging ruleset across all list segments.`,
  proof_and_customer_cases: `${readCanonical("narrative-cases-for-outreach.md")}\n\n---\nAlso use the active knowledge doc "10 cleared portfolio cases" for named metrics in cold email.`,
  objections_and_competitors: `Do not open with historical "we worked together" on old logos (landmine). Investment/analytics advisory is paused for cold packaging. Individual non-industry buyers are high margin but nearly unfindable on LinkedIn — not wave-1. Godot micro-runners are weak fit.`,
  exclusions: `RU + UA out. Company size >250 out. China, LatAm, Africa, India out; US on hold for v1. Wishlists ignored in v1. Publishers only via separate publisher_partner lane. Do not invent prospect problems or discipline-level AAA credits.`,
};

async function main(): Promise<void> {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured");
  const project = await client.from("Projects").select("id,name").eq("id", PROJECT_ID).single();
  if (project.error || project.data?.name !== "Wellore") throw new Error("Wellore project validation failed");

  let upgraded = 0;
  for (const d of documents) {
    const checksum = createHash("sha256").update(d.content).digest("hex");
    const latest = await client.from("project_knowledge_documents").select("version").eq("project_id", PROJECT_ID).eq("kind", d.kind).eq("title", d.title).order("version", { ascending: false }).limit(1).maybeSingle();
    const active = await client.from("project_knowledge_documents").select("id,source_checksum").eq("project_id", PROJECT_ID).eq("kind", d.kind).eq("title", d.title).eq("status", "active").maybeSingle();
    if (active.data?.source_checksum === checksum) continue;
    await client.from("project_knowledge_documents").update({ status: "archived", updated_at: new Date().toISOString() }).eq("project_id", PROJECT_ID).eq("kind", d.kind).eq("title", d.title).eq("status", "active");
    const ins = await client.from("project_knowledge_documents").insert({ project_id: PROJECT_ID, kind: d.kind, title: d.title, version: Number(latest.data?.version ?? 0) + 1, content_markdown: d.content, priority: d.priority, status: "active", source_path: d.source_path, source_checksum: checksum });
    if (ins.error) throw new Error(ins.error.message);
    upgraded += 1;
  }

  const gtm = await client.from("project_gtm_contexts").upsert(
    {
      project_id: PROJECT_ID,
      ...GTM_CONTEXT,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  ).select("project_id,updated_at").single();
  if (gtm.error) throw new Error(`project_gtm_contexts upsert failed: ${gtm.error.message}`);

  const configured = await client.from("project_outreach_settings").update({ updated_at: new Date().toISOString() }).eq("project_id", PROJECT_ID);
  if (configured.error) throw new Error(configured.error.message);
  console.log(`Wellore outreach knowledge: ${documents.length} documents checked, ${upgraded} upgraded to a new active version.`);
  console.log(`Wellore project_gtm_contexts upserted at ${gtm.data?.updated_at ?? "unknown"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
