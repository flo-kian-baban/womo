import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
            {performanceSignals.map((signal, idx) => (
              <Card key={idx} className="p-4 hover:shadow-md transition-shadow bg-gray-900 border-gray-700">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium text-white">{signal.name}</h4>
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
            ))}
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
            {culturalSignals.map((signal, idx) => (
              <Card key={idx} className="p-4 hover:shadow-md transition-shadow bg-gray-900 border-gray-700">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium text-white">{signal.name}</h4>
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
