const SCALE = 12n;
const ONE = 10n ** SCALE;

export function decimalText(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`not a price: ${value}`);
  const plain = value.toString();
  if (!/e/i.test(plain)) return plain;
  return value.toFixed(Number(SCALE)).replace(/\.?0+$/, "");
}

function toScaled(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * ONE + BigInt((fraction + "0".repeat(Number(SCALE))).slice(0, Number(SCALE)) || "0");
}

function fromScaled(value: bigint): string {
  const whole = value / ONE;
  const fraction = (value % ONE).toString().padStart(Number(SCALE), "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function multiplyDecimal(text: string, factor: number): string {
  const scaledFactor = BigInt(Math.round(factor * 1000));
  return fromScaled((toScaled(text) * scaledFactor) / 1000n);
}
