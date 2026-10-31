import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export interface Signer {
  id: string;
  publicKey: string;
  sign: (body: Buffer) => string;
}

export function rawPublicKey(key: KeyObject): string {
  const der = createPublicKey(key).export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64");
}

export function signer(id: string, pem: string): Signer {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("the signing key must be an Ed25519 private key in PEM");
  return { id, publicKey: rawPublicKey(key), sign: (body) => sign(null, body, key).toString("base64") };
}

export function signatureHeader(s: Signer, body: Buffer): string {
  return `keyid=${s.id}, ed25519=${s.sign(body)}`;
}

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifySignature(header: string, body: Buffer, keys: Record<string, string>): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const at = p.indexOf("=");
      return [p.slice(0, at).trim(), p.slice(at + 1).trim()];
    }),
  );
  const raw = parts.keyid ? keys[parts.keyid] : undefined;
  if (!raw || !parts.ed25519) return false;
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(raw, "base64")]), format: "der", type: "spki" });
  return verify(null, body, key, Buffer.from(parts.ed25519, "base64"));
}
