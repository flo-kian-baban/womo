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
  dataPoints?: string[];
  className?: string;
}

export function MetricTooltip({
  title,
  explanation,
  formula,
  dataPoints,
  className = "",
}: MetricTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors ${className}`}
            aria-label={`Information about ${title}`}
          >
            <Info className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">{title}</h4>
            <p className="text-xs text-slate-200">{explanation}</p>
            {formula && (
              <div className="pt-2 border-t border-slate-600">
                <p className="text-xs font-mono text-slate-300">{formula}</p>
              </div>
            )}
            {dataPoints && dataPoints.length > 0 && (
              <div className="pt-2 border-t border-slate-600">
                <p className="text-xs font-semibold mb-1">Data Sources:</p>
                <ul className="text-xs text-slate-300 space-y-1">
                  {dataPoints.map((point, idx) => (
                    <li key={idx}>• {point}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
