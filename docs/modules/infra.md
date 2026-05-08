# Módulo: Infra (Prisma)

**Localização:** `src/infra/prisma/`

## Responsabilidade

Fornece acesso único e centralizado ao banco de dados PostgreSQL via Prisma 5.

## Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `prisma.service.ts` | Extends `PrismaClient`, gerencia conexão com lifecycle hooks do NestJS |
| `prisma.module.ts` | Módulo `@Global()` que exporta `PrismaService` para toda a aplicação |

## Por que `@Global()`?

`PrismaModule` é declarado como global para que qualquer módulo possa injetar `PrismaService` sem precisar importar `PrismaModule` explicitamente. Ele é importado **uma única vez** no `AppModule`.

## Uso

```typescript
import { PrismaService } from '../infra/prisma/prisma.service';

@Injectable()
export class MeuServico {
  constructor(private readonly prisma: PrismaService) {}

  async buscarVaults() {
    return this.prisma.vaultCatalog.findMany({ where: { isActive: true } });
  }
}
```

## Lifecycle

O `PrismaService` implementa `OnModuleInit` e `OnModuleDestroy`:
- `onModuleInit`: chama `$connect()` quando o módulo é inicializado
- `onModuleDestroy`: chama `$disconnect()` ao encerrar a aplicação

## Versão do Prisma

O projeto usa **Prisma 5** (não Prisma 7). O Prisma 7 introduziu um modelo de adapter obrigatório (`PrismaPg`) incompatível com o padrão `extends PrismaClient` usado no NestJS. Não faça upgrade sem validar a compatibilidade.

## Migrations

```bash
# Desenvolvimento (cria e aplica migration)
npx prisma migrate dev --name nome-da-mudanca

# Produção (aplica migrations pendentes)
npx prisma migrate deploy

# Visualizar banco no browser
npx prisma studio

# Seed inicial
npx prisma db seed
```
