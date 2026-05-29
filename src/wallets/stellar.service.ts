import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
  Transaction,
  BASE_FEE,
} from '@stellar/stellar-sdk';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_CODE = 'USDC';

// 10 minutes for the user to sign and submit
const TX_TIMEOUT_SECONDS = 600;

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(private readonly config: ConfigService) {
    const network = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    const isMainnet = network === 'mainnet';

    this.networkPassphrase = isMainnet ? Networks.PUBLIC : Networks.TESTNET;
    const horizonUrl = isMainnet
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';

    this.server = new Horizon.Server(horizonUrl);
    this.logger.log(`StellarService initialized on ${network} (${horizonUrl})`);
  }

  /**
   * Builds an unsigned XDR for a ChangeTrust operation that adds USDC as a
   * trusted asset on the given Stellar account. The client must sign and
   * submit the XDR to the network.
   */
  async buildUsdcTrustlineXdr(stellarAddress: string): Promise<string> {
    let account: Horizon.AccountResponse;
    try {
      account = await this.server.loadAccount(stellarAddress);
    } catch (err) {
      this.logger.warn(`Account not found on Stellar network: ${stellarAddress}`);
      throw new BadRequestException(
        `Stellar account ${stellarAddress} not found on the network. ` +
          'The account must be funded before a trustline can be created.',
      );
    }

    const usdc = new Asset(USDC_CODE, USDC_ISSUER);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(Operation.changeTrust({ asset: usdc }))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const xdr = tx.toXDR();
    this.logger.log(`USDC trustline XDR built for account ${stellarAddress}`);
    return xdr;
  }

  /**
   * Submits a signed Stellar transaction to the network.
   * Returns the transaction hash on success.
   */
  async submitSignedXdr(signedXdr: string): Promise<{ hash: string }> {
    try {
      const transaction = new Transaction(signedXdr, this.networkPassphrase);
      const result = await this.server.submitTransaction(transaction);
      this.logger.log(`Transaction submitted: ${result.hash}`);
      return { hash: result.hash };
    } catch (err: any) {
      const message = err?.response?.data?.extras?.result_codes?.tx ?? err?.message ?? 'Unknown error';
      this.logger.error(`Failed to submit transaction: ${message}`);
      throw new BadRequestException(`Transaction failed: ${message}`);
    }
  }
}
