const SIGNIFICANT = 12;

function expand(text: string): string {
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!m) return text;
  const digits = `${m[1]}${m[2] ?? ""}`;
  const point = (m[1] as string).length + Number(m[3]);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function trim(text: string): string {
  if (!text.includes(".")) return text.replace(/^0+(?=\d)/, "");
  return text
    .replace(/^0+(?=\d)/, "")
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function decimalText(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`not a price: ${value}`);
  if (value === 0) return "0";
  return trim(expand(Number(value.toPrecision(SIGNIFICANT)).toString()));
}

function parts(text: string): { digits: bigint; scale: number } {
  const [whole = "0", fraction = ""] = text.split(".");
  return { digits: BigInt(`${whole}${fraction}` || "0"), scale: fraction.length };
}

function render(digits: bigint, scale: number): string {
  const s = digits.toString().padStart(scale + 1, "0");
  return trim(scale === 0 ? s : `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`);
}

export function multiplyDecimal(text: string, factor: number): string {
  const a = parts(text);
  const b = parts(decimalText(factor));
  return render(a.digits * b.digits, a.scale + b.scale);
}
