import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricTooltip } from "@/components/MetricTooltip";

export interface Signal {
  name: string;
  score: number; // 0-100
  confidence: "Verified" | "Estimated" | "Insufficient Data";
  reasoning: string;
  category: "Performance" | "Cultural";
}

interface SignalPanelProps {
  signals: Signal[];
  caiScore: number;
  caiStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
}

const getScoreColor = (score: number) => {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
};

const getConfidenceBadgeVariant = (confidence: string) => {
  switch (confidence) {
    case "Verified":
      return "default";
    case "Estimated":
      return "secondary";
    case "Insufficient Data":
      return "outline";
    default:
      return "secondary";
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "Green Light":
      return "bg-green-50 border-green-200";
    case "Proceed with Caution":
      return "bg-yellow-50 border-yellow-200";
    case "Do Not Proceed":
      return "bg-red-50 border-red-200";
    default:
      return "bg-gray-50 border-gray-200";
  }
};

const getStatusTextColor = (status: string) => {
  switch (status) {
    case "Green Light":
      return "text-green-700";
    case "Proceed with Caution":
      return "text-yellow-700";
    case "Do Not Proceed":
      return "text-red-700";
    default:
      return "text-gray-700";
  }
};

// ─── Signal Definitions ────────────────────────────────────────────────────────
const SIGNAL_DEFINITIONS: Record<string, { explanation: string; formula: string; whyItMatters: string; dataPoints: string[] }> = {
  "Identity Fit": {
    explanation: "Grades how consistently the creator's cultural identity aligns with this brand's world — whether both parties show up as genuine, coherent identities.",
    formula: "Identity Fit = (Creator Goffman × 0.4) + (Brand Goffman × 0.3) + (Mention Sentiment × 0.3) | Goffman Consistent=+20, Minor Gap=+15, Significant Gap=+5, Full Pivot=0 | Sentiment: Positive=+15, Mixed=0, Negative=-15",
    whyItMatters: "Partnerships where either party performs inauthentically are decoded by audiences as forced. Identity Fit >75 = natural collaboration. <50 = high risk of audience rejection.",
    dataPoints: ["Creator Goffman stage consistency (6+ month tracking)", "Brand Goffman gap score", "Brand mention sentiment (positive/mixed/negative)"],
  },
  "Performance Fit": {
    explanation: "Grades how reliably this creator delivers active audiences and how structurally stable the brand is as a campaign partner.",
    formula: "Performance Fit = (Engagement Rate × 0.35) + (Lifecycle Phase × 0.35) + (Brand Engagement × 0.3) | Engagement: 0–35 pts | Lifecycle Growth=+15, Stable=+5, Decline=-5 | Brand TikTok Rate=0–15, Brand Rating=0–15",
    whyItMatters: "Perfect cultural fit produces no value if audience is disengaged or brand has no platform presence. Performance Fit >70 = strong delivery potential. <50 = structural performance risk.",
    dataPoints: ["Creator engagement rate: (likes+comments+shares)/views", "Creator lifecycle phase (Growth/Stable/Decline)", "Brand TikTok engagement rate (if available)", "Brand star rating (Google/Yelp/if available)"],
  },
  "Audience Fit": {
    explanation: "Grades how well the creator's actual community matches the people this brand needs to reach.",
    formula: "Audience Fit = (PARR × 0.5) + (Hashtag Overlap × 0.5) | PARR: 0–100 | Hashtag Overlap: (Shared Hashtags / Total Unique) × 100",
    whyItMatters: "Follower count is irrelevant if followers are wrong demographic. Audience Fit >70 = strong audience match. <40 = audience-brand mismatch despite engagement.",
    dataPoints: ["PARR: creator audience receptivity to brand message", "Hashtag overlap: creator's top 50 vs. brand campaign hashtags", "Audience tribe demographic alignment"],
  },
  "Receptivity Fit": {
    explanation: "Grades how likely the creator's audience will accept and act on a brand message from this creator.",
    formula: "Receptivity Fit = PARR | PARR = (Engagement Rate × 0.4) + (Audience Sentiment × 0.3) + (Decoding Match × 0.3) | Sentiment: Positive=100, Mixed=60, Negative=20",
    whyItMatters: "Right demographic can still reject brand message if audience doesn't trust creator. Receptivity Fit >70 = audience will accept message. <40 = audience perceives partnership as inauthentic.",
    dataPoints: ["Per-video engagement rate", "Comment sentiment analysis (LLM)", "Stuart Hall decoding mode (Dominant/Negotiated/Oppositional)"],
  },
  "Brand Safety Fit": {
    explanation: "Grades mutual credibility between creator and brand — whether both parties are stable, low-risk reputational partners.",
    formula: "Brand Safety Fit = (Creator Goffman × 0.25) + (Drift Signal × 0.25) + (Mention Sentiment × 0.25) + (Brand Rating × 0.25) | Goffman: Consistent=+20, Minor Gap=+15, Significant Gap=+5, Full Pivot=0 | Drift: Zero=+20, Minor=+15, Moderate=+5, Significant=0 | Sentiment: Positive=+20, Mixed=+10, Negative=0 | Rating: ≥4.0=+20, 3.0–3.9=+15, <3.0=+5",
    whyItMatters: "Single reputational incident from either party damages the other. Brand Safety Fit >80 = low risk. <50 = structural reputational risk; requires close monitoring.",
    dataPoints: ["Creator Goffman stage consistency", "Creator drift signal (keyword vocabulary shift %)", "Brand mention sentiment (positive/mixed/negative)", "Brand star rating (Google/Yelp/if available)"],
  },
  "Cultural Identity": {
    explanation: "Measures the depth of symbolic overlap between the creator's cultural vocabulary and the brand's cultural vocabulary.",
    formula: "Cultural Identity = (Symbolic Overlap % × 0.5) + (Shared Themes × 0.3) + (Archetype Resonance × 0.2) | Symbolic Overlap: >70%=100, 40–70%=70, <40%=30 | Archetype: Resonant=100, Complementary=70, Clashing=25",
    whyItMatters: "Shared symbolic language is foundation of authentic partnership. Cultural Identity >75 = natural collaboration. <50 = forced partnership, audiences perceive as paid placement.",
    dataPoints: ["Creator decoded symbols from transcripts", "Brand decoded symbols from positioning", "Shared keywords (cosine similarity)", "Shared themes (LLM extraction)", "Archetype compatibility matrix"],
  },
  "Cultural Momentum": {
    explanation: "Measures whether the creator's cultural trajectory is accelerating, stable, or declining and aligns with brand growth direction.",
    formula: "Cultural Momentum = (Rogers Stage × 0.6) + (Liminal Phase × 0.4) | Rogers: Innovator=80, Early Adopter=95, Early Majority=100, Late Majority=70, Laggard=40 | Liminal: Ascending=+20, Peak=+10, Stable=0, Descending=-20, Declining=-40",
    whyItMatters: "Creator at Early Majority (100 pts) + brand entering market = strong match. Declining creator (40 pts) + brand seeking growth = weak match. Momentum alignment determines partnership longevity.",
    dataPoints: ["Rogers adopter stage (from niche positioning)", "Liminal phase (from keyword drift + engagement trend)", "Follower growth trajectory", "Engagement trend direction"],
  },
  "Partnership Stability": {
    explanation: "Measures the structural stability of the partnership over time — whether both parties have consistent identities that won't drift or conflict.",
    formula: "Partnership Stability = (Creator Goffman × 0.4) + (Drift Signal × 0.3) + (Brand Goffman × 0.3) | Goffman: Consistent=100, Minor Gap=80, Significant Gap=50, Full Pivot=20 | Drift: Zero=100, Minor=80, Moderate=50, Significant=20, Major=5",
    whyItMatters: "Long-term partnerships require both parties to remain consistent. Stability >80 = partnership can be renewed/extended. <50 = high risk of identity conflict or audience confusion after 6 months.",
    dataPoints: ["Creator Goffman stage consistency (6+ month tracking)", "Creator drift signal (keyword vocabulary shift %)", "Brand Goffman gap score", "Follower growth trajectory"],
  },
};

