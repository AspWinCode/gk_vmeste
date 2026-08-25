/**
 * Расчёт ТЭПов и IRR/NPV "с нуля" (по требованию анкеты — рабочей Excel-модели нет).
 * Допущения, которые стоит явно проверять при использовании реальных цифр:
 *  - затраты распределены равномерно по месяцам стройки;
 *  - выручка поступает в последние 3 месяца (раскрытие эскроу-счетов при вводе объекта —
 *    стандартная схема 214-ФЗ, упомянутая в контексте компании);
 *  - IRR — доходность проекта без учёта кредитного плеча (unlevered project IRR);
 *  - ставка дисконтирования для NPV — 15% годовых (см. ANNUAL_DISCOUNT_RATE), задать иную
 *    можно централизованно здесь до появления отдельного поля ввода на фронтенде.
 */
export interface ScenarioInput {
  saleAreaSqm: number;
  pricePerSqm: number;
  costPerSqm: number;
  durationMonths: number;
}

export interface ScenarioMetrics {
  revenue: number;
  costs: number;
  margin: number; // доля, 0..1
  irr: number | null; // годовая, доля
  npv: number;
  paybackMonths: number | null;
  monthlyCashFlow: number[];
}

const ANNUAL_DISCOUNT_RATE = 0.15;

function monthlyRate(annualRate: number): number {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

function npvOf(cashFlows: number[], rate: number): number {
  return cashFlows.reduce((sum, cf, month) => sum + cf / Math.pow(1 + rate, month), 0);
}

// IRR методом Ньютона по месячному денежному потоку, с fallback на бисекцию при расхождении.
function computeIrrMonthly(cashFlows: number[]): number | null {
  let rate = 0.02;
  for (let i = 0; i < 100; i++) {
    const npv = npvOf(cashFlows, rate);
    const derivative = cashFlows.reduce(
      (sum, cf, month) => sum - (month * cf) / Math.pow(1 + rate, month + 1),
      0
    );
    if (Math.abs(derivative) < 1e-9) break;
    const nextRate = rate - npv / derivative;
    if (!Number.isFinite(nextRate) || nextRate <= -0.99) break;
    if (Math.abs(nextRate - rate) < 1e-7) return nextRate;
    rate = nextRate;
  }

  // Бисекция как страховка, если метод Ньютона не сошёлся.
  let lo = -0.5;
  let hi = 5;
  const npvLo = npvOf(cashFlows, lo);
  const npvHi = npvOf(cashFlows, hi);
  if (Math.sign(npvLo) === Math.sign(npvHi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvOf(cashFlows, mid);
    if (Math.abs(npvMid) < 1e-3) return mid;
    if (Math.sign(npvMid) === Math.sign(npvLo)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Строит помесячный CF: затраты равномерно на протяжении срока стройки; выручка — в
// последних 3 месяцах (раскрытие эскроу при вводе объекта, типично для 214-ФЗ),
// а не по мере продаж — так девелопер фактически получает деньги.
function buildMonthlyCashFlow(revenue: number, costs: number, durationMonths: number): number[] {
  const cf = new Array(durationMonths + 1).fill(0);
  const monthlyCost = costs / durationMonths;
  for (let m = 1; m <= durationMonths; m++) cf[m] -= monthlyCost;

  const escrowReleaseMonths = Math.min(3, durationMonths);
  const salesStartMonth = durationMonths - escrowReleaseMonths + 1;
  const monthlyRevenue = revenue / escrowReleaseMonths;
  for (let m = salesStartMonth; m <= durationMonths; m++) cf[m] += monthlyRevenue;

  return cf;
}

// Первый месяц, когда накопленный CF возвращается в ноль ПОСЛЕ того, как ушёл в минус
// (иначе тривиальный "payback = 0" на пустом первом месяце с CF=0).
function computePaybackMonths(cashFlow: number[]): number | null {
  let cumulative = 0;
  let wasNegative = false;
  for (let m = 0; m < cashFlow.length; m++) {
    cumulative += cashFlow[m];
    if (cumulative < 0) wasNegative = true;
    else if (wasNegative) return m;
  }
  return null;
}

export function computeScenarioMetrics(input: ScenarioInput): ScenarioMetrics {
  const revenue = input.saleAreaSqm * input.pricePerSqm;
  const costs = input.saleAreaSqm * input.costPerSqm;
  const margin = revenue > 0 ? (revenue - costs) / revenue : 0;

  const monthlyCashFlow = buildMonthlyCashFlow(revenue, costs, input.durationMonths);

  const irrMonthly = computeIrrMonthly(monthlyCashFlow);
  const irr = irrMonthly !== null ? Math.pow(1 + irrMonthly, 12) - 1 : null;

  const npv = npvOf(monthlyCashFlow, monthlyRate(ANNUAL_DISCOUNT_RATE));
  const paybackMonths = computePaybackMonths(monthlyCashFlow);

  return { revenue, costs, margin, irr, npv, paybackMonths, monthlyCashFlow };
}
