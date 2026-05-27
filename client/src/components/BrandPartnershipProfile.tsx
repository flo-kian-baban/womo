import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface BrandSignal {
  name: string;
  score: number; // 0-100
  confidence: "Verified" | "Estimated" | "Insufficient Data";
  reasoning: string;
}

interface BrandPartnershipProfileProps {
  brandName: string;
  brandArchetype: string;
  signals: BrandSignal[];
  overallPartnershipScore: number;
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

export const BrandPartnershipProfile: React.FC<BrandPartnershipProfileProps> = ({
  brandName,
  brandArchetype,
  signals,
  overallPartnershipScore,
}) => {
  return (
    <div className="space-y-6">
      {/* Brand Header */}
      <Card className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{brandName}</h3>
            <p className="text-sm text-gray-600 mt-1">
              Brand Archetype: <span className="font-medium">{brandArchetype}</span>
            </p>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-bold ${getScoreColor(overallPartnershipScore)}`}>
              {overallPartnershipScore.toFixed(1)}
            </div>
            <p className="text-xs text-gray-600 mt-1">Partnership Score</p>
          </div>
        </div>
      </Card>

      {/* Brand Partnership Signals */}
      <div className="space-y-4">
        <h4 className="text-md font-semibold text-gray-900">Brand Partnership Readiness</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {signals.map((signal, idx) => (
            <Card key={idx} className="p-4 hover:shadow-md transition-shadow">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <h5 className="font-medium text-gray-900">{signal.name}</h5>
                  <Badge variant={getConfidenceBadgeVariant(signal.confidence)}>
                    {signal.confidence}
                  </Badge>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-full rounded-full transition-all ${getScoreColor(signal.score).replace("text-", "bg-")}`}
                      style={{ width: `${signal.score}%` }}
                    />
                  </div>
                  <span className={`text-lg font-bold ${getScoreColor(signal.score)}`}>
                    {signal.score.toFixed(1)}
                  </span>
                </div>

                <p className="text-sm text-gray-600">{signal.reasoning}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Partnership Insights */}
      <Card className="p-4 bg-blue-50 border-blue-200">
        <h5 className="font-medium text-gray-900 mb-2">Partnership Insights</h5>
        <ul className="text-sm text-gray-700 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span>This brand is positioned to work with creators who align with its core values and target audience.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span>Focus on creators whose audience demographics match the brand's target market.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span>Ensure creator tone and messaging can authentically represent the brand's positioning.</span>
          </li>
        </ul>
      </Card>
    </div>
  );
};
