const { z } = require('zod');

// --- Rule Ticket Schema (MVP) ---
// 仕様ベースでサーバ側バリデーションを実装。

const RuleTicketSchema = z.object({
  coreIdea: z.string().max(500).default(''),
  wantedExperience: z.array(z.string().max(100)).max(10).default([]),
  playStyleCandidates: z.array(z.string().max(100)).max(10).default([]),
  themeKeywords: z.array(z.string().max(100)).max(10).default([]),

  suggestedGenres: z.array(z.string().max(100)).max(10).default([]),
  referenceGames: z.array(z.string().max(100)).max(10).default([]),
  referenceReasoning: z.array(z.string().max(200)).max(10).default([]),
  adoptedDirection: z.string().max(300).default(''),

  title: z.string().max(200).default(''),
  concept: z.string().max(1000).default(''),
  goal: z.string().max(500).default(''),
  winCondition: z.string().max(500).default(''),
  setupSteps: z.array(z.string().max(300)).max(30).default([]),
  turnFlow: z.array(z.string().max(300)).max(30).default([]),
  components: z.array(z.string().max(200)).max(30).default([]),

  deckSpec: z
    .object({
      cards: z
        .array(
          z.object({
            id: z.string().max(100),
            name: z.string().max(200),
            text: z.string().max(1000).optional().default(''),
            count: z.number().int().min(1).max(20).default(1),
          })
        )
        .max(200)
        .default([]),
    })
    .default({ cards: [] }),

  openQuestions: z.array(z.string().max(300)).max(20).default([]),
  missingFields: z.array(z.string().max(100)).max(20).default([]),
  nextQuestion: z.string().max(300).default(''),
  saveReadiness: z
    .enum(['not_ready', 'needs_review', 'ready_to_save'])
    .default('not_ready'),
});

const RuleTicketPatchSchema = RuleTicketSchema.partial();

function createEmptyRuleTicket() {
  // default() を適用するために parse を通す
  return RuleTicketSchema.parse({});
}

function applyRuleTicketPatch(currentTicket, patch) {
  const base = RuleTicketSchema.parse(currentTicket || {});
  const safePatch = RuleTicketPatchSchema.parse(patch || {});
  const merged = {
    ...base,
    ...safePatch,
    deckSpec: typeof safePatch.deckSpec === 'object' && safePatch.deckSpec !== null
      ? { ...base.deckSpec, ...safePatch.deckSpec }
      : base.deckSpec,
  };
  return RuleTicketSchema.parse(merged);
}

module.exports = {
  RuleTicketSchema,
  RuleTicketPatchSchema,
  createEmptyRuleTicket,
  applyRuleTicketPatch,
};

