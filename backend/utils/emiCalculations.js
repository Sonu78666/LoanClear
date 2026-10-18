// Pure EMI / amortization math shared conceptually with the frontend.

function computeEMI(principal, annualRate, tenureYears) {
  const r = annualRate / 12 / 100;
  const n = tenureYears * 12;
  if (r === 0) return principal / n;
  const pow = Math.pow(1 + r, n);
  return (principal * r * pow) / (pow - 1);
}

function buildAmortizationSchedule(principal, annualRate, tenureYears) {
  const r = annualRate / 12 / 100;
  const n = tenureYears * 12;
  const emi = computeEMI(principal, annualRate, tenureYears);

  let balance = principal;
  const monthly = [];
  for (let month = 1; month <= n; month++) {
    const interest = balance * r;
    let principalPaid = emi - interest;
    if (principalPaid > balance) principalPaid = balance;
    balance -= principalPaid;
    if (balance < 0) balance = 0;
    monthly.push({ month, interest, principalPaid, balance, emi });
    if (balance <= 0) break;
  }
  return { emi, monthly };
}

function yearlyFromMonthly(monthly) {
  const years = [];
  for (let i = 0; i < monthly.length; i += 12) {
    const chunk = monthly.slice(i, i + 12);
    const principalPaid = chunk.reduce((s, m) => s + m.principalPaid, 0);
    const interestPaid = chunk.reduce((s, m) => s + m.interest, 0);
    years.push({
      year: years.length + 1,
      principalPaid,
      interestPaid,
      totalPaid: principalPaid + interestPaid,
      closingBalance: chunk[chunk.length - 1].balance,
    });
  }
  return years;
}

/**
 * Simulates a loan with optional prepayment strategies.
 * options: { lumpSum, lumpSumMonth, extraMonthly, annualHikePercent, annualLumpSum }
 * annualLumpSum is a recurring extra payment applied at the end of every 12th month
 * (e.g. "₹3 lakh extra every year"), distinct from the one-time `lumpSum`.
 */
function simulateWithPrepayment(principal, annualRate, tenureYears, options = {}) {
  const { lumpSum = 0, lumpSumMonth = 0, extraMonthly = 0, annualHikePercent = 0, annualLumpSum = 0 } = options;
  const r = annualRate / 12 / 100;
  const baseN = tenureYears * 12;
  const baseEmi = computeEMI(principal, annualRate, tenureYears);

  let balance = principal;
  let currentEmi = baseEmi;
  let month = 0;
  let totalInterest = 0;
  const maxMonths = baseN + 12; // safety cap, prepayment can only shorten
  const monthly = [];

  while (balance > 1 && month < maxMonths) {
    month++;

    // annual EMI hike applied at the start of each new year (after month 12, 24, ...)
    if (annualHikePercent > 0 && month > 1 && (month - 1) % 12 === 0) {
      currentEmi = currentEmi * (1 + annualHikePercent / 100);
    }

    const interest = balance * r;
    let payment = currentEmi + extraMonthly;
    let principalPaid = payment - interest;

    if (month === lumpSumMonth && lumpSum > 0) {
      principalPaid += lumpSum;
    }

    if (annualLumpSum > 0 && month % 12 === 0) {
      principalPaid += annualLumpSum;
    }

    if (principalPaid > balance) principalPaid = balance;
    if (principalPaid < 0) principalPaid = 0;

    balance -= principalPaid;
    totalInterest += interest;
    monthly.push({ month, interest, principalPaid, balance });

    if (balance <= 0) {
      balance = 0;
      break;
    }
  }

  return {
    months: month,
    years: month / 12,
    totalInterest,
    totalPayment: principal + totalInterest,
    monthly,
  };
}

function formatINR(amount) {
  const abs = Math.abs(amount);
  if (abs >= 1e7) return `₹${(amount / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(amount / 1e5).toFixed(1)}L`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

module.exports = {
  computeEMI,
  buildAmortizationSchedule,
  yearlyFromMonthly,
  simulateWithPrepayment,
  formatINR,
};
