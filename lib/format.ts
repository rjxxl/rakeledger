import Decimal from "decimal.js";

export function formatMoney(amount: Decimal | string | number): string {
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  const sign = d.isNegative() ? "-" : "";
  const abs = d.abs();
  return `${sign}$${abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function formatMoneySigned(amount: Decimal | string | number): string {
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  if (d.isPositive() && !d.isZero()) return `+${formatMoney(d)}`;
  return formatMoney(d);
}
