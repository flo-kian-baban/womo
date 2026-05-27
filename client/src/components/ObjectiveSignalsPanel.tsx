import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface ObjectiveSignal {
  category: 'Music' | 'Remix' | 'Growth' | 'Collaboration';
  metric: string;
  value: string | number;
  interpretation: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ObjectiveSignalsPanelProps {
  signals: ObjectiveSignal[];
  creatorHandle: string;
  brandName: string;
}

export function ObjectiveSignalsPanel({
  signals,
  creatorHandle,
  brandName,
}: ObjectiveSignalsPanelProps) {
  if (!signals || signals.length === 0) {
    return null;
  }

  const groupedSignals = signals.reduce((acc, signal) => {
    if (!acc[signal.category]) {
      acc[signal.category] = [];
    }
    acc[signal.category].push(signal);
    return acc;
  }, {} as Record<string, ObjectiveSignal[]>);

  const categoryIcons = {
    Music: '🎵',
    Remix: '🔄',
    Growth: '📈',
    Collaboration: '🤝',
  };

  const confidenceColors = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-orange-100 text-orange-800',
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          📊 Objective Signals
        </CardTitle>
        <CardDescription>
          Metadata evidence that corroborated the Cultural Alignment Index (CAI) for {creatorHandle} × {brandName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(groupedSignals).map(([category, categorySignals]) => (
          <div key={category} className="space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              {categoryIcons[category as keyof typeof categoryIcons]} {category}
            </h4>
            <div className="space-y-2 pl-4 border-l-2 border-gray-200">
              {categorySignals.map((signal, idx) => (
                <div key={idx} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{signal.metric}</span>
                    <Badge className={confidenceColors[signal.confidence]}>
                      {signal.confidence}
                    </Badge>
                  </div>
                  <div className="text-gray-600 mt-1">{signal.value}</div>
                  <div className="text-gray-500 text-xs mt-1 italic">
                    → {signal.interpretation}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
