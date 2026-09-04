import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Decimal } from '@prisma/client/runtime/library';
import {
  Asset,
  Horizon,
  Keypair,
  TransactionBuilder,
  Transaction,
  Operation,
  BASE_FEE,
} from '@stellar/stellar-sdk';

// 10 minutes for the user to sign and submit
const TX_TIMEOUT_SECONDS = 600;

const DEFAULT_FEE_BUMP_BASE_FEE = 500;
const DEFAULT_FEE_BUMP_MULTIPLIER = 2;
const MAX_FEE_BUMP_ATTEMPTS = 3;

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly horizonUrl: string;
  private readonly usdcAsset: Asset;
  private readonly tesouroAsset: Asset | null;
  private readonly feeBumpBaseFee: string;
  private readonly feeBumpMultiplier: number;
  private treasuryKeypair: Keypair | null = null;

  constructor(private readonly config: ConfigService) {
    const network = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    this.networkPassphrase = this.config.getOrThrow<string>(
      'STELLAR_NETWORK_PASSPHRASE',
    );
    this.horizonUrl = this.config.getOrThrow<string>('STELLAR_HORIZON_URL');
    this.feeBumpBaseFee = String(
      this.config.get<number>(
        'STELLAR_FEE_BUMP_BASE_FEE',
        DEFAULT_FEE_BUMP_BASE_FEE,
      ),
    );
    this.feeBumpMultiplier = this.config.get<number>(
      'STELLAR_FEE_BUMP_MULTIPLIER',
      DEFAULT_FEE_BUMP_MULTIPLIER,
    );
    this.usdcAsset = new Asset(
      this.config.getOrThrow<string>('STELLAR_USDC_ASSET_CODE'),
      this.config.getOrThrow<string>('STELLAR_USDC_ISSUER'),
    );

    const tesouroCode = this.config.get<string>('STELLAR_TESOURO_ASSET_CODE');
    const tesouroIssuer = this.config.get<string>('STELLAR_TESOURO_ISSUER');
    if (Boolean(tesouroCode) !== Boolean(tesouroIssuer)) {
      throw new Error(
        'STELLAR_TESOURO_ASSET_CODE and STELLAR_TESOURO_ISSUER must be configured together',
      );
    }
    this.tesouroAsset =
      tesouroCode && tesouroIssuer
        ? new Asset(tesouroCode, tesouroIssuer)
        : null;

    this.server = new Horizon.Server(this.horizonUrl);
    this.logger.log(
      `StellarService initialized on ${network} (${this.horizonUrl}), USDC=${this.getUsdcAssetId()}, TESOURO=${this.tesouroAsset ? this.assetId(this.tesouroAsset) : 'disabled'}`,
    );
  }

  getUsdcAssetId(): string {
    return this.assetId(this.usdcAsset);
  }

  /** Asset id of the secondary asset, or null when TESOURO is not configured. */
  getTesouroAssetId(): string | null {
    return this.tesouroAsset ? this.assetId(this.tesouroAsset) : null;
  }

  private assetId(asset: Asset): string {
    return `${asset.getCode()}:${asset.getIssuer()}`;
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

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(Operation.changeTrust({ asset: this.usdcAsset }))
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
   *   4. ChangeTrust TESOURO (User, only when configured)
   *   5. EndSponsoringFutureReserves (User)
   *
   * Cost per user:
   *   - 0.5 XLM locked (conta base, patrocinado)
   *   - 0.5 XLM per configured trustline (patrocinado)
   *   - ~0.001 XLM fee (pago via FeeBump pela Treasury)
   *   Total: 0 XLM transferido; reserva bloqueada varia conforme as trustlines configuradas
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
    // Inner transaction: fee "0" (FeeBump cobrirá)
    const builder = new TransactionBuilder(treasuryAccount, {
      fee: '0',
      networkPassphrase: this.networkPassphrase,
    });

    if (accountExists) {
      this.logger.log(
        `Activation: account ${userAddress} already exists, skipping sponsorship`,
      );
      builder.addOperation(
        Operation.changeTrust({
          asset: this.usdcAsset,
          source: userAddress,
        }),
      );
      if (this.tesouroAsset) {
        builder.addOperation(
          Operation.changeTrust({
            asset: this.tesouroAsset,
            source: userAddress,
          }),
        );
      }
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
            asset: this.usdcAsset,
            source: userAddress,
          }),
        );
      if (this.tesouroAsset) {
        builder.addOperation(
          Operation.changeTrust({
            asset: this.tesouroAsset,
            source: userAddress,
          }),
        );
      }
      builder.addOperation(
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
   * Builds a partially-signed inner XDR that closes a user's Stellar account.
   *
   * It is the activation flow in reverse, and reuses the same pieces:
   *   1. Payment of every remaining balance to the Treasury
   *   2. ChangeTrust(limit: 0) on each existing trustline
   *   3. AccountMerge to the Treasury
   *
   * Steps 1 and 2 cannot be reordered. The network rejects ChangeTrust(limit: 0)
   * unless the balance is exactly zero, so the sweep is what makes the trustline
   * removable — and removing the trustlines is what makes the merge possible, since
   * AccountMerge refuses an account that still holds subentries.
   *
   * The sweep is a technical requirement, not a charge. The amount swept is returned
   * so the caller can record it for reconciliation.
   *
   * Balances come from Horizon, never from the client. Fee is "0" — the Treasury
   * covers it with a FeeBump, exactly as it does for activation, because the user's
   * account holds no spendable XLM.
   */
  async buildAccountClosureXdr(userAddress: string): Promise<{
    xdr: string;
    sweptAmount: Decimal;
    sweptAssetSymbol: string | null;
  }> {
    const treasuryKeypair = this.loadTreasury();
    const treasuryPublicKey = treasuryKeypair.publicKey();

    let userAccount: Horizon.AccountResponse;
    try {
      userAccount = await this.server.loadAccount(userAddress);
    } catch {
      throw new BadRequestException(
        `Account ${userAddress} not found on the Stellar network`,
      );
    }

    let treasuryAccount: Horizon.AccountResponse;
    try {
      treasuryAccount = await this.server.loadAccount(treasuryPublicKey);
    } catch {
      throw new BadRequestException(
        `Treasury account ${treasuryPublicKey} not found on the Stellar network. Ensure it is funded.`,
      );
    }

    const closable = [this.usdcAsset, this.tesouroAsset].filter(
      (asset): asset is Asset => asset !== null,
    );

    const builder = new TransactionBuilder(treasuryAccount, {
      fee: '0',
      networkPassphrase: this.networkPassphrase,
    });

    const sweeps: { asset: Asset; amount: string }[] = [];
    const trustlinesToRemove: Asset[] = [];

    for (const asset of closable) {
      const line = userAccount.balances.find(
        (balance) =>
          balance.asset_type !== 'native' &&
          'asset_code' in balance &&
          balance.asset_code === asset.getCode() &&
          balance.asset_issuer === asset.getIssuer(),
      );

      // No trustline means nothing to sweep and nothing to remove.
      if (!line) continue;

      // An open DEX offer buying this asset keeps the trustline alive: the network
      // answers op_cannot_delete and the whole closure fails. The product exposes no
      // DEX, but the wallet is the user's and another client may have used it.
      const buyingLiabilities =
        'buying_liabilities' in line ? line.buying_liabilities : '0';
      if (new Decimal(buyingLiabilities).gt(0)) {
        throw new BadRequestException(
          `Há uma ordem aberta na rede comprando ${asset.getCode()}. Cancele a ordem antes de excluir a conta.`,
        );
      }

      trustlinesToRemove.push(asset);

      const balance = new Decimal(line.balance);
      if (balance.gt(0)) {
        sweeps.push({ asset, amount: balance.toString() });
      }
    }

    for (const sweep of sweeps) {
      builder.addOperation(
        Operation.payment({
          destination: treasuryPublicKey,
          asset: sweep.asset,
          amount: sweep.amount,
          source: userAddress,
        }),
      );
    }

    for (const asset of trustlinesToRemove) {
      builder.addOperation(
        Operation.changeTrust({
          asset,
          limit: '0',
          source: userAddress,
        }),
      );
    }

    builder.addOperation(
      Operation.accountMerge({
        destination: treasuryPublicKey,
        source: userAddress,
      }),
    );

    const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
    tx.sign(treasuryKeypair);

    const swept = this.summariseSweep(sweeps);

    this.logger.log(
      `Closure XDR built for ${userAddress} (sweeps=${sweeps.length}, trustlines=${trustlinesToRemove.length}, treasury-signed)`,
    );

    return {
      xdr: tx.toEnvelope().toXDR('base64'),
      sweptAmount: swept.amount,
      sweptAssetSymbol: swept.assetSymbol,
    };
  }

  /**
   * `AccountDeletionRequest` records one swept amount and one asset symbol, so a
   * closure that sweeps two assets can only report one. USDC wins, because it is the
   * asset the product actually moves; the secondary asset is logged.
   */
  private summariseSweep(sweeps: { asset: Asset; amount: string }[]): {
    amount: Decimal;
    assetSymbol: string | null;
  } {
    if (sweeps.length === 0) {
      return { amount: new Decimal(0), assetSymbol: null };
    }

    const usdc = sweeps.find(
      (sweep) => sweep.asset.getCode() === this.usdcAsset.getCode(),
    );
    const chosen = usdc ?? sweeps[0];

    if (sweeps.length > 1) {
      this.logger.warn(
        `Closure swept ${sweeps.length} assets; recording only ${chosen.asset.getCode()}`,
      );
    }

    return {
      amount: new Decimal(chosen.amount),
      assetSymbol: chosen.asset.getCode(),
    };
  }

  /**
   * Wraps a fully-signed inner transaction in a FeeBump and submits it.
   * The Treasury pays the fee via FeeBump.
   */
  async submitFeeBumpTransaction(
    innerSignedXdr: string,
    expectedUnsignedXdr?: string,
  ): Promise<{ hash: string }> {
    let baseFee = await this.getRecommendedFeeBumpBaseFee();

    for (let attempt = 1; attempt <= MAX_FEE_BUMP_ATTEMPTS; attempt += 1) {
      const feeBumpXdr = this.buildSponsoredFeeBumpXdr(
        innerSignedXdr,
        expectedUnsignedXdr,
        baseFee,
      );
      const feeBump = TransactionBuilder.fromXDR(
        feeBumpXdr,
        this.networkPassphrase,
      );

      try {
        const result = await this.server.submitTransaction(feeBump);
        const hash = result.hash;
        this.logger.log(
          `FeeBump transaction submitted: ${hash} (baseFee=${baseFee}, attempt=${attempt})`,
        );
        return { hash };
      } catch (err: any) {
        const error = parseStellarSubmissionError(err);
        this.logger.error(
          `FeeBump error response: ${JSON.stringify(error.response)}`,
        );

        if (
          error.transactionCode === 'tx_insufficient_fee' &&
          attempt < MAX_FEE_BUMP_ATTEMPTS
        ) {
          baseFee *= 2;
          this.logger.warn(
            `Retrying FeeBump with higher base fee ${baseFee} after tx_insufficient_fee`,
          );
          continue;
        }

        const humanMessage = translateStellarError(error.rawDetail);
        this.logger.error(
          `Failed to submit FeeBump: ${humanMessage} (raw: ${error.rawDetail})`,
        );
        throw new BadRequestException(`Transaction failed: ${humanMessage}`);
      }
    }

    throw new BadRequestException('Transaction failed after fee retries');
  }

  private async getRecommendedFeeBumpBaseFee(): Promise<number> {
    const configuredFee = Number(this.feeBumpBaseFee);

    try {
      const stats = await this.server.feeStats();
      const networkP90 = Number(stats.fee_charged?.p90 ?? 0);
      if (!Number.isFinite(networkP90) || networkP90 <= 0) return configuredFee;
      return Math.max(
        configuredFee,
        Math.ceil(networkP90 * this.feeBumpMultiplier),
      );
    } catch (error: any) {
      this.logger.warn(
        `Unable to load Horizon fee stats; using configured fee ${configuredFee}: ${error?.message ?? error}`,
      );
      return configuredFee;
    }
  }

  /**
   * Wraps a user-signed transaction in a treasury-signed FeeBump envelope.
   * When expectedUnsignedXdr is provided, only the transaction previously
   * generated by the backend is eligible for sponsorship.
   */
  buildSponsoredFeeBumpXdr(
    innerSignedXdr: string,
    expectedUnsignedXdr?: string,
    baseFee = Number(this.feeBumpBaseFee),
  ): string {
    const treasuryKeypair = this.loadTreasury();
    let innerTx: Transaction;

    try {
      innerTx = new Transaction(innerSignedXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException('Invalid signed transaction XDR');
    }

    if (innerTx.signatures.length === 0) {
      throw new BadRequestException('Transaction must be signed by the user');
    }

    if (expectedUnsignedXdr) {
      let expectedTx: Transaction;
      try {
        expectedTx = new Transaction(
          expectedUnsignedXdr,
          this.networkPassphrase,
        );
      } catch {
        throw new BadRequestException(
          'Stored unsigned transaction XDR is invalid',
        );
      }

      if (!innerTx.hash().equals(expectedTx.hash())) {
        throw new BadRequestException(
          'Signed transaction does not match the generated transaction',
        );
      }
    }

    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      treasuryKeypair,
      String(baseFee),
      innerTx,
      this.networkPassphrase,
    );
    feeBump.sign(treasuryKeypair);

    return feeBump.toEnvelope().toXDR('base64');
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

  async isAccountActivated(address: string): Promise<boolean> {
    try {
      const account = await this.server.loadAccount(address);
      const requiredAssets = [this.usdcAsset, this.tesouroAsset].filter(
        (asset): asset is Asset => asset !== null,
      );

      return requiredAssets.every((asset) =>
        account.balances.some(
          (balance) =>
            balance.asset_type !== 'native' &&
            'asset_code' in balance &&
            balance.asset_code === asset.getCode() &&
            balance.asset_issuer === asset.getIssuer(),
        ),
      );
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
  // Account closure. Each of these means the account cannot be merged yet, and the
  // untranslated code tells the user nothing about what to do next.
  if (code.includes('op_cannot_delete')) {
    return 'Não foi possível remover a linha de confiança do ativo. Verifique se há ordens abertas ou participação em pool de liquidez para este ativo na rede.';
  }
  if (code.includes('op_invalid_limit')) {
    return 'A linha de confiança ainda tem saldo. O encerramento precisa varrer o saldo antes de removê-la.';
  }
  if (code.includes('op_has_sub_entries')) {
    return 'A conta ainda tem linhas de confiança, ofertas ou entradas de dados na rede e não pode ser encerrada.';
  }
  if (code.includes('op_is_sponsor')) {
    return 'A conta patrocina reservas de outra conta e não pode ser encerrada antes de revogá-las.';
  }
  if (code.includes('op_dest_full')) {
    return 'A conta da tesouraria não pode receber o saldo restante. Contate o suporte.';
  }
  if (code.includes('op_seq_num_too_far')) {
    return 'O número de sequência da conta está fora da faixa aceita para encerramento.';
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

function parseStellarSubmissionError(err: any): {
  response?: Record<string, unknown>;
  transactionCode: string;
  operationCodes: string[];
  rawDetail: string;
} {
  const response = err?.response?.data as Record<string, unknown> | undefined;
  const extras = response?.extras as Record<string, unknown> | undefined;
  const resultCodes = extras?.result_codes as
    | Record<string, unknown>
    | undefined;
  const transactionCode = String(
    resultCodes?.transaction ?? resultCodes?.tx ?? '',
  );
  const operationCodes = Array.isArray(resultCodes?.operations)
    ? resultCodes.operations.map(String)
    : [];
  const rawDetail =
    transactionCode ||
    operationCodes.join(', ') ||
    String(
      response?.detail ?? response?.title ?? err?.message ?? 'Unknown error',
    );

  return { response, transactionCode, operationCodes, rawDetail };
}
