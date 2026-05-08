import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

@Injectable()
export class DefindexConfig {
  readonly sdk: DefindexSDK;
  readonly defaultNetwork: SupportedNetworks;
  readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.timeoutMs = this.config.get<number>('DEFINDEX_TIMEOUT_MS', 10000);

    const rawNetwork = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    this.defaultNetwork =
      rawNetwork === 'mainnet'
        ? SupportedNetworks.MAINNET
        : SupportedNetworks.TESTNET;

    this.sdk = new DefindexSDK({
      apiKey: this.config.get<string>('DEFINDEX_API_KEY'),
      baseUrl: this.config.get<string>('DEFINDEX_BASE_URL'),
      timeout: this.timeoutMs,
      defaultNetwork: this.defaultNetwork,
    });
  }
}
