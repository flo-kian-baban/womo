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
    explanation: "Grades how consistently the creator's cultural identity aligns with this brand's world — whether both parties show up as genuine, coherent identities rather than performing a character.",
    formula: "Creator Goffman stage + Cultural capital type + Tone register + Brand mention sentiment + Brand Goffman consistency",
    whyItMatters: "A partnership where either party is performing inauthentically will be decoded by audiences as forced. High Identity Fit means the collaboration will feel natural, not transactional.",
    dataPoints: ["Creator Goffman stage consistency", "Cultural capital type (Produce/Relay/Remix)", "Tone register", "Brand mention sentiment", "Brand Goffman gap score"],
  },
  "Performance Fit": {
    explanation: "Grades how reliably this creator is likely to deliver active, engaged audiences based on their track record and lifecycle stage, and how structurally stable the brand is as a campaign partner.",
    formula: "Creator engagement rate tier + Lifecycle phase + Brand TikTok engagement rate + Brand star rating + Drift signal",
    whyItMatters: "Even a perfect cultural fit produces no value if the creator's audience is disengaged or the brand has no platform presence. This score flags structural performance risk before a campaign begins.",
    dataPoints: ["Creator engagement rate (per-video)", "Creator lifecycle phase", "Brand TikTok engagement rate", "Brand star rating (Google/Yelp)", "Creator drift signal"],
  },
  "Audience Fit": {
    explanation: "Grades how well the creator's actual community matches the people this brand needs to reach — based on audience tribe alignment, decoding behaviour, and geographic relevance.",
    formula: "PARR score × tribe alignment weight + Stuart Hall decoding modifier + Geographic overlap",
    whyItMatters: "Follower count is irrelevant if the followers are the wrong people. Audience Fit measures whether the creator's community is structurally the same community the brand is trying to reach.",
    dataPoints: ["PARR (Predicted Audience Receptivity Rate)", "Stuart Hall decoding mode", "Audience tribe classification", "Geographic relevance"],
  },
  "Receptivity Fit": {
    explanation: "Grades how likely the creator's audience is to accept and act on a brand message delivered through this creator — based on trust signals and audience decoding behaviour.",
    formula: "PARR score + QoV (Quality of View) modifier + Stuart Hall decoding acceptance rate",
    whyItMatters: "An audience can be the right demographic but still reject a brand message if they don't trust the creator's recommendations. Receptivity Fit measures whether the audience will accept the message as authentic.",
    dataPoints: ["PARR score", "QoV (Quality of View)", "Stuart Hall decoding mode", "Parasocial bond strength"],
  },
  "Brand Safety Fit": {
    explanation: "Grades how much mutual credibility exists between the creator and the brand — whether the creator is a stable, low-risk reputational partner and the brand has a positive public reputation.",
    formula: "Creator Goffman stage + Drift signal + Brand saturation flag + Brand mention sentiment + Brand star rating",
    whyItMatters: "A single reputational incident from either party can damage the other. Brand Safety Fit flags whether either party carries structural reputational risk before the partnership is announced.",
    dataPoints: ["Creator Goffman stage", "Creator drift signal", "Brand saturation flag", "Brand mention sentiment", "Brand star rating"],
  },
  "Cultural Identity": {
    explanation: "Measures the depth of symbolic overlap between the creator's cultural vocabulary and the brand's cultural vocabulary — how many of the same symbols, themes, and values they share.",
    formula: "Symbolic vocabulary overlap % + Shared theme count + Archetype resonance score",
    whyItMatters: "Shared symbolic language is the foundation of authentic partnership. When creator and brand speak the same cultural language, audiences perceive the collaboration as natural rather than paid.",
    dataPoints: ["Creator decoded symbols", "Brand decoded symbols", "Shared keywords", "Shared themes", "Archetype compatibility"],
  },
  "Cultural Momentum": {
    explanation: "Measures whether the creator's cultural trajectory is accelerating, stable, or declining — and whether that trajectory aligns with the brand's growth direction.",
    formula: "Rogers adoption stage + Liminal phase adjustment + Cultural velocity signal",
    whyItMatters: "A creator at the peak of cultural relevance and a brand trying to enter a new market are a stronger match than a declining creator and a brand seeking growth. Momentum alignment determines long-term partnership value.",
    dataPoints: ["Rogers adopter stage", "Turner liminal phase", "Cultural velocity (Focusing/Drifting)", "Lifecycle phase"],
  },
  "Partnership Stability": {
    explanation: "Measures the structural stability of the partnership over time — whether both the creator and brand have consistent, predictable identities that won't drift or conflict after launch.",
    formula: "Creator Goffman consistency + Drift signal average + Brand Goffman gap + Follower growth trajectory",
    whyItMatters: "Long-term ambassador partnerships require both parties to remain consistent. High stability means the partnership can be renewed and extended without risk of identity conflict or audience confusion.",
    dataPoints: ["Creator Goffman stage consistency", "Creator drift signal", "Brand Goffman gap", "Follower growth trajectory"],
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
      {/* CAI Score Header */}
      <Card className={`p-6 border-2 ${getStatusColor(caiStatus)}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Cultural Alignment Index (CAI)
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
