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
  /** Prefill from an example or a link. Never submits; clears any previous error. */
  fill(values: Partial<ClaimInput>): void;
  values(): ClaimInput;
  /** Same path as pressing the button, so validation and the busy guard still apply. */
  submit(): void;
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
  const summary = el("p", { class: "form-summary", role: "alert" });
  const [hashRow, ...optionalRows] = rows;
  // The hash is the one required thing; the buyer's claims are optional and start tucked away.
  const details = el("details", { class: "claim-details" }, el("summary", {}, "Add what the buyer claims (optional)"), ...optionalRows);
  const form = el(
    "form",
    { novalidate: true, "aria-label": "Payment claim" },
    el("div", { class: "intake" }, hashRow!, button),
    details,
    summary,
  );
  const values = (): ClaimInput => ({
    transactionHash: inputs.get("transactionHash")!.value,
    sender: inputs.get("sender")!.value,
    recipient: inputs.get("recipient")!.value,
    asset: inputs.get("asset")!.value,
    amountBaseUnits: inputs.get("amountBaseUnits")!.value,
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
    if (button.getAttribute("aria-disabled") === "true") return;
    let firstInvalid: HTMLInputElement | null = null;
    const invalidLabels: string[] = [];
    for (const spec of FIELDS) {
      const input = inputs.get(spec.name)!;
      const message = validateField(spec, input.value);
      showError(spec, message);
      if (message !== null) {
        invalidLabels.push(spec.label.replace(/ \(optional\)$/, ""));
        if (firstInvalid === null) firstInvalid = input;
      }
    }
    summary.textContent = invalidLabels.length === 0 ? "" : `Nothing was checked. Fix ${invalidLabels.length === 1 ? "this field" : "these fields"}: ${invalidLabels.join(", ")}.`;
    if (firstInvalid !== null) {
      // A field inside the closed disclosure cannot take focus until it is open.
      if (details.contains(firstInvalid)) details.open = true;
      firstInvalid.focus();
      return;
    }
    onSubmit(values());
  });

  return {
    element: form,
    setBusy(busy: boolean) {
      if (busy) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
      button.textContent = busy ? "Checking…" : "Check payment";
    },
    fill(next) {
      for (const spec of FIELDS) {
        const value = next[spec.name];
        if (value === undefined) continue;
        inputs.get(spec.name)!.value = value;
        showError(spec, null);
      }
      summary.textContent = "";
      if (optionalRows.length > 0 && (["sender", "recipient", "asset", "amountBaseUnits"] as const).some((name) => inputs.get(name)!.value !== "")) {
        details.open = true;
      }
    },
    values,
    submit() {
      form.requestSubmit();
    },
  };
}
