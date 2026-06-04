import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from '@stellar/stellar-sdk';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_CODE = 'USDC';
const TESOURO_CODE = 'TESOURO';
const TESOURO_ISSUER = 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';

// 10 minutes for the user to sign and submit
const TX_TIMEOUT_SECONDS = 600;

// Fee for activation: up to 5 operations
const ACTIVATION_FEE = '100000';

// Minimum account starting balance (base reserve = 0.5 XLM as of Protocol 19+)
const MIN_STARTING_BALANCE = '0.5';

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

  /**
   * Builds a partially-signed XDR for account activation via sponsored reserves.
   * The transaction is pre-signed by the treasury account. The user must add
   * their signature before submission.
   *
   * Flow:
   *   1. CreateAccount (Treasury → User, 0.5 XLM starting balance)
   *   2. BeginSponsoringFutureReserves (Treasury sponsors User)
   *   3. ChangeTrust USDC (User)
   *   4. ChangeTrust TESOURO (User)
   *   5. EndSponsoringFutureReserves (User)
   *
   * If the account already exists on-chain, only operations 2-5 are included.
   */
  async buildActivationXdr(userAddress: string): Promise<string> {
    const treasurySecret = this.config.get<string>('TREASURY_STELLAR_SECRET');
    if (!treasurySecret) {
      throw new BadRequestException('TREASURY_STELLAR_SECRET is not configured');
    }

    const treasuryKeypair = Keypair.fromSecret(treasurySecret);
    const treasuryPublicKey = treasuryKeypair.publicKey();

    this.logger.log(`Loading treasury account ${treasuryPublicKey} from Horizon`);

    let treasuryAccount: Horizon.AccountResponse;
    try {
      treasuryAccount = await this.server.loadAccount(treasuryPublicKey);
    } catch (err) {
      this.logger.error(`Treasury account ${treasuryPublicKey} not found on network`);
      throw new BadRequestException(
        `Treasury account ${treasuryPublicKey} not found on the Stellar network. Ensure it is funded.`,
      );
    }

    const accountExists = await this.accountExistsOnChain(userAddress);

    const usdc = new Asset(USDC_CODE, USDC_ISSUER);
    const tesouro = new Asset(TESOURO_CODE, TESOURO_ISSUER);

    const builder = new TransactionBuilder(treasuryAccount, {
      fee: ACTIVATION_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    if (!accountExists) {
      builder.addOperation(
        Operation.createAccount({
          destination: userAddress,
          startingBalance: MIN_STARTING_BALANCE,
        }),
      );
      this.logger.log(`Activation: CreateAccount for ${userAddress}`);
    } else {
      this.logger.log(`Activation: account ${userAddress} already exists, skipping CreateAccount`);
    }

    builder
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: userAddress,
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: usdc,
          source: userAddress,
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: tesouro,
          source: userAddress,
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: userAddress,
        }),
      );

    const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();

    tx.sign(treasuryKeypair);

    const xdr = tx.toEnvelope().toXDR('base64');
    this.logger.log(
      `Activation XDR built for ${userAddress} (accountExists=${accountExists}, treasury-signed)`,
    );
    return xdr as string;
  }

  /**
   * Checks whether a Stellar account exists on-chain by attempting to load it.
   */
  private async accountExistsOnChain(address: string): Promise<boolean> {
    try {
      await this.server.loadAccount(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetches the account balances from the Stellar network.
   * Returns all non-zero balances for the given account.
   */
  async getWalletBalances(stellarAddress: string): Promise<{ asset: string; balance: string }[]> {
    try {
      const account = await this.server.loadAccount(stellarAddress);
      const balances = account.balances
        .filter((b: any) => {
          const bal = parseFloat(b.balance);
          return bal > 0;
        })
        .map((b: any) => ({
          asset: b.asset_type === 'native'
            ? 'XLM'
            : `${b.asset_code}:${b.asset_issuer}`,
          balance: b.balance,
        }));
      this.logger.log(`Wallet balances fetched for ${stellarAddress}: ${balances.length} assets`);
      return balances;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch balances for ${stellarAddress}: ${err.message}`);
      return [];
    }
  }
}
