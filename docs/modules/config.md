# Módulo: Config

**Localização:** `src/config/`

## Responsabilidade

Carrega e valida todas as variáveis de ambiente na inicialização da aplicação. Se alguma variável obrigatória estiver ausente ou com valor inválido, a aplicação **falha imediatamente** (fail-fast).

## Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `config.module.ts` | Configura o `ConfigModule` do NestJS como global |
| `env.schema.ts` | Schema de validação Joi com todas as env vars |

## Variáveis de ambiente

Fonte de verdade: `src/config/env.schema.ts`.

### Obrigatórias — a app não sobe sem elas

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string PostgreSQL |
| `PRIVY_APP_ID` | App ID do Privy (autenticação) |
| `PRIVY_APP_SECRET` | App secret do Privy |
| `STELLAR_HORIZON_URL` | URL do Horizon da rede ativa |
| `STELLAR_NETWORK_PASSPHRASE` | Passphrase da rede Stellar |
| `STELLAR_USDC_ISSUER` | Emissor do USDC na rede ativa |
| `TREASURY_STELLAR_SECRET` | Chave secreta da tesouraria que patrocina a ativação de contas |

### Opcionais e com padrão

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | 3000 | Porta do servidor HTTP |
| `DEFINDEX_API_KEY` | — | API key do DeFindex (nunca expor ao cliente) |
| `DEFINDEX_BASE_URL` | URL padrão do SDK | URL base da API DeFindex |
| `DEFINDEX_TIMEOUT_MS` | 10000 | Timeout das chamadas ao DeFindex (ms) |
| `DEFINDEX_VAULT_INFO_CACHE_TTL_MS` | 300000 | TTL do cache de `getVaultInfo()` |
| `DEFINDEX_NETWORK` | testnet | `testnet` ou `mainnet` |
| `ALLOWED_VAULT_IDS` | `''` | Allowlist de vaults expostos ao app |
| `STELLAR_USDC_ASSET_CODE` | USDC | Código do ativo |
| `STELLAR_TESOURO_ASSET_CODE` / `STELLAR_TESOURO_ISSUER` | — | Ativo TESOURO, quando disponível na rede |
| `STELLAR_FEE_BUMP_BASE_FEE` | 500 | Fee base para fee bump (mín. 100) |
| `STELLAR_FEE_BUMP_MULTIPLIER` | 2 | Multiplicador do fee bump |
| `BLINDPAY_API_KEY` · `BLINDPAY_INSTANCE_ID` · `BLINDPAY_BASE_URL` · `BLINDPAY_WEBHOOK_SECRET` · `BLINDPAY_TOKEN` | — | Ramp BRL (ver [ramp.md](./ramp.md)) |
| `ETHERFUSE_API_KEY` · `ETHERFUSE_BASE_URL` · `ETHERFUSE_WEBHOOK_SECRET` | — | Ramp MXN (ver [etherfuse-ramp.md](./etherfuse-ramp.md)) |
| `GIFT_CLAIM_AGENT_SECRET` | — | Chave da conta que resgata as claimable balances |
| `GIFT_ALLOWED_EMAILS` | — | E-mails separados por vírgula autorizados a presentear; vazia = liberado para todos |
| `GIFT_MIN_USD` / `GIFT_MAX_USD` | 1 / 100 | Limites do valor do presente |
| `GIFT_EXPIRY_DAYS` | 7 | Validade do presente |
| `GIFT_MAX_PENDING_PER_USER` | 5 | Presentes pendentes simultâneos por usuário |
| `ADMIN_API_KEY` | — | Valor esperado no header `x-admin-key` das rotas `@Admin()` |
| `REDIS_URL` | — | Reservado para a fase de hardening |

### Legado

`JWT_ACCESS_SECRET` (padrão `change-me`), `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` e `APPLE_*` continuam no schema, mas a autenticação em uso é a do Privy — nenhum código atual consome esses valores.

## Como injetar configuração

```typescript
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MeuServico {
  constructor(private config: ConfigService) {}

  exemplo() {
    const apiKey = this.config.get<string>('DEFINDEX_API_KEY');
  }
}
```

## Segurança

- Nunca logar o valor de variáveis secretas
- Em produção, usar um secrets manager (AWS Secrets Manager, HashiCorp Vault) — não arquivos `.env`
- O arquivo `.env` está no `.gitignore`; use `.env.example` como referência (sem valores reais)
