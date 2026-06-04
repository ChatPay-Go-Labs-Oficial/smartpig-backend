import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  Transaction,
  Operation,
  BASE_FEE,
} from '@stellar/stellar-sdk';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_CODE = 'USDC';
const TESOURO_CODE = 'TESOURO';
const TESOURO_ISSUER =
  'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';

// 10 minutes for the user to sign and submit
const TX_TIMEOUT_SECONDS = 600;

// Base fee for FeeBump: 500 stroops (5 operations × 100)
const FEE_BUMP_FEE = '500';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly horizonUrl: string;
  private treasuryKeypair: Keypair | null = null;

  constructor(private readonly config: ConfigService) {
    const network = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    const isMainnet = network === 'mainnet';

    this.networkPassphrase = isMainnet ? Networks.PUBLIC : Networks.TESTNET;
    this.horizonUrl = isMainnet
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';

    this.server = new Horizon.Server(this.horizonUrl);
    this.logger.log(
      `StellarService initialized on ${network} (${this.horizonUrl})`,
    );
  }

  private loadTreasury(): Keypair {
    if (this.treasuryKeypair) return this.treasuryKeypair;
    const secret = this.config.get<string>('TREASURY_STELLAR_SECRET');
    if (!secret)
      throw new BadRequestException(
        'TREASURY_STELLAR_SECRET is not configured',
      );
    this.treasuryKeypair = Keypair.fromSecret(secret);
    return this.treasuryKeypair;
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
    } catch {
      this.logger.warn(
        `Account not found on Stellar network: ${stellarAddress}`,
      );
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
      const { data } = await axios.post<{ hash: string }>(
        url,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
      this.logger.log(`Transaction submitted: ${data.hash}`);
      return { hash: data.hash };
    } catch (err: any) {
      const resp = err?.response?.data as Record<string, unknown> | undefined;
      this.logger.error(`Horizon error response: ${JSON.stringify(resp)}`);
      const extras = resp?.extras as Record<string, unknown> | undefined;
      const resultCodes = extras?.result_codes as
        | Record<string, unknown>
        | undefined;
      const txCode = (resultCodes?.tx as string) ?? '';
      const opCodes = (resultCodes?.operations as unknown[]) ?? [];
      const rawDetail =
        txCode ||
        opCodes.join(', ') ||
        resp?.title ||
        err?.message ||
        'Unknown error';
      const humanMessage = translateStellarError(rawDetail as string);
      this.logger.error(
        `Failed to submit transaction: ${humanMessage} (raw: ${rawDetail})`,
      );
      throw new BadRequestException(`Transaction failed: ${humanMessage}`);
    }
  }

  /**
   * Builds a partially-signed inner XDR for sponsored account activation.
   * Transaction fee is set to "0" — the FeeBump covers the real fee.
   *
   * The inner transaction is pre-signed by Treasury. The user must add their
   * signature via Privy before returning for FeeBump wrapping + submission.
   *
   * Flow:
   *   1. BeginSponsoringFutureReserves (Treasury → User)
   *   2. CreateAccount (Treasury → User, startingBalance: 0)
   *   3. ChangeTrust USDC (User)
   *   4. ChangeTrust TESOURO (User)
   *   5. EndSponsoringFutureReserves (User)
   *
   * Cost per user:
   *   - 0.5 XLM locked (conta base, patrocinado)
   *   - 1.0 XLM locked (2 trustlines, patrocinado)
   *   - ~0.001 XLM fee (pago via FeeBump pela Treasury)
   *   Total: 0 XLM transferido, 1.5 XLM bloqueado (recuperável)
   */
  async buildActivationXdr(userAddress: string): Promise<string> {
    const treasuryKeypair = this.loadTreasury();
    const treasuryPublicKey = treasuryKeypair.publicKey();

    this.logger.log(
      `Loading treasury account ${treasuryPublicKey} from Horizon`,
    );

    let treasuryAccount: Horizon.AccountResponse;
    try {
      treasuryAccount = await this.server.loadAccount(treasuryPublicKey);
    } catch {
      this.logger.error(
        `Treasury account ${treasuryPublicKey} not found on network`,
      );
      throw new BadRequestException(
        `Treasury account ${treasuryPublicKey} not found on the Stellar network. Ensure it is funded.`,
      );
    }

    const accountExists = await this.accountExistsOnChain(userAddress);
    const usdc = new Asset(USDC_CODE, USDC_ISSUER);
    const tesouro = new Asset(TESOURO_CODE, TESOURO_ISSUER);

    // Inner transaction: fee "0" (FeeBump cobrirá)
    const builder = new TransactionBuilder(treasuryAccount, {
      fee: '0',
      networkPassphrase: this.networkPassphrase,
    });

    if (accountExists) {
      this.logger.log(
        `Activation: account ${userAddress} already exists, skipping sponsorship`,
      );
      builder
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
        );
    } else {
      builder
        .addOperation(
          Operation.beginSponsoringFutureReserves({
            sponsoredId: userAddress,
          }),
        )
        .addOperation(
          Operation.createAccount({
            destination: userAddress,
            startingBalance: '0',
            source: treasuryPublicKey,
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
    }

    const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();

    // Treasury signs the inner transaction (autoriza o patrocínio)
    tx.sign(treasuryKeypair);

    const xdr = tx.toEnvelope().toXDR('base64');
    this.logger.log(
      `Activation XDR built for ${userAddress} (accountExists=${accountExists}, treasury-signed)`,
    );
    return xdr;
  }

  /**
   * Wraps a fully-signed inner transaction in a FeeBump and submits it.
   * The Treasury pays the fee via FeeBump.
   */
  async submitFeeBumpTransaction(
    innerSignedXdr: string,
  ): Promise<{ hash: string }> {
    const treasuryKeypair = this.loadTreasury();

    // Parse the inner signed XDR as a Transaction
    const innerTx = new Transaction(innerSignedXdr, this.networkPassphrase);

    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      treasuryKeypair,
      FEE_BUMP_FEE,
      innerTx,
      this.networkPassphrase,
    );

    feeBump.sign(treasuryKeypair);

    try {
      const result = await this.server.submitTransaction(feeBump);
      const hash = result.hash;
      this.logger.log(`FeeBump transaction submitted: ${hash}`);
      return { hash };
    } catch (err: any) {
      const resp = err?.response?.data as Record<string, unknown> | undefined;
      this.logger.error(`FeeBump error response: ${JSON.stringify(resp)}`);
      const extras = resp?.extras as Record<string, unknown> | undefined;
      const resultCodes = extras?.result_codes as
        | Record<string, unknown>
        | undefined;
      const txCode = (resultCodes?.tx as string) ?? '';
      const opCodes = (resultCodes?.operations as unknown[]) ?? [];
      const rawDetail =
        txCode ||
        opCodes.join(', ') ||
        resp?.title ||
        err?.message ||
        'Unknown error';
      const humanMessage = translateStellarError(rawDetail);
      this.logger.error(
        `Failed to submit FeeBump: ${humanMessage} (raw: ${rawDetail})`,
      );
      throw new BadRequestException(`Transaction failed: ${humanMessage}`);
    }
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
  async getWalletBalances(
    stellarAddress: string,
  ): Promise<{ asset: string; balance: string }[]> {
    try {
      const account = await this.server.loadAccount(stellarAddress);
      const balances = account.balances
        .filter((b: any) => {
          const bal = parseFloat(b.balance);
          return bal > 0;
        })
        .map((b: any) => ({
          asset:
            b.asset_type === 'native'
              ? 'XLM'
              : `${b.asset_code}:${b.asset_issuer}`,
          balance: b.balance,
        }));
      this.logger.log(
        `Wallet balances fetched for ${stellarAddress}: ${balances.length} assets`,
      );
      return balances;
    } catch (err: any) {
      this.logger.warn(
        `Failed to fetch balances for ${stellarAddress}: ${err.message}`,
      );
      return [];
    }
  }
}

function translateStellarError(code: string): string {
  if (code.includes('op_low_reserve')) {
    return 'Saldo insuficiente na conta Treasury para patrocinar reservas. Adicione XLM à conta patrocinadora.';
  }
  if (
    code.includes('op_no_source_account') ||
    code.includes('op_no_destination')
  ) {
    return 'Conta de origem ou destino não encontrada na rede Stellar.';
  }
  if (code.includes('op_already_exists')) {
    return 'A trustline já existe para este ativo.';
  }
  if (code.includes('tx_insufficient_fee')) {
    return 'Taxa de transação insuficiente.';
  }
  if (code.includes('tx_insufficient_balance')) {
    return 'Saldo insuficiente para completar a transação.';
  }
  if (code.includes('tx_bad_auth')) {
    return 'Assinatura inválida. Verifique se o XDR foi assinado corretamente.';
  }
  return code;
}
