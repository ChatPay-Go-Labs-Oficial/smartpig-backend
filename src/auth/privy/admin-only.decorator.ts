import { SetMetadata } from '@nestjs/common';

export const IS_ADMIN_ONLY_KEY = 'isAdminOnly';

/**
 * Requires the `x-admin-key` header and nothing else.
 *
 * This is the difference from {@link Admin}: `@Admin()` treats the admin key as an
 * *alternative* credential and falls through to normal Privy bearer auth when the
 * header is absent, so any logged-in user passes. That is fine for reads, and wrong
 * for operator controls — runtime vault activation and disclosure publishing decide
 * what every user is allowed to deposit into.
 *
 * Fails closed: when `ADMIN_API_KEY` is unset, no request is ever authorized.
 */
export const AdminOnly = () => SetMetadata(IS_ADMIN_ONLY_KEY, true);
