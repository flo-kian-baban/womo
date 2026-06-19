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
    whyItMatters: "A brand message delivered through a Dominant-decoding creator will be received as a genuine recommendation. The same message through an Oppositional-decoding creator will be received as a paid advertisement regardless of how it is framed. This field directly informs the Decoding Modifier in the Alignment Score (α) calculation — it is a multiplier on the entire Cultural Match Score.",
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

  culturalVelocity: {
    label: "Cultural Velocity",
    framework: "Longitudinal Content Analysis",
    measures: "Whether the creator's cultural identity is converging (Focusing) or dispersing (Drifting) over their recent content. 'Focusing' means the creator is doubling down on a coherent cultural position — their themes, tone, and audience address are becoming more consistent over time. 'Drifting' means the creator's cultural signals are becoming less coherent — they are experimenting across multiple identities or niches without a clear trajectory.",
    howDetermined: "Computed by comparing signal consistency across the three temporal buckets (Recent, Mid-period, Anchor). When the same themes, tone register, and identity claims appear with increasing frequency in recent content, velocity is 'Focusing'. When recent content introduces new themes that don't connect to the established baseline, velocity is 'Drifting'. Requires at least 6 videos across 2+ time periods; otherwise returns 'Insufficient Data'.",
    whyItMatters: "Cultural velocity is a leading indicator of partnership predictability. A 'Focusing' creator is becoming a stronger version of what they already are — the brand can predict what content will look like during the campaign. A 'Drifting' creator may produce content during the campaign that doesn't match the cultural profile that was used to select them. This field directly informs the Stability Score (γ) in the F.I.T. calculation.",
    possibleValues: [
      { value: "Focusing", meaning: "Cultural identity is converging — increasingly consistent themes, tone, and positioning" },
      { value: "Drifting", meaning: "Cultural identity is dispersing — experimenting across themes without clear trajectory" },
      { value: "Insufficient Data", meaning: "Not enough temporal data to assess velocity — fewer than 6 videos or single time period" },
    ],
  },

  // ─── New Field Definitions (P1-1) ──────────────────────────────────────────

  archetype: {
    label: "Archetype",
    framework: "Carl Jung — 12-Archetype Matrix",
    measures: "The creator's dominant psychological archetype — the symbolic role they inhabit in the cultural imagination of their audience. This is not a personality trait; it is the narrative function the creator serves. A Hero creator inspires action through challenge. A Sage creator inspires through knowledge. A Jester inspires through irreverence. The archetype determines the emotional register of everything the creator produces.",
    howDetermined: "Classified by the AI from the full corpus of the creator's content — captions, spoken transcripts, bio, decoded symbols, and visual language. The AI identifies recurring narrative patterns: Does the creator position themselves as a guide (Sage)? A boundary-pusher (Outlaw)? A protector (Caregiver)? The classification is validated against the decoded identity claims and aspiration drivers from the Symbol Decoder.",
    whyItMatters: "Archetype compatibility is the single highest-weighted component in the F.I.T. Alignment Score (α). Some archetype pairs are naturally resonant (Hero × Explorer), some are complementary (Sage × Creator), and some clash (Ruler × Outlaw). A mismatched archetype pair produces cognitive dissonance in the audience — the creator and brand feel like they belong in different stories.",
    possibleValues: [
      { value: "Hero", meaning: "Inspires through courage and challenge; the protagonist who overcomes obstacles" },
      { value: "Sage", meaning: "Inspires through knowledge and expertise; the trusted guide and teacher" },
      { value: "Explorer", meaning: "Inspires through discovery and independence; the adventurer seeking new experiences" },
      { value: "Outlaw", meaning: "Inspires through disruption and rebellion; challenges conventions and norms" },
      { value: "Magician", meaning: "Inspires through transformation and vision; makes the impossible seem possible" },
      { value: "Regular Person", meaning: "Inspires through relatability and belonging; the authentic everyman" },
      { value: "Lover", meaning: "Inspires through intimacy and beauty; creates sensory and emotional connection" },
      { value: "Jester", meaning: "Inspires through humor and irreverence; brings joy and lightness" },
      { value: "Caregiver", meaning: "Inspires through nurturing and protection; puts the audience's needs first" },
      { value: "Ruler", meaning: "Inspires through authority and order; creates structure and standards" },
      { value: "Creator", meaning: "Inspires through innovation and self-expression; builds new things and new ideas" },
      { value: "Innocent", meaning: "Inspires through optimism and simplicity; sees and presents the good in everything" },
    ],
  },

  barthesMyth: {
    label: "Barthes Myth",
    framework: "Roland Barthes — Mythologies (1957)",
    measures: "The second-order meaning the creator produces — the cultural myth they reinforce or challenge through their content. This goes beyond what the creator explicitly says to what their content symbolically normalizes. A food creator's first-order message is 'here is a good restaurant.' The Barthes Myth is the deeper cultural belief: 'discovering authentic food is how you prove cultural sophistication.'",
    howDetermined: "Extracted by the AI from the creator's content themes, aspiration drivers, identity claims, and recurring narrative patterns. The AI identifies the implicit cultural assumption that the creator's content makes feel natural and obvious — the belief that audiences absorb without consciously recognizing it as a constructed meaning.",
    whyItMatters: "Myth alignment determines whether brand and creator are telling compatible cultural stories. A brand whose myth is 'premium quality justifies premium price' will resonate with a creator whose myth is 'discovering the best is worth the effort.' The same brand will clash with a creator whose myth is 'you don't need expensive things to be happy.' This field feeds directly into the Myth Alignment Score in the Alignment Score (α).",
  },

  parasocialBondStrength: {
    label: "Parasocial Bond Strength",
    framework: "Horton & Wohl (1956) — Parasocial Interaction Theory",
    measures: "The strength of the one-sided emotional relationship between creator and audience, scored 0–5. High scores indicate audiences feel genuine personal intimacy with the creator — they feel like they 'know' the creator, even though the relationship is mediated through content. Low scores indicate a more transactional relationship where the audience values the content but not the person.",
    howDetermined: "Assessed from three signals: (1) the use of direct address language ('you guys,' 'I want to show you') in transcripts; (2) the ratio of personal disclosure to informational content; (3) the comment patterns — audiences with strong parasocial bonds leave personal, conversational comments rather than transactional ones. High parasocial bond = the creator is a 'friend.' Low bond = the creator is a 'source.'",
    whyItMatters: "Parasocial bond strength directly affects brand recall and message transfer effectiveness. A creator with a 4–5 bond score delivers brand messages as personal recommendations from a trusted friend. A creator with a 1–2 bond score delivers brand messages as informational content — effective for awareness, less effective for conversion. Brands seeking direct response need high parasocial bonds; brands seeking awareness can use lower bonds.",
    possibleValues: [
      { value: "0–1", meaning: "Minimal parasocial connection; audience values content, not creator personally" },
      { value: "2–3", meaning: "Moderate connection; audience has some personal affinity for the creator" },
      { value: "4–5", meaning: "Intense parasocial bond; audience feels genuine personal relationship with creator" },
    ],
  },

  audienceRelationshipType: {
    label: "Audience Relationship Type",
    framework: "Parasocial Relationship Typology",
    measures: "The dominant mode of connection between creator and audience — the role the creator plays in the audience's life. This determines which brand categories and message types will feel natural vs. forced when delivered through this creator.",
    howDetermined: "Classified from the creator's communication patterns, content structure, and decoded identity claims. A 'Mentor' creator teaches and guides. A 'Peer' creator shares experiences as an equal. An 'Entertainer' creator performs for the audience. An 'Authority' creator instructs from a position of expertise.",
    whyItMatters: "Determines which brand categories will feel natural vs forced. A Mentor relationship works well for educational brands and services. A Peer relationship works for lifestyle brands. An Entertainer relationship works for impulse purchases and entertainment brands. An Authority relationship works for premium and professional brands. Mismatching the relationship type creates authenticity risk.",
    possibleValues: [
      { value: "Mentor", meaning: "Creator teaches and guides; audience seeks growth and learning" },
      { value: "Peer", meaning: "Creator shares as an equal; audience relates and identifies" },
      { value: "Entertainer", meaning: "Creator performs; audience seeks enjoyment and escapism" },
      { value: "Authority", meaning: "Creator instructs from expertise; audience seeks validation and direction" },
    ],
  },

  toneRegister: {
    label: "Tone Register",
    framework: "Sociolinguistics — Register Theory",
    measures: "The consistent linguistic register the creator uses across their content — the formality, emotional tone, and social positioning expressed through language choices. Register is not about what the creator says but how they say it — the vocabulary complexity, sentence structure, and emotional valence that define their voice.",
    howDetermined: "Analyzed from the creator's spoken transcripts and video captions/titles. The AI assesses vocabulary sophistication, sentence complexity, use of slang vs. formal language, emotional expressiveness, and the degree of code-switching between registers. A creator who speaks in academic language has a formal register; one who uses community slang has a vernacular register.",
    whyItMatters: "Tonal mismatches between creator and brand produce cognitive dissonance in the audience. A premium luxury brand delivered through a casual, slang-heavy creator feels inauthentic. A community-focused brand delivered through a formal, professional creator feels sterile. The tone register must align with the brand's own communication style for the partnership to feel natural.",
  },

  nicheTopicNode: {
    label: "Niche Topic Node",
    framework: "Cultural Niche Mapping",
    measures: "The specific cultural subspace the creator occupies within the broader content landscape. This is more granular than a 'category' — it captures the particular cultural conversation, community, and set of values the creator is embedded in. 'Toronto halal food' is a niche topic node; 'food' is a category. The niche determines not just what the creator talks about but the cultural frame through which they talk about it.",
    howDetermined: "Identified from the intersection of the creator's content themes, geographic signals, cultural references, and audience composition. The AI maps the creator to a specific node in the cultural niche graph — the most precise description of the community and conversation they belong to.",
    whyItMatters: "Niche proximity is the primary determinant of audience tribal overlap. Two creators in the same niche topic node share significant audience overlap. A brand entering a specific niche needs creators who are embedded in that exact community — not just the broader category. A 'Toronto halal food' creator reaches a fundamentally different audience than a 'New York fine dining' creator, even though both are in 'food.'",
  },

  undergroundDensity: {
    label: "Underground Density",
    framework: "Cultural Capital Theory (Pierre Bourdieu)",
    measures: "Whether the creator's content draws primarily from subcultural, niche, or underground references — signals that are meaningful only to initiated, culturally embedded audiences. High underground density means the content assumes cultural literacy that mainstream audiences lack.",
    howDetermined: "Assessed from the creator's vocabulary, music choices, and reference patterns. Underground creators use in-group terminology, reference niche figures, and signal membership in specific cultural communities. The AI measures the ratio of niche-specific references to mainstream references across the content sample.",
    whyItMatters: "High underground density limits mass-market reach but dramatically increases tribal authenticity and credibility. Brands entering a specific subculture need creators with high underground density to gain acceptance. Brands seeking broad reach need lower density. This field directly informs the Cultural Capital classification.",
    possibleValues: [
      { value: "High", meaning: "Content is dense with subcultural references; strong tribal credibility, limited mainstream accessibility" },
      { value: "Medium", meaning: "Mix of subcultural and mainstream references; balances credibility with reach" },
      { value: "Low", meaning: "Content uses primarily mainstream references; broad accessibility, lower tribal specificity" },
    ],
  },

  mainstreamBleed: {
    label: "Mainstream Bleed",
    framework: "Cultural Diffusion Theory",
    measures: "Whether the creator's content incorporates mainstream cultural references alongside niche content — a marker of the creator's ability to translate between subcultural and mainstream audiences. Mainstream bleed indicates the creator can make niche ideas accessible to broader audiences.",
    howDetermined: "Assessed from the presence of mainstream music, trending sounds, and widely-recognized cultural references in content that is otherwise niche-focused. A halal food creator who uses trending audio and references mainstream culture alongside niche halal content has high mainstream bleed.",
    whyItMatters: "Mainstream bleed affects mass-market brand partnership viability. Creators with high bleed can introduce mainstream brands to niche audiences without losing credibility. Creators with low bleed are more authentic within their niche but may struggle to integrate mainstream brand messaging naturally.",
    possibleValues: [
      { value: "High", meaning: "Regularly bridges niche and mainstream; effective for cross-market brand campaigns" },
      { value: "Moderate", meaning: "Some mainstream integration; selective cross-cultural translation" },
      { value: "Low", meaning: "Stays within niche boundaries; authentic but limited mainstream brand integration" },
    ],
  },

  remixRate: {
    label: "Remix Rate",
    framework: "Participatory Culture (Henry Jenkins)",
    measures: "Whether the creator actively remixes, duets, or stitches other creators' content — indicating participation in collaborative content culture rather than purely original creation. This signals the creator's role in the content ecosystem as a participant vs. an originator.",
    howDetermined: "Computed from the proportion of the creator's videos that are duets, stitches, or replies to other creators' content, combined with the use of trending sounds and formats. High remix rate = the creator builds on others' content. Low remix rate = the creator produces primarily original content.",
    whyItMatters: "High remix creators attract audiences who value community participation and collaborative culture over individual authorship. These audiences are more likely to engage with brand content that invites participation (challenges, duets). Low remix creators attract audiences who value originality — these audiences respond better to exclusive, premium brand content.",
    possibleValues: [
      { value: "High", meaning: "Frequently duets/stitches; collaborative audience expecting participatory brand content" },
      { value: "Moderate", meaning: "Occasional remixing; balanced original and participatory content" },
      { value: "Low", meaning: "Primarily original content; audience values originality over participation" },
    ],
  },

  brandSaturation: {
    label: "Brand Saturation",
    framework: "Persuasion Knowledge Theory (Friestad & Wright)",
    measures: "Whether the creator's content is heavily saturated with brand partnerships, sponsorships, and paid promotions. High saturation activates the audience's persuasion knowledge model — their built-in skepticism toward advertising — which reduces the effectiveness of any new brand partnership.",
    howDetermined: "Assessed from the frequency of branded content, product mentions, and sponsorship indicators across the creator's video corpus. The AI also considers disclosure patterns and the ratio of organic to sponsored content. A creator who posts sponsored content every 2–3 videos is highly saturated.",
    whyItMatters: "Overexposed creators reduce brand recall and message authenticity. Audiences who see frequent brand partnerships develop 'ad blindness' and apply higher skepticism to any new brand message. A brand partnering with a highly saturated creator risks being perceived as 'just another ad.' This is particularly important for premium brands where authenticity drives purchase intent.",
    possibleValues: [
      { value: "Low", meaning: "Minimal brand content; high authenticity, sponsored messages will stand out" },
      { value: "Moderate", meaning: "Some brand partnerships; audience has moderate persuasion awareness" },
      { value: "High", meaning: "Frequent brand content; audience applies high skepticism to sponsored messages" },
    ],
  },

  engagementQualityScore: {
    label: "Engagement Quality Score",
    framework: "Engagement Quality Index (EQI)",
    measures: "A composite score (0–100) measuring the depth of audience engagement beyond raw counts — weighted toward comments and saves over passive views and likes. A high EQI means the audience actively invests cognitive effort in the content; a low EQI means engagement is primarily passive (scrolling, viewing, tapping like).",
    howDetermined: "Computed from the weighted ratios of engagement types: saves (highest weight — indicate content worth returning to), comments (high weight — indicate active processing), shares (medium weight — indicate social endorsement), likes (low weight — lowest cognitive effort). The formula also accounts for comment quality — longer, more substantive comments increase the score.",
    whyItMatters: "High engagement quality indicates active audience investment, which transfers directly to brand message retention and recall. A creator with 100K views and 60 EQI delivers more brand value than a creator with 500K views and 15 EQI. This metric is used in the Performance Consistency and Community Quality signals in the F.I.T. calculation.",
    possibleValues: [
      { value: "0–25", meaning: "Low quality — primarily passive engagement (views, likes)" },
      { value: "26–50", meaning: "Moderate quality — some active engagement (comments, shares)" },
      { value: "51–75", meaning: "High quality — strong active engagement indicating audience investment" },
      { value: "76–100", meaning: "Exceptional quality — deep audience commitment (high save rates, substantive comments)" },
    ],
  },

  // ─── Brand-Side Framework Field Definitions ────────────────────────────────

  brandCulturalCapital: {
    label: "Brand Cultural Capital",
    framework: "Pierre Bourdieu — Applied to Brand Identity",
    measures: "Whether the brand produces original cultural meaning in its market or relays existing cultural conventions. A 'Producer' brand creates new cultural expectations — it defines taste, sets trends, and introduces audiences to new ways of thinking about the category. A 'Relay' brand amplifies and commercializes cultural meaning that already exists — it meets audiences where they are rather than leading them somewhere new.",
    howDetermined: "Assessed from the brand's website copy, TikTok content, visual language, and symbolic vocabulary. The AI evaluates whether the brand positions itself as an innovator or a follower — does it claim to be 'redefining' or 'the original'? Does it use novel or conventional visual language? The decoded brand symbols provide the primary evidence for this classification.",
    whyItMatters: "Brand cultural capital must align with creator cultural capital for the partnership to feel coherent. A Producer brand partnered with a Relay creator creates a mismatch — the brand appears cutting-edge but the creator's audience expects convention. Matching Producer-Producer creates innovation credibility; matching Relay-Relay creates mainstream trust.",
    possibleValues: [
      { value: "Produce", meaning: "Brand creates original cultural meaning; defines taste and sets trends in its category" },
      { value: "Relay", meaning: "Brand amplifies existing cultural conventions; meets audiences at established expectations" },
    ],
  },

  brandGoffmanStageConsistency: {
    label: "Brand Stage Consistency",
    framework: "Erving Goffman — Dramaturgical Theory (Applied to Brands)",
    measures: "The gap between the brand's 'front stage' (its public marketing, website messaging, and curated social media presence) and its 'back stage' (how it is actually experienced by customers, as revealed through reviews, complaints, and organic social mentions). A consistent brand delivers on its promises; a gap means the brand's self-presentation does not match reality.",
    howDetermined: "Compared the brand's self-presentation (website copy, social media captions, marketing language) against audience feedback (Yelp reviews, Google reviews, TikTok mention analysis). When reviews consistently contradict the brand's claims — e.g., the brand claims 'premium service' but reviews mention slow service — this produces a 'Significant Gap.'",
    whyItMatters: "A brand with a stage gap is a reputational risk for any creator who partners with it. If the creator's audience discovers the gap — e.g., by visiting the brand and having a negative experience that contradicts the creator's endorsement — it damages the creator's authenticity and the audience's trust in future recommendations.",
    possibleValues: [
      { value: "Consistent", meaning: "Brand delivers on its promises; public image matches actual experience" },
      { value: "Minor Gap", meaning: "Small differences between brand claims and reality; manageable risk" },
      { value: "Significant Gap", meaning: "Brand's marketing does not match actual experience; high reputational risk for partners" },
    ],
  },

  brandDriftSignal: {
    label: "Brand Identity Drift",
    framework: "Cultural Identity Stability — Applied to Brands",
    measures: "Whether the brand's cultural identity, positioning, and messaging have remained stable or shifted over the analysis period. Brand drift indicates the brand is repositioning — which can be a strategic pivot or a sign of identity confusion. Unlike creator drift, brand drift often reflects organizational changes rather than organic creative evolution.",
    howDetermined: "Assessed from changes in the brand's website messaging, visual language, and TikTok content over time, combined with shifts in audience perception visible in reviews and social mentions. A brand that has changed its tagline, visual style, or target audience recently shows drift signals.",
    whyItMatters: "A drifting brand creates uncertainty for creator partnerships — the brand identity that was matched to the creator may not be the same brand identity that exists when the campaign launches. Brands with 'Zero Change' offer partnership predictability; brands in 'Full Pivot' require re-evaluation before committing to a long-term deal.",
    possibleValues: [
      { value: "Zero Change", meaning: "Brand identity is stable; predictable for partnership planning" },
      { value: "Minor Drift", meaning: "Gradual evolution in positioning; low risk for partnerships" },
      { value: "Significant Drift", meaning: "Noticeable shift in brand identity; moderate risk" },
      { value: "Full Pivot", meaning: "Brand is fundamentally repositioning; high uncertainty for partnerships" },
    ],
  },

  brandStuartHallDecoding: {
    label: "Brand Audience Decoding",
    framework: "Stuart Hall — Encoding/Decoding Theory (Applied to Brands)",
    measures: "How the brand's audience currently decodes its messages. 'Dominant' means the audience accepts the brand's intended message at face value — they trust the brand's value proposition. 'Negotiated' means the audience accepts some aspects but is skeptical of others. 'Oppositional' means the audience actively resists the brand's messaging — they see through or reject the brand's claims.",
    howDetermined: "Inferred from review sentiment analysis, social mention tone, and the brand's audience decoding split. When reviews are overwhelmingly positive and aligned with the brand's messaging, decoding is Dominant. When reviews show mixed reactions with significant criticism, decoding is Negotiated. When the brand has negative sentiment or a reputation problem, decoding is Oppositional.",
    whyItMatters: "A creator who partners with an Oppositional-decoding brand inherits that skepticism. The creator's audience will decode the brand message skeptically regardless of how authentically the creator presents it. A Dominant-decoding brand is easier to integrate into a creator's content because the audience already trusts the brand's claims.",
    possibleValues: [
      { value: "Dominant", meaning: "Audience trusts the brand; messages will be accepted at face value through creator partnerships" },
      { value: "Negotiated", meaning: "Audience is partially skeptical; some brand messages will be filtered" },
      { value: "Oppositional", meaning: "Audience actively resists the brand; partnership risks inheriting negative perception" },
    ],
  },

  brandRogersAdopterStage: {
    label: "Brand Adopter Stage",
    framework: "Everett Rogers — Diffusion of Innovations (Applied to Brands)",
    measures: "Where the brand sits on the innovation adoption curve from its audience's perspective. A brand can be an Innovator (introducing entirely new concepts to the market), an Early Adopter (establishing a new but growing category), or Late Majority (operating in a well-established, mature market). This is about the brand's cultural novelty, not its company age.",
    howDetermined: "Assessed from the brand's market positioning, the novelty of its product/service category, and how its audience talks about it. A brand that audiences describe as 'different' or 'the first to do X' is an Innovator/Early Adopter. A brand in a saturated market where audiences compare it to many alternatives is Early/Late Majority.",
    whyItMatters: "Brand adopter stage should align with creator adopter stage for cultural coherence. An Innovator brand needs Early Adopter creators to build credibility. A Late Majority brand benefits from Early/Late Majority creators who reach established audiences. Mismatching stages creates cultural dissonance — an innovative brand promoted by a mainstream creator loses its edge.",
    possibleValues: [
      { value: "Innovator", meaning: "Brand is introducing entirely new concepts; needs creator credibility to build trust" },
      { value: "Early Adopter", meaning: "Brand is in a growing category; benefits from creator validation" },
      { value: "Early Majority", meaning: "Brand is in a mainstream category; needs reach over novelty" },
      { value: "Late Majority", meaning: "Brand is in a mature market; competes on reliability and value" },
    ],
  },

  brandTurnerLiminalPhase: {
    label: "Brand Liminal Phase",
    framework: "Victor Turner — Liminality Theory (Applied to Brands)",
    measures: "Whether the brand is in a liminal state — between identities, undergoing a transformation or repositioning. A liminal brand has left its old identity but has not yet fully established its new one. This creates both opportunity and risk — partnering during a liminal phase can position a creator as part of the brand's new identity, but the transition may fail.",
    howDetermined: "Assessed from the combination of brand drift signals, website messaging changes, and shifts in audience perception. A brand that has recently rebranded, changed its core offering, or pivoted its target audience is likely in a liminal phase.",
    whyItMatters: "Liminal brands offer unique partnership opportunities — the brand is actively seeking new cultural associations, making it more open to creator influence. But liminal brands are also unpredictable — their identity may change during the campaign period. Stable brands offer predictability; liminal brands offer the chance to shape the brand's future identity.",
    possibleValues: [
      { value: "Stable", meaning: "Brand identity is established; predictable partnership dynamics" },
      { value: "Liminal", meaning: "Brand is between identities; high opportunity, high uncertainty" },
      { value: "Post-Liminal", meaning: "Brand has recently completed a transition; establishing new identity" },
    ],
  },

  brandLifecyclePhase: {
    label: "Brand Lifecycle Phase",
    framework: "Platform-Audience-Engagement (PAE) Model — Applied to Brands",
    measures: "The brand's current stage in its cultural lifecycle — whether its cultural relevance and audience engagement are growing, stable, or declining. This is about cultural momentum, not financial performance — a profitable brand can be in cultural decline if its audience perception is shifting negatively.",
    howDetermined: "Assessed from trends in review volume, sentiment trajectory, social mention frequency, and TikTok engagement patterns. A brand with increasing positive mentions and growing TikTok engagement is in 'Ascent.' A brand with declining engagement and stale mentions is in 'Decline.'",
    whyItMatters: "Partnering with a brand in cultural Ascent means the creator benefits from the brand's growing cultural relevance — the partnership feels timely and forward-looking. Partnering with a brand in Decline risks associating the creator with a fading cultural moment. This directly affects the Pulse Score (β) in the F.I.T. calculation.",
    possibleValues: [
      { value: "Ascent", meaning: "Growing cultural relevance; partnership feels timely" },
      { value: "Plateau", meaning: "Stable cultural position; predictable but limited upside" },
      { value: "Decline", meaning: "Fading cultural relevance; risk of associating creator with decline" },
    ],
  },

  brandBarthesNicheMeaning: {
    label: "Brand Niche Mythological Meaning",
    framework: "Roland Barthes — Second-Order Signification (Applied to Brands)",
    measures: "The mythological meaning the brand produces within its niche — the deep cultural belief that the brand's existence normalizes. This is the brand equivalent of the creator's Barthes Myth. A fast-casual restaurant's first-order message is 'here is affordable food.' Its mythological meaning might be 'you can eat well without pretension' or 'good food should be democratic.'",
    howDetermined: "Derived from the brand's website copy, marketing language, visual identity, and the decoded brand symbols. The AI identifies the implicit cultural assumption that the brand's marketing makes feel natural — the belief that audiences internalize when they engage with the brand.",
    whyItMatters: "Brand and creator mythological meanings must be compatible for cultural coherence. When both the brand and the creator reinforce the same cultural belief, the partnership feels organic and inevitable. When their myths conflict, the partnership feels contrived. This field is used in the Myth Alignment component of the Alignment Score (α).",
  },

  brandAudienceDecodingSplit: {
    label: "Brand Audience Decoding Split",
    framework: "Stuart Hall — Encoding/Decoding Theory",
    measures: "Whether the brand's audience decodes its messages in a unified way (most people interpret the brand similarly) or in a split way (different audience segments interpret the brand differently). A split indicates cultural tension in the brand's positioning — some people see it as aspirational while others see it as accessible, for example.",
    howDetermined: "Assessed from the variance in review sentiment, the diversity of TikTok mention contexts, and the range of identity claims associated with the brand in social media. A brand that appears in both 'hidden gem' and 'overrated' contexts has a decoding split.",
    whyItMatters: "A divided decoding split means any creator partnership will be interpreted differently by different audience segments — some will see it as authentic and others will see it as incongruent. Unified decoding means the audience will interpret the partnership consistently. Brands with splits require more careful creator selection to avoid alienating a segment.",
    possibleValues: [
      { value: "Unified", meaning: "Audience interprets brand consistently; partnerships will be decoded uniformly" },
      { value: "Split Detected", meaning: "Audience segments interpret brand differently; partnership risks alienating a segment" },
    ],
  },

  brandSymbolicVocabulary: {
    label: "Brand Symbolic Vocabulary",
    framework: "Semiotic Identity Analysis",
    measures: "The culturally loaded terms and phrases that constitute the brand's semiotic identity — the specific language through which the brand signals cultural belonging, values, and symbolic meaning. These are not descriptive keywords; they are the vocabulary the brand uses to position itself within a cultural conversation.",
    howDetermined: "Extracted from brand-authored content — website copy, social media captions, marketing materials, and TikTok/Instagram posts. The AI identifies terms that carry symbolic weight beyond their literal meaning: words that signal values, aspirations, community membership, or cultural positioning.",
    whyItMatters: "Symbolic vocabulary overlap between brand and creator is a primary driver of the F.I.T. Alignment Score. When both entities use the same culturally loaded terms, their partnership feels linguistically natural. When their symbolic vocabularies diverge, the partnership produces linguistic dissonance that audiences detect even if they cannot articulate it.",
  },

  symbolicVocabulary: {
    label: "Symbolic Vocabulary",
    framework: "Semiotics / Bourdieu Cultural Field Theory",
    measures: "The culturally loaded terms and phrases that constitute the brand's semiotic identity — the specific language through which the brand signals cultural belonging, values, and symbolic meaning. Extracted from brand-authored content including website copy, social captions, and TikTok/Instagram content. These terms feed directly into the symbolic overlap score in the F.I.T. calculation — higher vocabulary overlap between creator and brand produces a stronger cultural fit signal.",
    howDetermined: "Extracted from brand-authored content — website copy, social media captions, marketing materials, and TikTok/Instagram posts. The AI identifies terms that carry symbolic weight beyond their literal meaning: words that signal values, aspirations, community membership, or cultural positioning.",
    whyItMatters: "These terms feed directly into the symbolic overlap score in the F.I.T. calculation — higher vocabulary overlap between creator and brand produces a stronger cultural fit signal. When both entities use the same culturally loaded terms, their partnership feels linguistically natural.",
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
