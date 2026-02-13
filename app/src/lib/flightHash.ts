import { keccak256, toHex } from "viem";

/**
 * MVP deterministic hash:
 * - take sorted flightKeys
 * - join with "\n"
 * - keccak256(utf8)
 */
export function computeFlightListHashHex(sortedFlightKeys: string[]): string {
  const joined = sortedFlightKeys.join("\n");
  return keccak256(toHex(joined));
}
