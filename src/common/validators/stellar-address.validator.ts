import {
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validação de endereço Stellar com checksum.
 *
 * `@Matches(/^G[A-Z2-7]{55}$/)` confere tamanho e alfabeto, mas não o checksum
 * do base32: um endereço com um caractere trocado passa pela regex e só falha
 * depois, na Horizon. `StrKey` é o decodificador do próprio SDK, então aceita
 * precisamente o que a rede aceita.
 *
 * Vale sobretudo nos campos que decidem quem administra um vault e para onde
 * vão as taxas, onde um endereço errado não é só um 400 tardio.
 */
export function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' && StrKey.isValidEd25519PublicKey(value)
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Stellar public key (G...)`;
        },
      },
    });
  };
}

/** Contract id de Soroban (`C...`), com checksum. */
export function IsStellarContractId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarContractId',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && StrKey.isValidContract(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Stellar contract id (C...)`;
        },
      },
    });
  };
}
