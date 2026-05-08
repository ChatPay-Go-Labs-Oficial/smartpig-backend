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

| Variável | Obrigatória | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `DATABASE_URL` | ✅ | — | Connection string PostgreSQL |
| `PORT` | ❌ | 3000 | Porta do servidor HTTP |
| `DEFINDEX_API_KEY` | ✅ | — | API key do DeFindex (nunca expor ao cliente) |
| `DEFINDEX_BASE_URL` | ❌ | URL padrão do SDK | URL base da API DeFindex |
| `DEFINDEX_TIMEOUT_MS` | ❌ | 10000 | Timeout das chamadas ao DeFindex (ms) |
| `DEFINDEX_NETWORK` | ❌ | testnet | `testnet` ou `mainnet` |
| `JWT_ACCESS_SECRET` | ✅* | — | Secret para assinar access tokens |
| `JWT_ACCESS_EXPIRATION` | ❌ | 900 | Expiração do access token (segundos) |
| `JWT_REFRESH_EXPIRATION` | ❌ | 2592000 | Expiração do refresh token (segundos) |
| `GOOGLE_CLIENT_ID` | ✅* | — | Client ID do Google OAuth |
| `APPLE_CLIENT_ID` | ✅* | — | Client ID do Apple Sign-In |

*Obrigatórias após implementação da fase de autenticação.

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
