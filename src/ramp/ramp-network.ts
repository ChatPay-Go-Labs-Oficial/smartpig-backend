import type { ConfigService } from '@nestjs/config';

/**
 * Rede Stellar usada nas chamadas à BlindPay, derivada de `DEFINDEX_NETWORK`.
 *
 * Vive fora dos serviços porque tanto o fluxo de ramp quanto o de KYC precisam
 * dela — e as duas leituras precisam concordar, senão o reenvio recria a wallet
 * numa rede diferente da original.
 */
export function stellarNetwork(
  config: ConfigService,
): 'stellar' | 'stellar_testnet' {
  return config.get<string>('DEFINDEX_NETWORK', 'testnet') === 'mainnet'
    ? 'stellar'
    : 'stellar_testnet';
}
