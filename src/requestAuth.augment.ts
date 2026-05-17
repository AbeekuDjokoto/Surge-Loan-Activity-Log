/* Augments Express Request for JWT-authenticated handlers. Imported from app/router only for side-effect. */

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; roles: string[] };
    }
  }
}
export {};
