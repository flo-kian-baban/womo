/**
 * FieldExplainer
 *
 * An expandable contextual panel that appears below any sociological field value.
 * Shows three sections for each field:
 *   1. What this measures
 *   2. How it was determined (data sources + method)
 *   3. Why it matters for brand matching
 *
 * Triggered by a small "?" info button next to the field label.
 */

import { useState } from "react";
import { HelpCircle, ChevronDown, ChevronUp, Database, Target, BookOpen } from "lucide-react";

// ─── Field Explainer Definitions ─────────────────────────────────────────────

interface FieldExplanation {
  /** Short name for the field */
  label: string;
  /** The theoretical framework or author it comes from */
  framework: string;
  /** What the field actually measures in plain language */
  measures: string;
  /** How the value was determined — data sources and method */
  howDetermined: string;
  /** Why this field matters specifically for brand-creator matching */
  whyItMatters: string;
  /** The possible values and what each means */
  possibleValues?: { value: string; meaning: string }[];
}

const FIELD_EXPLANATIONS: Record<string, FieldExplanation> = {

  culturalCapital: {
    label: "Cultural Capital",
    framework: "Pierre Bourdieu",
    measures: "Whether the creator produces original cultural value or relays existing cultural value. A 'Producer' creates new cultural meaning — they introduce audiences to things before they go mainstream. A 'Relay' amplifies and distributes cultural meaning that already exists. This is not a quality judgment; both types serve different brand functions.",
    howDetermined: "Computed from two data signals: (1) the percentage of videos using original audio the creator recorded themselves vs. licensed music, and (2) the share rate relative to plays. High original audio + high share rate = Producer. Low original audio + lower share rate = Relay. The AI may refine this based on decoded identity claims and status signals from the Symbol Decoder.",
    whyItMatters: "Producers are better for brand launches, category creation, and reaching early adopters. Relays are better for amplifying existing campaigns, reaching mainstream audiences, and driving volume. Matching a Producer to a brand that wants mass reach, or a Relay to a brand that wants to appear cutting-edge, creates a cultural mismatch that audiences sense even if they cannot name it.",
    possibleValues: [
      { value: "Produce", meaning: "Creates original cultural meaning; introduces audiences to new ideas, places, or products" },
      { value: "Relay", meaning: "Amplifies and distributes existing cultural meaning; reaches broader audiences with established ideas" },
    ],
  },

  goffmanStageConsistency: {
    label: "Stage Test",
    framework: "Erving Goffman — Dramaturgical Theory",
    measures: "The gap between the creator's 'front stage' (the curated, public-facing persona in captions and titles) and their 'back stage' (the unscripted, authentic self visible in spoken transcripts and candid moments). A consistent creator presents the same identity in both registers. A gap suggests the public persona is a performance that may not reflect genuine values.",
    howDetermined: "Compared the language and identity claims in video captions/titles (front stage) against the spoken content in transcripts (back stage). When transcripts are available, the AI looks for contradictions: does the creator claim expertise in captions but speak with uncertainty in transcripts? Does the bio claim one identity but the spoken content reveal another? When only titles are available, this field is estimated from tone consistency across the content sample.",
    whyItMatters: "Brands that partner with a creator whose front and back stage are misaligned risk audience backlash when the partnership feels inauthentic. A creator with 'Consistent' staging means the brand message will be delivered with genuine conviction. A 'Significant Gap' is a risk flag — the creator's audience may sense inauthenticity, and the brand association could feel forced.",
    possibleValues: [
      { value: "Consistent", meaning: "Public persona and authentic self are aligned; low authenticity risk" },
      { value: "Minor Gap", meaning: "Small differences between curated and candid presentation; manageable risk" },
      { value: "Significant Gap", meaning: "Meaningful contradiction between public persona and authentic content; high authenticity risk" },
    ],
  },

  driftSignal: {
    label: "Drift Signal",
    framework: "Identity Stability Analysis (6-Month Window)",
    measures: "Whether the creator's content identity, tone, and niche have remained stable or shifted over the past 6 months. Drift is not inherently bad — a deliberate pivot toward a new niche can be a positive trajectory signal. Uncontrolled drift, where the creator is inconsistently experimenting, is a risk flag for brand partnerships.",
    howDetermined: "Videos are bucketed into three time periods using their creation timestamps: Recent (last 90 days), Mid-period (3–12 months ago), and Older (12+ months ago). The AI compares topic focus, tone register, and content type across these buckets. A creator whose food content has gradually expanded to include travel is 'Minor Drift'. A creator who was a fitness creator 6 months ago and is now doing comedy is 'Full Pivot'.",
    whyItMatters: "Brand partnerships are typically 3–12 months long. A creator in 'Full Pivot' may not be the same creator when the campaign launches as they are when it is signed. A 'Zero Change' creator offers predictability — the audience they have today is the audience the brand will reach. Drift also affects the Stability Score (γ) in the F.I.T. calculation.",
    possibleValues: [
      { value: "Zero Change", meaning: "Content identity is stable; predictable audience and tone for brand campaigns" },
      { value: "Minor Drift", meaning: "Gradual evolution within the same niche; low risk, may indicate healthy growth" },
      { value: "Significant Drift", meaning: "Noticeable shift in content focus or tone; moderate risk for long-term partnerships" },
      { value: "Full Pivot", meaning: "Creator has moved to a different niche entirely; high risk — audience composition may be changing" },
    ],
  },

  stuartHallDecoding: {
    label: "Decoding Audit",
    framework: "Stuart Hall — Encoding/Decoding Theory",
    measures: "How the creator's audience is primed to receive and interpret messages. 'Dominant' means the audience accepts the creator's framing at face value — they trust the creator's recommendations and decode brand messages as intended. 'Negotiated' means the audience partially accepts the framing but applies their own filters. 'Oppositional' means the audience is critical and likely to decode brand messages skeptically.",
    howDetermined: "Inferred from three sources: (1) the aspiration drivers decoded by the Symbol Decoder — creators who promise transformation tend to have Dominant audiences; (2) the community references — strong in-group language creates Dominant decoding within the tribe; (3) the comment rate and save rate — high save rate suggests the audience acts on recommendations (Dominant), while high comment rate with mixed sentiment suggests Negotiated decoding.",
    whyItMatters: "A brand message delivered through a Dominant-decoding creator will be received as a genuine recommendation. The same message through an Oppositional-decoding creator will be received as a paid advertisement regardless of how it is framed. This field directly informs the Decoding Modifier in the Alignment Score (α) calculation — it is a multiplier on the entire F.I.T. Score.",
    possibleValues: [
      { value: "Dominant", meaning: "Audience accepts creator's framing; brand messages will be received as genuine recommendations" },
      { value: "Negotiated", meaning: "Audience applies partial filters; brand messages will be received with some skepticism" },
      { value: "Oppositional", meaning: "Audience is critically resistant; brand messages risk being decoded as inauthentic advertising" },
    ],
  },

  rogersAdopterStage: {
    label: "Rogers Adopter Stage",
    framework: "Everett Rogers — Diffusion of Innovations",
    measures: "Where the creator sits on the innovation adoption curve relative to their niche. This tells you whether the creator's audience is made up of people who discover trends early (Innovators, Early Adopters) or people who adopt trends after they are established (Early Majority, Late Majority, Laggards). This is about the creator's cultural position, not their follower count.",
    howDetermined: "Assessed from three signals: (1) status signals from the Symbol Decoder — phrases like 'before it blows up' or 'I found it first' indicate Innovator/Early Adopter positioning; (2) the underground density and mainstream bleed flags; (3) the content's relationship to emerging vs. established trends in the niche. A creator reviewing restaurants that are not yet on mainstream food apps is an Early Adopter. A creator reviewing the same restaurants after they appear on every 'best of' list is Early Majority.",
    whyItMatters: "This field is the primary input for the Pulse Score (β). A brand launching a new product needs Early Adopter creators to generate credibility before mainstream reach. A brand with an established product needs Early/Late Majority creators to drive volume. Mismatching — e.g., using a Laggard creator to launch an innovation — produces a cultural credibility gap that undermines the campaign.",
    possibleValues: [
      { value: "Innovator", meaning: "Discovers and creates trends; tiny but highly influential audience of taste-makers" },
      { value: "Early Adopter", meaning: "Adopts trends before mainstream; credibility-building audience for new products" },
      { value: "Early Majority", meaning: "Adopts trends as they peak; large, mainstream audience for established products" },
      { value: "Late Majority", meaning: "Adopts trends after they are proven; skeptical, value-oriented audience" },
      { value: "Laggard", meaning: "Adopts trends last; traditional audience resistant to new products" },
    ],
  },

  creatorNichePosition: {
    label: "Creator's Niche Position",
    framework: "Competitive Positioning Analysis",
    measures: "Whether the creator is ahead of, consistent with, or behind the current direction of their niche. 'Ahead' means the creator is pushing the niche forward — their content is where the niche is going, not where it has been. 'Consistent' means the creator is producing content that is representative of the niche's current center. 'Behind' means the creator's content is lagging behind where the niche has moved.",
    howDetermined: "Assessed by comparing the creator's content themes and vocabulary against the Rogers Adopter Stage and the Drift Signal. A creator with Early Adopter positioning and Zero Drift who is covering topics that are still emerging in their niche is 'Ahead'. A creator with Late Majority positioning whose content mirrors what was popular 12 months ago is 'Behind'. The Symbol Decoder's status signals also contribute — 'I found it first' language is a strong 'Ahead' indicator.",
    whyItMatters: "Brands want to be associated with where a niche is going, not where it has been. A creator who is 'Ahead' in their niche gives the brand a credibility signal that positions the brand as forward-thinking. A creator who is 'Behind' risks associating the brand with a declining cultural moment. This field is particularly important for trend-sensitive categories like fashion, food, and technology.",
    possibleValues: [
      { value: "Ahead", meaning: "Creator is pushing the niche forward; ideal for brands wanting to lead cultural conversations" },
      { value: "Consistent", meaning: "Creator is representative of the niche's current center; reliable for mainstream brand alignment" },
      { value: "Behind", meaning: "Creator's content lags behind the niche's current direction; risk of associating brand with a declining moment" },
    ],
  },

  lifecyclePhase: {
    label: "Lifecycle Phase",
    framework: "Platform-Audience-Engagement (PAE) Model",
    measures: "The creator's current stage in their platform lifecycle. This is distinct from their follower count — a creator can have 500K followers and be in a 'Plateau' phase if their engagement is declining, or have 50K followers and be in 'Ascent' if their engagement is accelerating. The lifecycle phase tells you the trajectory of the creator's influence, not its current size.",
    howDetermined: "Assessed from the relationship between follower count, average views, engagement rate, and the temporal content analysis. A creator whose recent videos are outperforming their older videos in views and engagement is in 'Ascent'. A creator whose metrics are flat is in 'Plateau'. A creator whose recent content is underperforming their historical average is in 'Decline'. The Drift Signal also informs this — a Full Pivot often precedes a new Ascent phase.",
    whyItMatters: "Partnering with a creator in 'Ascent' means the brand benefits from growing reach during the campaign. Partnering with a creator in 'Decline' means the brand is paying for an audience that is shrinking. This field directly affects the Pulse Score (β) and is one of the most important signals for evaluating the long-term value of a partnership.",
    possibleValues: [
      { value: "Ascent", meaning: "Growing reach and engagement; brand benefits from momentum during campaign" },
      { value: "Plateau", meaning: "Stable metrics; predictable reach but limited upside" },
      { value: "Decline", meaning: "Shrinking reach or engagement; risk of overpaying for a diminishing audience" },
      { value: "Pivot", meaning: "Creator is transitioning to a new niche; high uncertainty, potential for new growth" },
    ],
  },

  turnerLiminalPhase: {
    label: "Liminal Phase Check",
    framework: "Victor Turner — Liminality Theory",
    measures: "Whether the creator is in a liminal state — a threshold moment of transition between one cultural identity and another. Turner's concept of liminality describes the 'in-between' state where old structures have dissolved but new ones have not yet solidified. A creator in a liminal phase is in the process of becoming something new, which creates both opportunity and risk.",
    howDetermined: "Assessed from the combination of Drift Signal, Lifecycle Phase, and the temporal content analysis. A creator who has recently changed their content focus, tone, or audience address patterns is likely in a liminal phase. The Symbol Decoder's identity claims are particularly revealing here — a creator who is actively constructing a new identity ('I'm not just a food creator anymore') is in a liminal phase. A creator with stable identity claims across all time buckets is 'Stable'.",
    whyItMatters: "A creator in a liminal phase is in the process of redefining their relationship with their audience. This is a high-risk, high-reward moment for brands. Partnering during a liminal phase can position the brand as part of the creator's new identity — but if the transition fails, the brand is associated with the confusion. A 'Stable' creator offers predictability. A 'Liminal' creator offers the possibility of being part of something new.",
    possibleValues: [
      { value: "Stable", meaning: "Creator's identity and audience relationship are established and consistent" },
      { value: "Liminal", meaning: "Creator is in a threshold transition; identity and audience relationship are being renegotiated" },
      { value: "Post-Liminal", meaning: "Creator has recently completed a transition and is establishing a new stable identity" },
    ],
  },

  barthesNicheMeaning: {
    label: "Meaning Check",
    framework: "Roland Barthes — Mythologies",
    measures: "The naturalized belief or cultural myth that the creator's niche content reinforces. Every niche has an underlying mythology — a belief that the content makes feel obvious and natural even though it is a cultural construction. This is the 'second-order meaning' that Barthes identified: the content says 'here is a restaurant review' but the myth says 'discovering the right food is how you belong to this city'.",
    howDetermined: "Derived from the Barthes Myth field (the creator-level myth) combined with the niche topic node and the aspiration drivers from the Symbol Decoder. The Meaning Check identifies the specific cultural belief that the niche — not just the creator — is built on. It answers: what does this type of content make audiences believe is natural, normal, or desirable?",
    whyItMatters: "A brand that aligns with the niche's underlying myth will feel culturally coherent to the audience. A brand that contradicts the niche myth will feel like an intrusion. For example, a halal food niche is built on the myth that 'authentic belonging requires food that reflects your identity' — a brand that reinforces identity and belonging fits naturally; a brand that is purely transactional will feel out of place. This field is used in the Myth Alignment component of the Alignment Score (α).",
  },

};

