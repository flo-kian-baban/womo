import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface LocalResonanceProps {
  creatorRegion: string;
  creatorLanguage: string;
  brandRegion: string;
  brandLanguage: string;
  geoMatch: 'exact' | 'regional' | 'cultural' | 'none';
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
  const geoMatchLabels = {
    exact: '🎯 Exact Geographic Match',
    regional: '🌍 Regional Alignment',
    cultural: '🗣️ Cultural/Language Alignment',
    none: '❌ Geographic Mismatch',
  };

  const geoMatchColors = {
    exact: 'bg-green-100 text-green-800',
    regional: 'bg-blue-100 text-blue-800',
    cultural: 'bg-purple-100 text-purple-800',
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
              <div className="text-sm">
                <span className="text-gray-600">Language:</span> <strong>{creatorLanguage}</strong>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Brand Audience</h4>
            <div className="space-y-1">
              <div className="text-sm">
                <span className="text-gray-600">Region:</span> <strong>{brandRegion}</strong>
              </div>
              <div className="text-sm">
                <span className="text-gray-600">Language:</span> <strong>{brandLanguage}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <Badge className={geoMatchColors[geoMatch]}>
              {geoMatchLabels[geoMatch]}
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
          {geoMatch === 'cultural' && (
            <>
              ✓ Creator and brand share cultural/language alignment. Audience may be diaspora or
              culturally-aligned communities.
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
