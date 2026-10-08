import { InvalidPaymentClaimError } from "@veridra/monad-rpc";
import { buildClaim, type ClaimInput } from "./verify.js";
import { el } from "./ui.js";

type FieldName = keyof ClaimInput;

type FieldSpec = {
  name: FieldName;
  label: string;
  hint: string;
  required: boolean;
  invalidMessage: string;
};

const FIELDS: readonly FieldSpec[] = [
  {
    name: "transactionHash",
    label: "Transaction hash",
    hint: "0x followed by 64 hex characters, as shown by the buyer or a block explorer.",
    required: true,
    invalidMessage: "A transaction hash is 0x followed by exactly 64 hex characters.",
  },
  {
    name: "sender",
    label: "Sender (optional)",
    hint: "Leave empty if you don't know it. An empty field is not checked.",
    required: false,
    invalidMessage:
      "Not a valid address. It must be 0x followed by 40 hex characters; if it mixes upper and lower case, the capitalization must be exact.",
  },
  {
    name: "recipient",
    label: "Recipient (optional)",
    hint: "Leave empty if you don't know it. An empty field is not checked.",
    required: false,
    invalidMessage:
      "Not a valid address. It must be 0x followed by 40 hex characters; if it mixes upper and lower case, the capitalization must be exact.",
  },
  {
    name: "asset",
    label: "Asset address (optional)",
    hint: "Token contract address. Use 0x0000000000000000000000000000000000000000 for native MON. Empty is not checked.",
    required: false,
    invalidMessage:
      "Not a valid address. It must be 0x followed by 40 hex characters; if it mixes upper and lower case, the capitalization must be exact.",
  },
  {
    name: "amountBaseUnits",
    label: "Amount in base units (optional)",
    hint: "Whole number, digits only, no decimals or separators. For MON, base units are wei (1 MON = 1000000000000000000). Empty is not checked.",
    required: false,
    invalidMessage: "Use digits only: a whole number of base units, with no decimals, spaces or separators, and no leading zeros.",
  },
];

const VALID_HASH = `0x${"0".repeat(64)}`;

const EMPTY: ClaimInput = { transactionHash: "", sender: "", recipient: "", asset: "", amountBaseUnits: "" };

/** Returns an inline error message, or null when the field is acceptable. */
export function validateField(spec: FieldSpec, value: string): string | null {
  if (value.trim() === "") return spec.required ? "Enter the transaction hash." : null;
  try {
    buildClaim(spec.name === "transactionHash" ? { ...EMPTY, transactionHash: value } : { ...EMPTY, transactionHash: VALID_HASH, [spec.name]: value });
    return null;
  } catch (error) {
    if (error instanceof InvalidPaymentClaimError) return spec.invalidMessage;
    throw error;
  }
}

export type ClaimForm = {
  element: HTMLFormElement;
  setBusy(busy: boolean): void;
};

export function createClaimForm(onSubmit: (input: ClaimInput) => void): ClaimForm {
  const inputs = new Map<FieldName, HTMLInputElement>();
  const errors = new Map<FieldName, HTMLElement>();

  const showError = (spec: FieldSpec, message: string | null) => {
    const input = inputs.get(spec.name)!;
    const slot = errors.get(spec.name)!;
    slot.textContent = message ?? "";
    if (message === null) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  };

  const rows = FIELDS.map((spec) => {
    const id = `field-${spec.name}`;
    const input = el("input", {
      id,
      name: spec.name,
      type: "text",
      class: "mono",
      autocomplete: "off",
      spellcheck: "false",
      "aria-describedby": `${id}-hint ${id}-error`,
      "aria-required": spec.required ? "true" : false,
    });
    const error = el("p", { id: `${id}-error`, class: "field-error" });
    inputs.set(spec.name, input);
    errors.set(spec.name, error);
    input.addEventListener("blur", () => showError(spec, validateField(spec, input.value)));
    return el(
      "div",
      { class: "field" },
      el("label", { for: id }, spec.label),
      el("p", { id: `${id}-hint`, class: "hint" }, spec.hint),
      input,
      error,
    );
  });

  const button = el("button", { type: "submit" }, "Check payment");
  const form = el("form", { novalidate: true, "aria-label": "Payment claim" }, ...rows, button);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let firstInvalid: HTMLInputElement | null = null;
    for (const spec of FIELDS) {
      const input = inputs.get(spec.name)!;
      const message = validateField(spec, input.value);
      showError(spec, message);
      if (message !== null && firstInvalid === null) firstInvalid = input;
    }
    if (firstInvalid !== null) {
      firstInvalid.focus();
      return;
    }
    const value = (name: FieldName) => inputs.get(name)!.value;
    onSubmit({
      transactionHash: value("transactionHash"),
      sender: value("sender"),
      recipient: value("recipient"),
      asset: value("asset"),
      amountBaseUnits: value("amountBaseUnits"),
    });
  });

  return {
    element: form,
    setBusy(busy: boolean) {
      button.disabled = busy;
      button.textContent = busy ? "Checking…" : "Check payment";
    },
  };
}
