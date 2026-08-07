import "dotenv/config";
import { createHash } from "node:crypto";
import { getSupabase } from "../services/supabase.js";

const PROJECT_ID = process.env.WELLORE_PROJECT_ID?.trim() || "0038d0db-aab2-40f1-9f6e-38d38e157f8f";

const documents = [
  {
    kind: "forbidden_claims",
    title: "Locked voice rules and anti-patterns",
    priority: 1,
    source_path: ".cursor/skills/wellore-email-copywriting/SKILL.md",
    content: `Locked rules for Wellore 3-touch cold email sequences. Violating any of these is a hard fail.

1. Never restate the subject-line game title as the opening of the body — the reader already saw it in the subject. Lead with the observation instead.
2. Greetings: E1 = "Hi Name,". E2/E3 = "Name," (no "Hi").
3. Word caps (hard): E1 under 70 words, E2 at most 60, E3 at most 50.
4. Casual lowercase tone — short, direct, no fluff.
5. No hyphens or em dashes in send copy ("pre-reg" -> "pre reg").
6. No "about" before a number — write "35%", "140", not "about 35%".
7. No X-not-Y / "not a port" style antithesis.
8. Don't invent a prospect problem and state it as fact ("you still need X"). Conditional framing is fine ("if GP art is still open...").
9. Don't imply the prospect has the case-study company's problem. The case is proof of Wellore's work only — never "studios like you" or "stuck just like you".
10. Plain language, no consultant abstractions: never use "map", "land", "stretch", "bandwidth", "creative bar", "keep landing", "modular handoff", "combat fantasy". Prefer concrete verbs ("worth exploring...").
11. E2 has research signal + a different proof dimension than E1, soft note only, no offer.
12. E3: adjacent expertise + "happy for an intro" + a CEO close naming portfolio clients by default. Don't reuse that contact's E1/E2 case companies in the E3 close. Large-studio exception (added 7 Aug): when the contact's own company is itself a large studio or publisher, naming Wellore's real AAA partnerships/credits (Tencent, Activision/Blizzard, THQ Nordic, G5, and portfolio credits Call of Duty, Battlefield 2042, Diablo series, SEI) is allowed where relevant — matched-scale proof reads as more credible to that audience than a smaller portfolio case. Still never invent discipline-level work claims on those IPs, state only that Wellore is credited/partnered. For a small or indie studio contact, keep using the 10 cleared case studies only. This exception is forward-looking; it does not change the already-locked 5-studio campaign copy (Nitro, LoadComplete, Playdigious, Gameduo, GFD Studio/CAS.AI).
13. Vary "team stayed on..." phrasing. Ban AI-ish filler: "split", "cleanly", "quietly", "the call is", "useful talk", "intro works".
14. One close per email — never stack two CTAs or a CTA plus a fallback close.
15. Never fabricate proof: don't confuse a prospect's own research dossier with a Wellore client case, and don't invent discipline-level credits on logo IPs (e.g. never claim "we did character art on Battlefield 2042" — Wellore is only known to be credited generally, with no discipline-level detail available).
16. Max ~2 related facts (cue + result) per proof paragraph — no metric salad.
17. Offer must be concrete (a readout, a plan, production support) — never "worth a chat about your pipeline".

Anti-patterns actually seen and corrected in this campaign:
- "Hi X, Cozy Cat Tree is already..." — restates the subject. Fix: drop the title, lead with the observation.
- "you still need campaign worlds..." — invented problem. Fix: "if ... still open..."
- "map content pipeline / stretch art" — abstract. Fix: "worth exploring extra art capacity..."
- "creative bar" / "keep landing" — unclear jargon. Fix: plain verbs like ship, open, overload.
- E3 name-dropping Tencent/G5/Activision to a small/indie studio contact — mismatched-scale proof. Fix: portfolio case studios only (AAA names are OK only when the contact's own company is itself a large studio/publisher).
- "pre-reg" — hyphen ban. Fix: "pre reg".`,
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
    content: `Use as shape references only — never copy a metric unless it matches the 10 cleared portfolio cases.

E1 locked model (subject title NOT restated in body). Subject: "Boltgun Boom".
"Hi Samuli, bold Warhammer campaign for mobile. still producing art for new worlds and Chaos enemies, or already packing it into playtests? we co-developed Battle Legion for Traplight after soft launch: seasonal events, Battle Pass, quest content. update cycle down 35%, team stayed on core gameplay. worth exploring extra art capacity so new worlds, enemies, and firefight VFX can ship to Google Play on time?"
Why it works: observation + stage ask; title only in subject; named case + one metric; concrete CTA.

E1 opener patterns (no title in body), by studio type:
- Adaptation/licensed: "bold Warhammer campaign for mobile. still ... or already ...?"
- Soft launch live: "already installing on Google Play in soft launch while attractions and cat variants are still stacking."
- Port studio: "you're porting after Sea of Stars on mobile. still in the touch UI and art pass, or packing google play games builds?"
- Original shooter: "looks like a from scratch mobile roguelike shooter. still building mech bosses..."
- Catalog/hypercasual: "another GFD farm defense shooter in pre reg on a cas.ai store stack..."

E2 — research signal, no offer. Subject: "app store vs play".
"Samuli, App Store lists it for 26 Aug. Google Play is still pre reg with no day yet. on Captain Bones for Raptor Claw we built 200 assets, modular environments, Unreal integration, scene optimization. are you packing Android on the same window, or is GP art and performance still open?"
Soft close only, e.g. "can send a short note on how that unfolded before speaking". If the subject is not the game title, naming the title once in the body is OK; if the subject IS the title, prefer "it" / "the listing" / studio name.

E3 — conditional need + adjacent capability + portfolio CEO close. Subject: "production partners".
"Collin, if GP art is still open beside App Store, happy to help on production volume. we also do Unreal integration and scene optimization. if packing is with engineering, happy for an intro. worth 20 minutes with our CEO? he can share how we ran production with Estoty, TREEPLLA, and PixelNAUTS"
Why it works: "if..." not "you still need"; Unreal work is adjacent for a creative-lane contact; CEO-close clients are different from this contact's E1/E2 cases.

Bad -> good:
- "Hi JeongHyun, Cozy Cat Tree is already installing..." -> "Hi JeongHyun, already installing on Google Play in soft launch while..."
- "you still need campaign worlds and Chaos VFX" -> "if GP art is still open beside App Store, happy to help on production volume"
- "what if we map how ... without stretching art?" -> "worth exploring extra art capacity so ... can ship to Google Play on time?"
- "are Android builds on the same creative bar..." -> "is Google Play art still open, or is Android locked to what you already approved for App Store?"
- CEO close with Tencent/G5/Activision sent to a small/indie studio -> CEO close with Traplight/Estoty/Flying Oak/etc. (AAA names are fine when the contact's own company is itself a large studio/publisher)`,
  },
  {
    kind: "icp_angle_framework",
    title: "E3 adjacent capability by contact lane",
    priority: 40,
    source_path: ".cursor/skills/wellore-email-copywriting/SKILL.md",
    content: `E3 must name one Wellore capability adjacent to (not inside) the contact's own lane, then ask for an intro to whoever owns that adjacent work. Never pitch only the contact's own specialty across the full sequence. CEO close defaults to portfolio clients; when the contact's own company is itself a large studio/publisher, naming Wellore's real AAA partnerships/credits (Tencent, Activision/Blizzard, THQ Nordic, G5, Call of Duty, Battlefield 2042, Diablo series, SEI) is allowed instead, without inventing discipline-level claims.

By contact lane:
- art / creative -> adjacent capability: Unity/Unreal integration, packing, performance -> intro to engineering
- production -> adjacent capability: art production + engine integration -> intro to art or engineering
- technical -> adjacent capability: art/VFX volume, modular kits -> intro to art/content
- economic buyer -> adjacent capability: art + engineering under one partner -> intro to whoever owns that lane
- marketing fallback -> adjacent capability: art production + LiveOps content -> intro to art or production

Use "happy for an intro" — never "intro works" (banned filler).

CTA patterns that work:
- "worth exploring ...?"
- "worth aligning ...?"
- Conditional: "if GP art is still open beside App Store, happy to help on production volume"
- Soft E2 close: "can send a short note on how that unfolded before speaking"

CTA patterns to avoid:
- "what if we map ..." (abstract, banned verb)
- "without stretching art/the team" (abstract)
- "you still need ..." (states an invented need as fact)`,
  },
] as const;

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

  const configured = await client.from("project_outreach_settings").update({ updated_at: new Date().toISOString() }).eq("project_id", PROJECT_ID);
  if (configured.error) throw new Error(configured.error.message);
  console.log(`Wellore outreach knowledge: ${documents.length} documents checked, ${upgraded} upgraded to a new active version.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
