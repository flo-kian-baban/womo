import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

export interface ComparisonMatch {
  creatorHandle: string;
  creatorArchetype: string;
  brandName: string;
  brandArchetype: string;
  caiScore: number;
  caiStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
  alignmentScore: number;
  pulseScore: number;
  stabilityScore: number;
  parrScore: number;
  qovScore: number;
  keyReasons: string[];
}

interface CreatorComparisonViewProps {
  matches: ComparisonMatch[];
  title?: string;
}

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

const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" => {
  switch (status) {
    case "Green Light":
      return "default";
    case "Proceed with Caution":
      return "secondary";
    case "Do Not Proceed":
      return "outline";
    default:
      return "secondary";
  }
};

const getScoreColor = (score: number) => {
  if (score >= 7.5) return "text-green-600";
  if (score >= 5.0) return "text-yellow-600";
  return "text-red-600";
};

export const CreatorComparisonView: React.FC<CreatorComparisonViewProps> = ({
  matches,
  title = "Creator-Brand Match Comparison",
}) => {
  // Sort matches by CAI score descending
  const sortedMatches = [...matches].sort((a, b) => b.caiScore - a.caiScore);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-600 mt-1">
          {sortedMatches.length} creator-brand pair{sortedMatches.length !== 1 ? "s" : ""} analyzed
        </p>
      </div>

      <div className="space-y-4">
        {sortedMatches.map((match, idx) => (
          <Card
            key={idx}
            className={`p-6 border-2 transition-all hover:shadow-lg ${getStatusColor(match.caiStatus)}`}
          >
            {/* Layer 1: Match Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
              <div className="flex items-center gap-4 flex-1">
                <div>
                  <p className="text-sm text-gray-600">Creator</p>
                  <p className="font-semibold text-gray-900">@{match.creatorHandle}</p>
                  <p className="text-xs text-gray-500">{match.creatorArchetype}</p>
                </div>

                <ArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />

                <div>
                  <p className="text-sm text-gray-600">Brand</p>
                  <p className="font-semibold text-gray-900">{match.brandName}</p>
                  <p className="text-xs text-gray-500">{match.brandArchetype}</p>
                </div>
              </div>

              <div className="text-right">
                <div className={`text-3xl font-bold ${getScoreColor(match.caiScore)}`}>
                  {match.caiScore.toFixed(1)}
                </div>
                <Badge variant={getStatusBadgeVariant(match.caiStatus)} className="mt-2">
                  {match.caiStatus}
                </Badge>
              </div>
            </div>

            {/* Layer 2: Signal Breakdown */}
            <div className="grid grid-cols-3 gap-4 mb-6 pb-6 border-b border-gray-200">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase">Alignment (α)</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${match.alignmentScore * 10}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-900">{match.alignmentScore.toFixed(1)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase">Pulse (β)</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{ width: `${match.pulseScore * 10}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-900">{match.pulseScore.toFixed(1)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase">Stability (γ)</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="h-full rounded-full bg-yellow-500"
                      style={{ width: `${match.stabilityScore * 10}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-900">{match.stabilityScore.toFixed(1)}</span>
                </div>
              </div>
            </div>

            {/* Layer 3: Key Metrics & Reasoning */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">PARR</p>
                <p className="text-lg font-bold text-gray-900">{match.parrScore.toFixed(0)}%</p>
                <p className="text-xs text-gray-500">Audience Receptivity</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">QoV</p>
                <p className="text-lg font-bold text-gray-900">{match.qovScore.toFixed(1)}%</p>
                <p className="text-xs text-gray-500">Quality of View</p>
              </div>
            </div>

            {/* Key Reasons */}
            {match.keyReasons.length > 0 && (
              <div className="pt-4 border-t border-gray-200">
                <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Why This Match</p>
                <ul className="space-y-1">
                  {match.keyReasons.map((reason, ridx) => (
                    <li key={ridx} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-gray-400 flex-shrink-0">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        ))}
      </div>

      {sortedMatches.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-gray-600">No matches to display. Analyze creators and brands to generate comparisons.</p>
        </Card>
      )}
    </div>
  );
};
