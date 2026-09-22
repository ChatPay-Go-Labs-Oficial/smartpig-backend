import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/node';

@Injectable()
export class PrivyAuthService {
  private readonly logger = new Logger(PrivyAuthService.name);
  private client: PrivyClient | null = null;

  constructor(private readonly configService: ConfigService) {
    const appId = this.configService.get<string>('PRIVY_APP_ID');
    const appSecret = this.configService.get<string>('PRIVY_APP_SECRET');

    if (!appId || !appSecret) {
      this.logger.fatal(
        'PRIVY_APP_ID and PRIVY_APP_SECRET must be set. Authentication will reject all tokens.',
      );
      return;
    }

    this.client = new PrivyClient({ appId, appSecret });
    this.logger.log('PrivyClient initialized successfully');
  }

  async verifyAccessToken(token: string): Promise<{ id: string }> {
    if (!this.client) {
      throw new Error('PrivyClient is not configured');
    }

    const claims = await this.client.utils().auth().verifyAccessToken(token);
    return { id: claims.user_id };
  }

  /**
   * Deletes the user at Privy. The last and irreversible step of the deletion saga.
   *
   * After this the user cannot authenticate, so nothing that needs their signature
   * can run afterwards — which is why the on-chain closure comes first.
   *
   * A 404 counts as success: the user is already gone. Privy soft-deletes the
   * embedded wallet rather than destroying it — it is disassociated and archived,
   * and the consent screen says so.
   */
  async deleteUser(userId: string): Promise<void> {
    if (!this.client) {
      throw new Error('PrivyClient is not configured');
    }

    try {
      await this.client.users().delete(userId);
      this.logger.log(`Privy user ${userId} deleted`);
    } catch (err) {
      const status =
        (err as { status?: number; statusCode?: number }).status ??
        (err as { statusCode?: number }).statusCode;
      if (status === 404) {
        this.logger.log(
          `Privy user ${userId} already absent, treating as deleted`,
        );
        return;
      }
      throw err;
    }
  }

  async getStellarWalletAddresses(userId: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('PrivyClient is not configured');
    }

    const user = await this.client.users()._get(userId);

    return user.linked_accounts
      .filter(
        (account) =>
          account.type === 'wallet' &&
          'chain_type' in account &&
          account.chain_type === 'stellar' &&
          'address' in account &&
          typeof account.address === 'string',
      )
      .sort((left, right) => {
        const leftIndex =
          'wallet_index' in left ? Number(left.wallet_index) : 0;
        const rightIndex =
          'wallet_index' in right ? Number(right.wallet_index) : 0;
        return leftIndex - rightIndex;
      })
      .map((account) => ('address' in account ? String(account.address) : ''))
      .filter(Boolean);
  }
}
