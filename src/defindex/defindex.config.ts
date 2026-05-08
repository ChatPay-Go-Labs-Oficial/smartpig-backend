import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

@Injectable()
export class DefindexConfig {
  readonly sdk: DefindexSDK;
  readonly defaultNetwork: SupportedNetworks;
  readonly timeoutMs: number;
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.timeoutMs = this.config.get<number>('DEFINDEX_TIMEOUT_MS', 10000);
    this.apiKey = this.config.get<string>('DEFINDEX_API_KEY', '');
    this.baseUrl = this.config.get<string>('DEFINDEX_BASE_URL', 'https://api.defindex.io');

    const rawNetwork = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    this.defaultNetwork =
      rawNetwork === 'mainnet'
        ? SupportedNetworks.MAINNET
        : SupportedNetworks.TESTNET;

    this.sdk = new DefindexSDK({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      timeout: this.timeoutMs,
      defaultNetwork: this.defaultNetwork,
    });
  }
}
