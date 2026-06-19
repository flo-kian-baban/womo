import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface LocalResonanceProps {
  creatorRegion: string;
  creatorLanguage?: string;
  brandRegion: string;
  brandLanguage?: string;
  geoMatch: 'exact' | 'regional' | 'cross-regional' | 'cultural' | 'global' | 'none';
  matchStrength: number; // 0-100
}

export function LocalResonanceSection({
  creatorRegion,
  creatorLanguage,
  brandRegion,
  brandLanguage,
  geoMatch,
  matchStrength,
}: LocalResonanceProps) {
  const geoMatchLabels: Record<string, string> = {
    exact: '🎯 Exact Geographic Match',
    regional: '🌍 Regional Alignment',
    'cross-regional': '🌐 Cross-Regional',
    cultural: '🗣️ Cultural/Language Alignment',
    global: '🌍 Global (No Regional Data)',
    none: '❌ Geographic Mismatch',
  };

  const geoMatchColors: Record<string, string> = {
    exact: 'bg-green-100 text-green-800',
    regional: 'bg-blue-100 text-blue-800',
    'cross-regional': 'bg-amber-100 text-amber-800',
    cultural: 'bg-purple-100 text-purple-800',
    global: 'bg-slate-100 text-slate-800',
    none: 'bg-gray-100 text-gray-800',
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🗺️ Local Resonance
        </CardTitle>
        <CardDescription>
          Geographic and cultural alignment between creator and brand audiences
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Creator Audience</h4>
            <div className="space-y-1">
              <div className="text-sm">
                <span className="text-gray-600">Region:</span> <strong>{creatorRegion}</strong>
              </div>
              {creatorLanguage && (
                <div className="text-sm">
                  <span className="text-gray-600">Language:</span> <strong>{creatorLanguage}</strong>
                </div>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Brand Audience</h4>
            <div className="space-y-1">
              <div className="text-sm">
                <span className="text-gray-600">Region:</span> <strong>{brandRegion}</strong>
              </div>
              {brandLanguage && (
                <div className="text-sm">
                  <span className="text-gray-600">Language:</span> <strong>{brandLanguage}</strong>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <Badge className={geoMatchColors[geoMatch] ?? geoMatchColors.none}>
              {geoMatchLabels[geoMatch] ?? geoMatchLabels.none}
            </Badge>
            <span className="text-sm font-semibold">{matchStrength}% Match</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
              style={{ width: `${matchStrength}%` }}
            />
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
          {geoMatch === 'exact' && (
            <>
              ✓ Creator's audience is concentrated in {creatorRegion}, matching brand's target market.
              This alignment increases message relevance and purchase intent.
            </>
          )}
          {geoMatch === 'regional' && (
            <>
              ✓ Creator's regional audience overlaps with brand's market. Audience shares similar
              cultural context and purchasing behaviors.
            </>
          )}
          {geoMatch === 'cross-regional' && (
            <>
              ⚡ Creator and brand operate in different regions ({creatorRegion} vs {brandRegion}).
              Cross-regional partnerships can work when cultural alignment is strong.
            </>
          )}
          {geoMatch === 'cultural' && (
            <>
              ✓ Creator and brand share cultural/language alignment. Audience may be diaspora or
              culturally-aligned communities.
            </>
          )}
          {geoMatch === 'global' && (
            <>
              ℹ️ No specific regional data available for either entity.
              Geographic alignment is not a factor in this match.
            </>
          )}
          {geoMatch === 'none' && (
            <>
              ⚠️ Creator's audience is geographically distinct from brand's market. Consider
              audience overlap in adjacent markets or diaspora communities.
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
