import type {
  BlindPayRfi,
  BlindPayRfiField,
} from '../blindpay/dto/blindpay.dto';

/** Máximo de URLs por campo `multiple`, conforme a doc da BlindPay. */
const MAX_MULTIPLE_VALUES = 20;

export interface RfiValidationResult {
  /** Erros por `field.key`. Vazio quando a resposta é válida. */
  fields: Record<string, string>;
  /**
   * Resposta já filtrada para as chaves que o RFI realmente pediu. Enviar
   * chave desconhecida faz o upstream devolver 400 em prosa, então cortamos
   * aqui em vez de repassar o objeto cru.
   */
  body: Record<string, string | string[]>;
}

function flattenFields(rfi: BlindPayRfi): BlindPayRfiField[] {
  return (rfi.request ?? []).flatMap((section) => section.fields ?? []);
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Valida um único valor de texto contra `items` (dropdown) e `regex`. */
function validateScalar(field: BlindPayRfiField, value: string): string | null {
  if (field.items && field.items.length > 0) {
    const allowed = field.items.map((item) => item.value);
    if (!allowed.includes(value)) {
      return `Selecione uma das opções disponíveis para "${field.label}".`;
    }
    // Um campo com `items` é dropdown: o `regex` (quando existe) descreve o
    // formato dos próprios valores da lista, então validar de novo é redundante.
    return null;
  }

  if (field.regex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(field.regex);
    } catch {
      // Regex inválida vem do compliance, não do usuário — não dá para culpar
      // quem preencheu. Deixa passar e o upstream decide.
      return null;
    }
    if (!pattern.test(value)) {
      return `O valor de "${field.label}" está em formato inválido.`;
    }
  }

  return null;
}

/**
 * Valida a resposta flat de um RFI contra os campos que o compliance pediu.
 *
 * A API da BlindPay não aceita envio parcial — é uma submissão única — então
 * validar localmente antes de enviar é o que evita queimar a tentativa do
 * usuário com um 400 genérico do upstream.
 */
export function validateRfiResponse(
  rfi: BlindPayRfi,
  responses: Record<string, unknown>,
): RfiValidationResult {
  const fields: Record<string, string> = {};
  const body: Record<string, string | string[]> = {};

  for (const field of flattenFields(rfi)) {
    const value = responses[field.key];

    if (isBlank(value)) {
      if (field.required) {
        fields[field.key] = `"${field.label}" é obrigatório.`;
      }
      continue;
    }

    if (field.multiple) {
      const list = Array.isArray(value) ? value : [value];
      if (list.length > MAX_MULTIPLE_VALUES) {
        fields[field.key] =
          `"${field.label}" aceita no máximo ${MAX_MULTIPLE_VALUES} arquivos.`;
        continue;
      }
      if (!list.every((item): item is string => typeof item === 'string')) {
        fields[field.key] = `"${field.label}" deve conter apenas textos.`;
        continue;
      }
      const invalid = list
        .map((item) => validateScalar(field, item))
        .find((error): error is string => error !== null);
      if (invalid) {
        fields[field.key] = invalid;
        continue;
      }
      body[field.key] = list;
      continue;
    }

    if (typeof value !== 'string') {
      fields[field.key] = `"${field.label}" deve ser um texto.`;
      continue;
    }

    const error = validateScalar(field, value);
    if (error) {
      fields[field.key] = error;
      continue;
    }
    body[field.key] = value;
  }

  return { fields, body };
}
