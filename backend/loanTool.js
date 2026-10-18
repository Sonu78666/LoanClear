const { simulateWithPrepayment } = require('./utils/emiCalculations');

// Formats with Indian digit grouping (e.g. 1058993 -> "₹10,58,993"), which the
// model was getting wrong when asked to insert the commas itself.
function formatRupeesFull(amount) {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

// A function tool the model calls to get exact loan math instead of estimating
// it in its own reasoning, which is unreliable for multi-year amortization.
const loanTools = [
  {
    type: 'function',
    function: {
      name: 'calculate_loan_scenario',
      description:
        "Runs the exact EMI/amortization calculation for a loan and returns precise figures. ALWAYS call this instead of estimating or doing mental math whenever the user asks for a specific number — EMI, total interest, interest saved, new payoff time/tenure, etc. — whether for the base loan (pass all zeros for lumpSum/extraMonthly/annualLumpSum/annualHikePercent) or for a prepayment strategy (lump sum, extra monthly payment, a recurring annual extra payment, and/or an annual EMI hike, alone or combined). By default it uses the user's current loan (amount/rate/tenure) from their loan context — set the override fields only if the user explicitly states a different loan amount, rate, or tenure in their message.",
      parameters: {
        type: 'object',
        properties: {
          loanAmountOverride: {
            type: 'number',
            description: 'Only set this if the user explicitly states a loan amount in their message that differs from their current loan context (in rupees). Leave at 0 to use their current loan amount.',
          },
          interestRateOverride: {
            type: 'number',
            description: 'Only set this if the user explicitly states an annual interest rate in their message that differs from their current loan context (as a percent, e.g. 7.5). Leave at 0 to use their current rate.',
          },
          tenureYearsOverride: {
            type: 'number',
            description: 'Only set this if the user explicitly states a loan tenure in their message that differs from their current loan context (in years). Leave at 0 to use their current tenure.',
          },
          lumpSum: {
            type: 'number',
            description:
              'A ONE-TIME extra payment made only once, in the single month given by lumpSumMonth — not repeated. Do NOT use this for a recurring/annual/every-year extra payment; use annualLumpSum for that instead. 0 if the user has no one-time lump sum.',
          },
          lumpSumMonth: { type: 'number', description: 'Month number (1-based) the one-time lumpSum is paid in. 0 if lumpSum is 0.' },
          extraMonthly: { type: 'number', description: 'Extra amount paid every single month on top of the regular EMI, in rupees. 0 if none.' },
          annualLumpSum: {
            type: 'number',
            description:
              'A RECURRING extra payment made once EVERY year (at the end of every 12-month period), for as long as the loan runs. Use this whenever the user says "extra every year", "annually", "each year", "yearly bonus towards the loan", etc. — not lumpSum, which is a single one-time payment. 0 if none.',
          },
          annualHikePercent: { type: 'number', description: 'Percent the EMI itself is increased by every 12 months (a growing EMI, not an extra payment). 0 if none.' },
        },
        // Intentionally no `required` list: Groq validates the model's generated tool
        // call against this schema and hard-rejects it (crashing the whole request)
        // if any required field is missing from a generation. Every field already
        // defaults safely to 0 (or the current loan) in runLoanScenarioTool below, so
        // an incomplete tool call should degrade gracefully instead of erroring out.
      },
    },
  },
];

// Pre-formats "X years Y months" so the model never has to do its own
// months-to-years-and-months conversion (it was getting this slightly wrong).
function formatDuration(totalMonths) {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return `${months} month${months === 1 ? '' : 's'}`;
  if (months === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years} year${years === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function runLoanScenarioTool(loanContext, args = {}) {
  // Same bounds as the /api/chat request validator for loanContext itself.
  const amount = Number(args.loanAmountOverride) > 0
    ? clamp(Number(args.loanAmountOverride), 100000, 100000000)
    : loanContext.amount;
  const rate = Number(args.interestRateOverride) > 0
    ? clamp(Number(args.interestRateOverride), 1, 30)
    : loanContext.rate;
  const tenure = Number(args.tenureYearsOverride) > 0
    ? clamp(Number(args.tenureYearsOverride), 1, 30)
    : loanContext.tenure;

  const options = {
    lumpSum: Number(args.lumpSum) || 0,
    lumpSumMonth: Number(args.lumpSumMonth) || 0,
    extraMonthly: Number(args.extraMonthly) || 0,
    annualLumpSum: Number(args.annualLumpSum) || 0,
    annualHikePercent: Number(args.annualHikePercent) || 0,
  };

  const base = simulateWithPrepayment(amount, rate, tenure, {});
  const scenario = simulateWithPrepayment(amount, rate, tenure, options);
  const monthsSaved = base.months - scenario.months;

  const interestSaved = base.totalInterest - scenario.totalInterest;

  return {
    loan_amount_used_rupees: Math.round(amount),
    loan_amount_used_formatted: formatRupeesFull(amount),
    interest_rate_used_percent: rate,
    tenure_years_used: tenure,
    base_total_interest_rupees: Math.round(base.totalInterest),
    base_total_interest_formatted: formatRupeesFull(base.totalInterest),
    base_payoff_months: base.months,
    base_payoff_duration: formatDuration(base.months),
    scenario_total_interest_rupees: Math.round(scenario.totalInterest),
    scenario_total_interest_formatted: formatRupeesFull(scenario.totalInterest),
    scenario_payoff_months: scenario.months,
    scenario_payoff_duration: formatDuration(scenario.months),
    interest_saved_rupees: Math.round(interestSaved),
    interest_saved_formatted: formatRupeesFull(interestSaved),
    months_saved: monthsSaved,
    months_saved_duration: formatDuration(monthsSaved),
  };
}

module.exports = { loanTools, runLoanScenarioTool };
