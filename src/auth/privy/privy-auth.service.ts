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
