import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

export interface AgentClaimableBalance {
  balanceId: string;
  amount: string;
  sponsor: string | null;
}

export interface BalanceFundingTx {
  hash: string;
  memo: string | null;
}

/**
 * Stellar operations for the gifting flow.
 *
 * The claim agent is a dedicated classic account listed as a claimant
 * (valid until the gift expires) on every gift claimable balance. It never
 * holds funds across transactions: claiming and paying the recipient happen
 * atomically in a single transaction.
 */
@Injectable()
export class GiftStellarService {
  private readonly logger = new Logger(GiftStellarService.name);
  private readonly server: Horizon.Server;
  private readonly horizonUrl: string;
  private readonly networkPassphrase: string;
  private readonly usdcAsset: Asset;
  private readonly usdcAssetId: string;
  private agentKeypair: Keypair | null = null;

  constructor(private readonly config: ConfigService) {
    this.horizonUrl = (
      this.config.get<string>('STELLAR_HORIZON_URL') ?? ''
    ).replace(/\/$/, '');
    this.networkPassphrase =
      this.config.get<string>('STELLAR_NETWORK_PASSPHRASE') ?? '';
    const usdcCode =
      this.config.get<string>('STELLAR_USDC_ASSET_CODE') ?? 'USDC';
    const usdcIssuer = this.config.get<string>('STELLAR_USDC_ISSUER') ?? '';
    this.usdcAsset = new Asset(usdcCode, usdcIssuer);
    this.usdcAssetId = `${usdcCode}:${usdcIssuer}`;
    this.server = new Horizon.Server(this.horizonUrl);
  }

  /** Whether the claim agent secret is configured (jobs skip work when it is not). */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('GIFT_CLAIM_AGENT_SECRET'));
  }

  getAgentPublicKey(): string {
    return this.loadAgent().publicKey();
  }

  private loadAgent(): Keypair {
    if (this.agentKeypair) return this.agentKeypair;
    const secret = this.config.get<string>('GIFT_CLAIM_AGENT_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException(
        'Gift claim agent is not configured (GIFT_CLAIM_AGENT_SECRET)',
      );
    }
    this.agentKeypair = Keypair.fromSecret(secret);
    return this.agentKeypair;
  }

  /** Lists pending USDC claimable balances where the agent is a claimant. */
  async listAgentClaimableBalances(): Promise<AgentClaimableBalance[]> {
    const page = await this.server
      .claimableBalances()
      .claimant(this.getAgentPublicKey())
      .limit(200)
      .call();

    return page.records
      .filter((record) => record.asset === this.usdcAssetId)
      .map((record) => ({
        balanceId: record.id,
        amount: record.amount,
        sponsor: record.sponsor ?? null,
      }));
  }

  /** Returns the transaction that created a claimable balance (carries the gift memo). */
  async getBalanceFundingTx(
    balanceId: string,
  ): Promise<BalanceFundingTx | null> {
    const { data } = await axios.get(
      `${this.horizonUrl}/claimable_balances/${balanceId}/transactions`,
      { params: { limit: 1, order: 'asc' }, timeout: 10_000 },
    );
    const record = data?._embedded?.records?.[0];
    if (!record) return null;
    return { hash: record.hash, memo: record.memo ?? null };
  }

  /** Whether a claimable balance still exists on the ledger (false after claim/refund). */
  async balanceExists(balanceId: string): Promise<boolean> {
    try {
      await axios.get(`${this.horizonUrl}/claimable_balances/${balanceId}`, {
        timeout: 10_000,
      });
      return true;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status === 404) return false;
      throw err;
    }
  }

  /**
   * Claims a gift balance and pays the recipient in one atomic transaction.
   * The agent never holds the funds across transactions.
   */
  async claimAndPay(
    balanceId: string,
    destination: string,
    amount: string,
  ): Promise<{ hash: string }> {
    const agent = this.loadAgent();
    const account = await this.server.loadAccount(agent.publicKey());

    const tx = new TransactionBuilder(account, {
      // Headroom over the base fee for 2 operations under mild surge pricing
      fee: String(Number(BASE_FEE) * 4),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(Operation.claimClaimableBalance({ balanceId }))
      .addOperation(
        Operation.payment({ destination, asset: this.usdcAsset, amount }),
      )
      .setTimeout(120)
      .build();

    tx.sign(agent);
    return this.submitXdr(tx.toXDR());
  }

  /**
   * Submits a signed XDR via the Horizon HTTP API directly (same rationale as
   * StellarService.submitSignedXdr: avoids SDK envelope re-parsing pitfalls).
   */
  private async submitXdr(signedXdr: string): Promise<{ hash: string }> {
    try {
      const response = await axios.post(
        `${this.horizonUrl}/transactions`,
        new URLSearchParams({ tx: signedXdr }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30_000,
        },
      );
      if (!response.data?.hash) {
        throw new Error('Horizon did not return a transaction hash');
      }
      return { hash: response.data.hash };
    } catch (err) {
      const resp = (err as { response?: { data?: unknown } }).response?.data;
      if (resp) {
        this.logger.error(`Horizon error response: ${JSON.stringify(resp)}`);
      }
      const codes = (
        resp as {
          extras?: {
            result_codes?: { transaction?: string; operations?: string[] };
          };
        }
      )?.extras?.result_codes;
      const detail = codes
        ? `${codes.transaction ?? ''} ${codes.operations?.join(',') ?? ''}`.trim()
        : (err as Error).message;
      throw new ServiceUnavailableException(
        `Failed to submit gift transaction to Stellar (${detail})`,
      );
    }
  }
}
