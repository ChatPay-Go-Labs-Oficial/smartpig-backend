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
}
