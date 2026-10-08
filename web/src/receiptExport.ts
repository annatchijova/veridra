import type { Assurance } from "./verify.js";

const FILE_TAG: Record<Assurance, string> = {
  RPC_ATTESTED: "rpc-attested",
  RPC_REPORTED_RECENT_INCLUSION_ACCEPTED: "recent",
  RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED: "historical",
};

export function receiptFilename(transactionHash: string, assurance: Assurance): string {
  return `veridra-receipt-${FILE_TAG[assurance]}-${transactionHash.slice(2, 10).toLowerCase()}.json`;
}

/** Downloads the exact portable receipt string the check was built from; nothing is re-serialized. */
export function downloadReceipt(serialized: string, transactionHash: string, assurance: Assurance): void {
  const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = receiptFilename(transactionHash, assurance);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
