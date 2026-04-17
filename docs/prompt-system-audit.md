# Prompt System Audit (Generate Message)

## Scope

Reviewed current prompt system in:
- `frontend/src/components/GenerateMessageModal.vue`
- `src/api-handlers.ts`
- `src/services/generated-message-prompt.ts`

Benchmarked against:
- [OpenAI Prompt Engineering Guide](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [Prompt Engineering Guide (DAIR.AI)](https://www.promptingguide.ai/)
- [Claude Prompt Engineering Overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview.md)
- [Consensus: 35+ Sales & Marketing Prompts](https://goconsensus.com/blog/35-proven-ai-sales-marketing-prompts)
- [Docket: Sales Emails That Convert](https://www.docket.io/chat-gpt-prompts-for-sales/sales-emails-that-convert)
- [Twilio: Email ChatGPT Prompts](https://www.twilio.com/en-us/blog/insights/email-chatgpt-prompts)
- [Tario: Complete Sales Prompt Guide](https://www.tario.ai/ebooks/ai-prompts-for-sales)

Primary optimization target: increase **reply rate** and **personalization relevance**.

---

## 1) Current System Inventory (What each setting really does)

### A. High-signal controls (material impact)
- `messageExamples`
  - Strongest style transfer signal; already enforced with mandatory style matching text.
- `mentionBlocks`
  - Directly controls context inclusion (conversation recap, posts, experience, company fields).
- `additionalInstructions`
  - High leverage freeform constraint channel.
- `ctaType`
  - Clear behavior target (meeting ask, intro ask, feedback ask, etc.).
- `questionCountMax`
  - Hard output shape constraint.
- `format.sentences`, `format.paragraphs`
  - Strong structural control.
- `temperature`
  - Generation entropy control.

### B. Medium-signal controls
- `methodology` (`pas`, `aida`, `bab`, `jtbd`)
- `focus` (`pain`, `neutral`, `benefits`)
- `tonePreset`, `readingLevelPreset`, `lengthPreset`

These help directionally but overlap with other controls and can conflict.

### C. Low-signal / redundant controls
- `tone`, `goal`, `ctaStyle`, `personalizationDepth`, `readingLevel`, `formality`
  - Many are derived from presets before request; they duplicate intent.
  - Current prompt includes both raw labels and explanation strings, causing verbosity/instruction collisions.

---

## 2) Benchmark Findings vs Best Practices

## Strengths
- Good explicit constraints: max questions, sentence/paragraph targets.
- Good anti-hallucination intent: “never invent facts.”
- Good use of examples as few-shot style anchors.
- Decent context segmentation (conversation/contact/company).

## Gaps hurting reply rate and personalization

1. **Instruction overload + overlap**
- Multiple labels for similar concepts (tone + tonePreset, readingLevel + readingLevelPreset, etc.).
- Increases ambiguity and dilutes priority, contrary to “clear, minimal, testable instructions”.

2. **No explicit single success objective in prompt**
- Prompt lists many stylistic requirements but not one ranked optimization objective (e.g., “maximize probability of reply with low-friction CTA”).

3. **No precedence contract**
- If examples conflict with constraints, system does not explicitly define which wins.

4. **Context quality not ranked**
- All selected context is passed nearly flat.
- Sales frameworks favor relevance-ranked evidence (recent trigger > evergreen profile detail).

5. **Output contract too loose**
- “about X sentences” and “exactly Y paragraphs” mixed strictness.
- No post-generation compliance scoring before save.

6. **No automatic safety checks for weak personalization**
- Missing validation for generic phrasing (“just checking in”, empty personalization tokens, non-grounded claims).

7. **No learning loop tied to outcome**
- System stores generations but lacks closed-loop quality labeling / reply-rate feedback into prompt profile tuning.

---

## 3) Keep / Merge / Remove Matrix

## Keep (core)
- `messageExamples`
- `mentionBlocks`
- `additionalInstructions`
- `ctaType`
- `questionCountMax`
- `format.sentences`, `format.paragraphs`
- `temperature` (optionally hidden behind Advanced)
- `model`

## Merge (simplify)
- Merge `tone` + `tonePreset` -> single `toneProfile`
- Merge `readingLevel` + `readingLevelPreset` -> single `readingLevel`
- Merge `lengthPreset` + `format` -> one control system:
  - either preset-only
  - or advanced explicit sentence/paragraph override
- Merge `goal` + `ctaStyle` + `ctaType` -> single `conversationObjective`
  - includes desired action + pressure level

## Remove (or internalize)
- Remove user-facing `personalizationDepth` (derive from context richness + selected strategy).
- Remove duplicate “legacy” fields from API payload once migrated.
- Remove repeated descriptor lines in system prompt that restate same constraint.

---

## 4) Recommended Prompt Architecture v2

## A. Three-layer prompt contract

1. **System Layer (stable policy)**
- Role, truthfulness, grounding, allowed claim sources, prohibited patterns.

2. **Strategy Layer (compiled from settings)**
- Single objective, CTA policy, tone profile, length policy, question policy.
- No duplicated synonyms.

3. **Context Layer (ranked evidence)**
- Ranked bullet evidence blocks:
  - `TopSignals` (recent convo intent, last contact message)
  - `PersonalizationSignals` (posts, role, company trigger)
  - `FallbackContext` (company about/domain)

## B. Instruction precedence (must define explicitly)
- Priority order:
  1. Safety + factual grounding
  2. Hard output constraints
  3. User additional instructions
  4. Message examples style mimicry
  5. Soft style preferences

## C. Output contract v2
- Return JSON internally first:
  - `message`
  - `usedSignals` (IDs/names of evidence used)
  - `compliance` (question_count, paragraph_count, has_specific_personalization)
- Save only `message`; store metadata for evaluation/debug.

---

## 5) Better System for Prompt Generation

## A. Compiler pipeline

1. `SettingsNormalizer`
- Convert UI inputs into canonical strategy schema.
- Drop redundant fields.

2. `ContextScorer`
- Score candidate context snippets by:
  - recency
  - specificity
  - relevance to CTA objective
  - novelty vs already used examples

3. `PromptCompiler`
- Build compact prompt with strict sections:
  - Objective
  - Constraints
  - Ranked Evidence
  - Style Examples

4. `OutputValidator`
- Heuristic checks before persistence:
  - max question count
  - no invented claims
  - contains at least one concrete personalization anchor
  - avoids banned generic openers

## B. Recommended UI simplification (reply-rate oriented)
- Basic mode (default):
  - Objective
  - Tone profile
  - Length
  - Context blocks
  - Examples
  - Additional instructions
- Advanced mode:
  - temperature
  - explicit sentence/paragraph overrides
  - strictness toggles

---

## 6) Practical Evaluation Loop (before implementation and after rollout)

## Offline eval set
- Build 100-200 historical conversation cases.
- Human-labeled rubric (1-5) on:
  - personalization relevance
  - clarity
  - CTA naturalness
  - factual grounding
  - likely reply intent

## Online A/B
- A: current prompt system
- B: v2 compiled prompt

Track:
- reply rate
- positive reply rate
- meeting-booked rate (if available)
- manual edit distance before send
- user regenerate rate (lower is better)

Guardrails:
- do not regress factuality or policy compliance.

## Iteration cadence
- Weekly review:
  - top failing samples
  - settings usage patterns
  - prompt variants by segment (cold outreach, follow-up, re-engage)

---

## 7) Implementation Priority (when you move from audit to build)

1. Remove redundancy in payload and prompt text (highest ROI, lowest risk).
2. Add instruction precedence + compact strategy layer.
3. Add context ranking and evidence selection.
4. Add validator + metadata logging.
5. Add A/B framework and metric dashboard.

Expected result:
- less prompt noise
- stronger personalization grounding
- clearer CTA behavior
- better consistency with equal or better conversion.
