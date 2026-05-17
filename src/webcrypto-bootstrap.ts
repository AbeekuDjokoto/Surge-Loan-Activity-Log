/**
 * `jose` v6 resolves to Web Crypto implementations that use the global `crypto` binding.
 * Node <19 and some loaders omit `globalThis.crypto`, which yields `ReferenceError: crypto is not defined`.
 */
import { webcrypto } from "node:crypto";

type GlobalWithCrypto = typeof globalThis & { crypto?: Crypto };

const g = globalThis as GlobalWithCrypto;

if (typeof g.crypto === "undefined") {
  Object.defineProperty(g, "crypto", {
    value: webcrypto,
    configurable: true,
    enumerable: true,
    writable: false,
  });
}
