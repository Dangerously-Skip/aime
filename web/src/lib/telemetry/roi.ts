/**
 * ROI calculation utilities.
 */

export interface ROIResult {
  multiplier: number;
  dollarsSaved: number;
}

/**
 * Calculate ROI of agent work vs equivalent human effort.
 * @param humanHours - Estimated human hours to do the same work
 * @param agentCostDollars - Actual cost of the agent run
 * @param agentDurationMs - Actual wall-clock time of the agent run
 * @param devHourlyRate - Developer hourly rate in USD
 */
export function calcROI(
  humanHours: number,
  agentCostDollars: number,
  agentDurationMs: number,
  devHourlyRate: number,
): ROIResult {
  const humanCost = humanHours * devHourlyRate;
  const agentHours = agentDurationMs / 3_600_000;
  const multiplier = humanHours / Math.max(agentHours, 0.001);
  const dollarsSaved = humanCost - agentCostDollars;
  return {
    multiplier: Math.round(multiplier * 10) / 10,
    dollarsSaved: Math.round(dollarsSaved * 100) / 100,
  };
}
