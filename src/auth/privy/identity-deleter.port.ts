/**
 * The one thing the account-deletion saga needs from the identity provider.
 *
 * It exists as a port because importing `PrivyAuthService` pulls in
 * `@privy-io/node`, which reaches `jose` in ESM — and Jest does not transform
 * `node_modules`, so any spec touching that import graph fails to compile.
 *
 * `AuthModule` binds this token to `PrivyAuthService`. The saga depends on the
 * interface, and its tests substitute a stub.
 */
export const IDENTITY_DELETER = Symbol('IDENTITY_DELETER');

export interface IdentityDeleter {
  /** Deletes the user at the identity provider. A 404 counts as success. */
  deleteUser(providerUserId: string): Promise<void>;
}
