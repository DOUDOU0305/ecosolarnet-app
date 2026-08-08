function stripAccentsForQr(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Format EPC QR Code (norme européenne pour les virements SEPA) : n'importe
// quelle appli bancaire en Europe sait scanner ce code pour pré-remplir un virement.
export function buildEpcQrPayload({ bic, name, iban, amount, remittance }) {
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    (bic || "").replace(/\s+/g, "").toUpperCase(),
    stripAccentsForQr(name).slice(0, 70),
    (iban || "").replace(/\s+/g, "").toUpperCase(),
    amount > 0 ? `EUR${amount.toFixed(2)}` : "",
    "",
    "",
    stripAccentsForQr(remittance).slice(0, 140),
  ];
  return lines.join("\n");
}
