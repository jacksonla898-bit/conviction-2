// Display vocabulary: score labels, score colours and plain-English metric names.
// Scores and formulas are untouched; this file only decides what words appear on screen.

/** Score bands are unchanged (0–39, 40–59, 60–79, 80–100); the words shown are Weak / Neutral / Strong / Very Strong. */
export const LABEL_TEXT = { Low: 'Weak', Neutral: 'Neutral', High: 'Strong', 'Very High': 'Very Strong', Weak: 'Weak', Strong: 'Strong', 'Very Strong': 'Very Strong' };
export const SCORE_BANDS = '0–39 Weak · 40–59 Neutral · 60–79 Strong · 80–100 Very Strong';

export function labelText(label) {
  return LABEL_TEXT[label] || label || '—';
}

/** CSS colour for a score (red / amber / green). Reserved for scores. */
export function scoreColor(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return 'var(--muted)';
  if (score < 40) return 'var(--score-bad)';
  if (score < 60) return 'var(--score-warn)';
  return 'var(--score-good)';
}

/** Colour by label (works for both the internal and the displayed words). */
export function labelColor(label) {
  switch (label) {
    case 'Low': case 'Weak': return 'var(--score-bad)';
    case 'Neutral': return 'var(--score-warn)';
    case 'High': case 'Strong': case 'Very High': case 'Very Strong': return 'var(--score-good)';
    default: return 'var(--muted)';
  }
}

/** Tailwind classes for a score chip. */
export function scoreClass(s) {
  if (s === null || s === undefined) return 'bg-surface-2 text-muted';
  if (s < 40) return 'bg-bad/15 text-bad';
  if (s < 60) return 'bg-warn/15 text-warn';
  return 'bg-good/15 text-good';
}

/**
 * Plain-English names for metrics. Key = the technical label used in the code; value = [plain label, technical name].
 * The technical name is shown in a tooltip.
 */
const PLAIN = {
  'Max drawdown': ['Worst drop from peak', 'max drawdown'],
  'Max drawdown (5y)': ['Worst drop from peak, 5 years', 'max drawdown'],
  'Beta vs SPY': ['How much it moves with the market', 'beta vs SPY'],
  Beta: ['How much it moves with the market', 'beta'],
  'Annual volatility': ['How much it swings in a year', 'annualized volatility'],
  Volatility: ['How much it swings', 'annualized volatility'],
  'Annual vol σ': ['How much it swings in a year', 'annualized volatility σ'],
  Sharpe: ['Return per unit of risk', 'Sharpe ratio'],
  'Sharpe ratio': ['Return per unit of risk', 'Sharpe ratio'],
  'Ann. mean return': ['Average yearly return', 'annualized mean return'],
  'Annual mean return': ['Average yearly return', 'annualized mean return'],
  'Drawdown trough': ['Date of the worst point', 'drawdown trough date'],
  Trough: ['Date of the worst point', 'drawdown trough date'],
  'Drift μ': ['Assumed yearly drift', 'drift μ (annualized)'],
  'P(above today)': ['Chance of being higher in a year', 'P(price above today after 252 days)'],
  'Median in 1y': ['Typical price in a year', 'median simulated price, 1 year'],
  '5th–95th pct': ['Likely range (5th to 95th percentile)', '5th–95th percentile'],
  Paths: ['Simulated paths', 'Monte Carlo paths'],
  'Base fair value / share': ['Fair value per share (base case)', 'DCF intrinsic value'],
  Price: ['Price', 'latest close'],
  'Upside (Base)': ['Gap between fair value and price', 'DCF upside'],
  'FCF growth g': ['Assumed cash-flow growth', 'free-cash-flow growth g'],
  'Discount rate r': ['Required return used to discount', 'discount rate r (CAPM)'],
  'Terminal share of EV': ['Share of value from after year 5', 'terminal value share of enterprise value'],
  '12-1 momentum': ['Past-year price trend (skipping last month)', '12-1 momentum'],
  'vs SMA 50': ['Price vs 50-day average', 'distance from SMA 50'],
  'vs SMA 200': ['Price vs 200-day average', 'distance from SMA 200'],
  'RSI (14)': ['Recent buying vs selling pressure', 'RSI (14)'],
  Trend: ['Trend', 'position vs moving averages'],
  'Revenue (latest FY)': ['Sales, latest fiscal year', 'revenue'],
  'Revenue growth YoY': ['Sales growth, year over year', 'revenue growth YoY'],
  'Gross / Op / Net margin': ['Profit margins (gross / operating / net)', 'gross, operating and net margin'],
  'Debt / equity': ['Debt relative to equity', 'debt-to-equity'],
  'Current ratio': ['Short-term assets vs bills', 'current ratio'],
  'FCF (latest)': ['Free cash flow, latest', 'free cash flow'],
  'Beat rate': ['How often earnings beat estimates', 'EPS beat rate'],
  'Avg EPS surprise': ['Average earnings surprise', 'mean EPS surprise'],
  'Insider buys (6m)': ['Insider buying, 6 months', 'open-market insider purchases'],
  'Insider sells (6m)': ['Insider selling, 6 months', 'open-market insider sales'],
  'Net insider shares': ['Net insider buying', 'net insider shares (buys − sells)'],
  'Net ratio ρ': ['Insider buying balance', 'net ratio ρ = (buys − sells)/(buys + sells)'],
  'Expense ratio': ['Yearly fund fee', 'expense ratio'],
  'Avg daily $ volume (IEX)': ['Dollars traded per day (IEX)', 'average daily dollar volume, IEX feed'],
  'Avg shares/day (IEX)': ['Shares traded per day (IEX)', 'average daily share volume'],
  AUM: ['Fund size', 'assets under management'],
  'TTM distribution yield': ['Cash paid out over the past year, as % of price', 'trailing-12-month distribution yield'],
  'TTM cash per share': ['Cash paid per share, past year', 'trailing-12-month distributions'],
  'SEC 30-day yield': ['Standardized yield (SEC)', 'SEC 30-day yield'],
  Yield: ['Yield', 'yield to maturity'],
  'As of': ['As of', 'observation date'],
  'Empirical duration': ['Rate sensitivity (measured)', 'empirical duration'],
  'Effective duration (official)': ['Rate sensitivity (official)', 'effective duration'],
  'Modified duration': ['Rate sensitivity', 'modified duration'],
  'Macaulay duration': ['Average time to cash flows', 'Macaulay duration'],
  'Spread vs Treasury': ['Extra yield over Treasuries', 'spread vs matching Treasury'],
  'Matched tenor': ['Treasury used for comparison', 'matched tenor'],
  'Yield minus 3-month': ['Yield vs 3-month bills', 'curve slope vs 3-month'],
  '3-month yield': ['3-month bill yield', 'DGS3MO'],
  'Concentration (HHI)': ['How concentrated the holdings are', 'Herfindahl–Hirschman index'],
  'Average pairwise correlation': ['How much holdings move together', 'average pairwise correlation'],
  'Asset-class mix': ['Mix of asset classes', 'asset-class HHI'],
  '95% 1-day VaR': ['Typical bad day (95% VaR)', '95% one-day historical value at risk'],
  'Rate sensitivity (duration)': ['Rate sensitivity', 'duration'],
};

export function plainLabel(label) {
  const hit = PLAIN[label];
  return hit ? { text: hit[0], tech: hit[1] } : { text: label, tech: null };
}
