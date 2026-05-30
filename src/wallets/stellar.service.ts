import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Asset,
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
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
  private readonly horizonUrl: string;

  constructor(private readonly config: ConfigService) {
    const network = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    const isMainnet = network === 'mainnet';

    this.networkPassphrase = isMainnet ? Networks.PUBLIC : Networks.TESTNET;
    this.horizonUrl = isMainnet
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';

    this.server = new Horizon.Server(this.horizonUrl);
    this.logger.log(`StellarService initialized on ${network} (${this.horizonUrl})`);
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
   * Submits a signed Stellar transaction to the network via the Horizon HTTP API.
   * Uses direct HTTP call instead of Transaction constructor to avoid SDK
   * parsing issues with certain operation types (e.g. ChangeTrust).
   */
  async submitSignedXdr(signedXdr: string): Promise<{ hash: string }> {
    try {
      const url = `${this.horizonUrl}/transactions`;
      const body = new URLSearchParams({ tx: signedXdr });
      const { data } = await axios.post<{ hash: string }>(url, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      this.logger.log(`Transaction submitted: ${data.hash}`);
      return { hash: data.hash };
    } catch (err: any) {
      const resp = err?.response?.data as Record<string, unknown> | undefined;
      this.logger.error(`Horizon error response: ${JSON.stringify(resp)}`);
      const extras = resp?.extras as Record<string, unknown> | undefined;
      const resultCodes = extras?.result_codes as Record<string, unknown> | undefined;
      const txCode = resultCodes?.tx as string ?? '';
      const opCodes = resultCodes?.operations as unknown[] ?? [];
      const detail = txCode || opCodes.join(', ') || resp?.title || err?.message || 'Unknown error';
      this.logger.error(`Failed to submit transaction: ${detail}`);
      throw new BadRequestException(`Transaction failed: ${detail}`);
    }
  }
}
