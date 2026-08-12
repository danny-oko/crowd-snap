import crypto from "crypto";

// Derives a public, non-reversible ownership tag from a client's private
// device id. The device id itself is never stored in object keys/URLs, so
// seeing another person's media doesn't leak the secret needed to delete it.
export function hashDeviceId(deviceId: string): string {
  return crypto.createHash("sha256").update(deviceId).digest("hex").slice(0, 16);
}
