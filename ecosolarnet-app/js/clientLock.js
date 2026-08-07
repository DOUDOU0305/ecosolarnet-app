const SHAKE_THRESHOLD = 18;
const SHAKE_COOLDOWN_MS = 1200;
const PERMISSION_KEY = "ecosolarnet-motion-granted";

let lastX = null;
let lastY = null;
let lastZ = null;
let lastShakeAt = 0;

function needsPermissionPrompt() {
  return typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function";
}

export function hasMotionPermission() {
  if (!needsPermissionPrompt()) return true;
  return localStorage.getItem(PERMISSION_KEY) === "1";
}

export async function requestMotionPermission() {
  if (!needsPermissionPrompt()) return true;
  try {
    const result = await DeviceMotionEvent.requestPermission();
    if (result === "granted") {
      localStorage.setItem(PERMISSION_KEY, "1");
      return true;
    }
  } catch {
    // ignore, laisse la permission non accordée
  }
  return false;
}

export function onShake(callback) {
  function handleMotion(e) {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;
    if (lastX != null) {
      const delta = Math.abs(acc.x - lastX) + Math.abs(acc.y - lastY) + Math.abs(acc.z - lastZ);
      const now = Date.now();
      if (delta > SHAKE_THRESHOLD && now - lastShakeAt > SHAKE_COOLDOWN_MS) {
        lastShakeAt = now;
        callback();
      }
    }
    lastX = acc.x;
    lastY = acc.y;
    lastZ = acc.z;
  }
  window.addEventListener("devicemotion", handleMotion);
  return () => window.removeEventListener("devicemotion", handleMotion);
}
