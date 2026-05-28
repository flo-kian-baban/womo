import React from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MetricTooltipProps {
  title: string;
  explanation: string;
  formula?: string;
  whyItMatters?: string;
  dataPoints?: string[];
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

export function MetricTooltip({
  title,
  explanation,
  formula,
  whyItMatters,
  dataPoints,
  className = "",
  side = "right",
}: MetricTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex-shrink-0 ${className}`}
            aria-label={`Information about ${title}`}
          >
            <Info className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-sm w-80 p-0 overflow-hidden">
          <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-slate-800 border-b border-slate-700">
              <h4 className="font-semibold text-sm text-white">{title}</h4>
            </div>
            <div className="px-4 py-3 space-y-3">
              {/* What it is */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">What it is</p>
                <p className="text-xs text-slate-200 leading-relaxed">{explanation}</p>
              </div>
              {/* How it's calculated */}
              {formula && (
                <div className="pt-2 border-t border-slate-700">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">How it's calculated</p>
                  <p className="text-xs font-mono text-slate-300 leading-relaxed">{formula}</p>
                </div>
              )}
              {/* Why it matters */}
              {whyItMatters && (
                <div className="pt-2 border-t border-slate-700">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Why it matters</p>
                  <p className="text-xs text-slate-200 leading-relaxed">{whyItMatters}</p>
                </div>
              )}
              {/* Data sources */}
              {dataPoints && dataPoints.length > 0 && (
                <div className="pt-2 border-t border-slate-700">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Data sources</p>
                  <ul className="text-xs text-slate-300 space-y-0.5">
                    {dataPoints.map((point, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-slate-500 mt-0.5">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
