// Génère un code QR (PNG en data URL) pour le texte donné, via la
// librairie vendue js/vendor/qrcode.min.js (window.QRCode).
export function generateQrDataUrl(text, size = 300) {
  return new Promise((resolve, reject) => {
    if (!window.QRCode) {
      reject(new Error("Librairie QR non chargée"));
      return;
    }
    try {
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      document.body.appendChild(container);
      new window.QRCode(container, {
        text,
        width: size,
        height: size,
        correctLevel: window.QRCode.CorrectLevel.M,
      });
      const canvas = container.querySelector("canvas");
      const dataUrl = canvas ? canvas.toDataURL("image/png") : null;
      document.body.removeChild(container);
      if (dataUrl) resolve(dataUrl);
      else reject(new Error("QR non généré"));
    } catch (e) {
      reject(e);
    }
  });
}