export const SignalPanel: React.FC<SignalPanelProps> = ({
  signals,
  caiScore,
  caiStatus,
}) => {
  const performanceSignals = signals.filter((s) => s.category === "Performance");
  const culturalSignals = signals.filter((s) => s.category === "Cultural");

  return (
    <div className="space-y-6">
      {/* Cultural Match Score Header */}
      <Card className={`p-6 border-2 ${getStatusColor(caiStatus)}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Cultural Match Score
            </h2>
            <p className="text-sm text-gray-600 mt-1">{caiStatus}</p>
          </div>
          <div className="text-right">
            <div className={`text-5xl font-bold ${getStatusTextColor(caiStatus)}`}>
              {caiScore.toFixed(2)}
            </div>
            <p className="text-xs text-gray-600 mt-1">/ 10</p>
          </div>
        </div>
      </Card>

      {/* Performance Signals */}
      {performanceSignals.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">
            Performance Signals
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {performanceSignals.map((signal, idx) => {
              const def = SIGNAL_DEFINITIONS[signal.name];
              return (
                <Card key={idx} className="p-4 hover:shadow-md transition-shadow bg-gray-900 border-gray-700">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-white">{signal.name}</h4>
                        {def && (
                          <MetricTooltip
                            title={signal.name}
                            explanation={def.explanation}
                            formula={def.formula}
                            whyItMatters={def.whyItMatters}
                            dataPoints={def.dataPoints}
                            side="top"
                          />
                        )}
                      </div>
                      <Badge variant={getConfidenceBadgeVariant(signal.confidence)}>
                        {signal.confidence}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-full rounded-full transition-all ${getScoreColor(signal.score).replace("text-", "bg-")}`}
                          style={{ width: `${signal.score}%` }}
                        />
                      </div>
                      <span className={`text-lg font-bold ${getScoreColor(signal.score)}`}>
                        {signal.score.toFixed(2)}
                      </span>
                    </div>

                    <p className="text-sm text-gray-300">{signal.reasoning}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Cultural Signals */}
      {culturalSignals.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">
            Cultural Signals
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {culturalSignals.map((signal, idx) => {
              const def = SIGNAL_DEFINITIONS[signal.name];
              return (
                <Card key={idx} className="p-4 hover:shadow-md transition-shadow bg-gray-900 border-gray-700">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-white">{signal.name}</h4>
                        {def && (
                          <MetricTooltip
                            title={signal.name}
                            explanation={def.explanation}
                            formula={def.formula}
                            whyItMatters={def.whyItMatters}
                            dataPoints={def.dataPoints}
                            side="top"
                          />
                        )}
                      </div>
                      <Badge variant={getConfidenceBadgeVariant(signal.confidence)}>
                        {signal.confidence}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-full rounded-full transition-all ${getScoreColor(signal.score).replace("text-", "bg-")}`}
                          style={{ width: `${signal.score}%` }}
                        />
                      </div>
                      <span className={`text-lg font-bold ${getScoreColor(signal.score)}`}>
                        {signal.score.toFixed(2)}
                      </span>
                    </div>

                    <p className="text-sm text-gray-300">{signal.reasoning}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
