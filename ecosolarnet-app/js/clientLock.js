const SHAKE_DEVIATION_THRESHOLD = 9; // écart par rapport à la gravité au repos (~9.8 m/s²)
const SHAKE_COOLDOWN_MS = 1000;
const PERMISSION_KEY = "ecosolarnet-motion-granted";

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
    localStorage.removeItem(PERMISSION_KEY);
  } catch {
    // ignore, laisse la permission non accordée
  }
  return false;
}

export function onShake(callback) {
  function handleMotion(e) {
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

    const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
    // Sans gravité (e.acceleration), le repos est proche de 0 ; avec gravité, proche de 9.8.
    const baseline = e.accelerationIncludingGravity ? 9.8 : 0;
    const deviation = Math.abs(magnitude - baseline);

    if (deviation > SHAKE_DEVIATION_THRESHOLD) {
      const now = Date.now();
      if (now - lastShakeAt > SHAKE_COOLDOWN_MS) {
        lastShakeAt = now;
        callback();
      }
    }
  }
  window.addEventListener("devicemotion", handleMotion);
  return () => window.removeEventListener("devicemotion", handleMotion);
}
