import type { ClaimInput } from "./verify.js";

const KEYS: Record<keyof ClaimInput, string> = {
  transactionHash: "tx",
  sender: "sender",
  recipient: "recipient",
  asset: "asset",
  amountBaseUnits: "amount",
};
const MAX_PARAM_LENGTH = 100;

/** Reads a claim from a link. Values are only prefilled; the form still validates them and nothing runs by itself. */
export function readClaimFromSearch(search: string): Partial<ClaimInput> | null {
  const params = new URLSearchParams(search);
  const claim: Partial<ClaimInput> = {};
  for (const [field, key] of Object.entries(KEYS) as [keyof ClaimInput, string][]) {
    const value = params.get(key);
    if (value !== null && value.length <= MAX_PARAM_LENGTH) claim[field] = value;
  }
  return claim.transactionHash === undefined ? null : claim;
}

/** Only the fields the operator actually filled in go into the link. */
export function buildSearch(input: ClaimInput): string {
  const params = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS) as [keyof ClaimInput, string][]) {
    const value = input[field].trim();
    if (value !== "") params.set(key, value);
  }
  return `?${params.toString()}`;
}
