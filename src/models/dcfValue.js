// Pure DCF valuation formula, shared by the DCF model and its scenario / sensitivity views.
//
//   Projected FCF             FCF_t = FCF_0 · (1 + g)^t,   t = 1..N
//   PV of projections         PV = Σ FCF_t / (1 + r)^t
//   Terminal value (Gordon)   TV = FCF_N · (1 + g_T) / (r − g_T),   requires r > g_T
//   PV of terminal value      PV_TV = TV / (1 + r)^N
//   Enterprise value          EV = PV + PV_TV
//   Equity value              Equity = EV + netDebtAdj        (netDebtAdj = Cash − Debt)
//   Intrinsic value / share   IV = Equity / SharesOutstanding

/** Returns null when the Gordon formula is undefined (r ≤ g_T). */
export function dcfValue({ fcf0, g, r, gT, years, netDebtAdj, shares }) {
  if (!(r > gT)) return null;
  let pv = 0;
  let fcfT = fcf0;
  for (let t = 1; t <= years; t++) {
    fcfT = fcf0 * Math.pow(1 + g, t);
    pv += fcfT / Math.pow(1 + r, t);
  }
  const tv = (fcfT * (1 + gT)) / (r - gT);
  const pvTv = tv / Math.pow(1 + r, years);
  const ev = pv + pvTv;
  const equity = ev + netDebtAdj;
  return { pv, tv, pvTv, ev, equity, perShare: equity / shares, fcfFinal: fcfT };
}

/** FCF path for charts: index 0 is the last actual year. */
export function projectFcf(fcf0, g, years, baseYear) {
  const out = [];
  for (let t = 0; t <= years; t++) out.push({ year: `FY${baseYear + t}${t === 0 ? ' (actual)' : ''}`, fcf: fcf0 * Math.pow(1 + g, t), projected: t > 0 });
  return out;
}
