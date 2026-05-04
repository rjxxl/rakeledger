import { formatMoney, formatMoneySigned } from "@/lib/format";

interface MoneyProps {
  amount: string | number | { toString(): string };
  signed?: boolean;
  className?: string;
}

export function Money({ amount, signed = false, className }: MoneyProps) {
  const value = typeof amount === "string" || typeof amount === "number" ? amount : amount.toString();
  return (
    <span className={`font-mono tabular-nums ${className ?? ""}`}>
      {signed ? formatMoneySigned(value) : formatMoney(value)}
    </span>
  );
}