// ─── Component ────────────────────────────────────────────────────────────────

interface FieldExplainerProps {
  fieldKey: string;
  value?: string | number | null;
}

export default function FieldExplainer({ fieldKey, value }: FieldExplainerProps) {
  const [open, setOpen] = useState(false);
  const explanation = FIELD_EXPLANATIONS[fieldKey];

  if (!explanation) return null;

  return (
    <div className="mt-1.5">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors group"
        title="What does this field mean?"
      >
        <HelpCircle className="w-3 h-3 group-hover:text-primary/60 transition-colors" />
        <span className="uppercase tracking-wide font-medium">
          {open ? "Hide explanation" : "What does this mean?"}
        </span>
        {open
          ? <ChevronUp className="w-3 h-3" />
          : <ChevronDown className="w-3 h-3" />
        }
      </button>

      {/* Expandable panel */}
      {open && (
        <div className="mt-2 rounded-lg border border-border/40 bg-secondary/30 overflow-hidden text-[11px] leading-relaxed">
          {/* Framework badge */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-secondary/50">
            <BookOpen className="w-3 h-3 text-primary/60 flex-shrink-0" />
            <span className="text-primary/70 font-semibold uppercase tracking-wide text-[9px]">
              {explanation.framework}
            </span>
          </div>

          <div className="divide-y divide-border/20">
            {/* What this measures */}
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target className="w-3 h-3 text-sky-400/70 flex-shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400/70">
                  What this measures
                </span>
              </div>
              <p className="text-muted-foreground/80">{explanation.measures}</p>
            </div>

            {/* How it was determined */}
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Database className="w-3 h-3 text-amber-400/70 flex-shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/70">
                  How it was determined
                </span>
              </div>
              <p className="text-muted-foreground/80">{explanation.howDetermined}</p>
            </div>

            {/* Why it matters */}
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <HelpCircle className="w-3 h-3 text-violet-400/70 flex-shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400/70">
                  Why it matters for brand matching
                </span>
              </div>
              <p className="text-muted-foreground/80">{explanation.whyItMatters}</p>
            </div>

            {/* Possible values legend */}
            {explanation.possibleValues && explanation.possibleValues.length > 0 && (
              <div className="px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                    Possible values
                  </span>
                </div>
                <div className="space-y-1.5">
                  {explanation.possibleValues.map(({ value: v, meaning }) => (
                    <div
                      key={v}
                      className={`flex items-start gap-2 ${value !== null && value !== undefined && String(value) === v ? "opacity-100" : "opacity-50"}`}
                    >
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border flex-shrink-0 mt-0.5 ${
                        value !== null && value !== undefined && String(value) === v
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border/40 bg-secondary/50 text-muted-foreground/60"
                      }`}>
                        {v}
                      </span>
                      <span className="text-muted-foreground/70 leading-relaxed">{meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Export the field keys that have explanations, for use in the profile card
export const EXPLAINED_FIELD_KEYS = new Set(Object.keys(FIELD_EXPLANATIONS));
