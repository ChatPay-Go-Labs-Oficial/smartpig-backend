import { validateRfiResponse } from './rfi-validation';
import type { BlindPayRfi } from '../blindpay/dto/blindpay.dto';

/** RFI de exemplo com os três tipos de campo: texto, dropdown e upload. */
function buildRfi(): BlindPayRfi {
  return {
    id: 'rfi_1',
    customer_id: 're_1',
    instance_id: 'in_1',
    status: 'pending',
    request: [
      {
        title: 'Business Description',
        description: 'Descreva a atividade principal.',
        fields: [
          { key: 'activity', label: 'Atividade', required: true },
          { key: 'notes', label: 'Observações', required: false },
        ],
      },
      {
        title: 'Proof of Address',
        description: 'Envie um comprovante recente.',
        fields: [
          {
            key: 'proof_type',
            label: 'Tipo de comprovante',
            required: true,
            items: [
              { label: 'Conta de luz', value: 'utility_bill' },
              { label: 'Extrato bancário', value: 'bank_statement' },
            ],
          },
          {
            key: 'documents',
            label: 'Documentos',
            required: true,
            multiple: true,
            regex: '^https://[^\\s]+$',
          },
        ],
      },
    ],
    response: {},
    expires_at: '2026-09-01T00:00:00Z',
    submitted_at: null,
    created_at: '2026-08-01T00:00:00Z',
  };
}

const validAnswers = {
  activity: 'Fintech de poupança',
  proof_type: 'utility_bill',
  documents: ['https://files.blindpay.com/a.pdf'],
};

describe('validateRfiResponse', () => {
  it('accepts a complete answer and returns a body with only the requested keys', () => {
    // Arrange
    const rfi = buildRfi();

    // Act
    const result = validateRfiResponse(rfi, {
      ...validAnswers,
      unexpected: 'deve ser descartado',
    });

    // Assert
    expect(result.fields).toEqual({});
    expect(result.body).toEqual(validAnswers);
    expect(result.body).not.toHaveProperty('unexpected');
  });

  it('omits optional fields left blank instead of flagging them', () => {
    const result = validateRfiResponse(buildRfi(), {
      ...validAnswers,
      notes: '   ',
    });

    expect(result.fields).toEqual({});
    expect(result.body).not.toHaveProperty('notes');
  });

  it('reports every missing required field at once', () => {
    const result = validateRfiResponse(buildRfi(), { notes: 'só isso' });

    expect(Object.keys(result.fields).sort()).toEqual([
      'activity',
      'documents',
      'proof_type',
    ]);
  });

  it('rejects a dropdown value that is not one of the offered items', () => {
    const result = validateRfiResponse(buildRfi(), {
      ...validAnswers,
      proof_type: 'passport',
    });

    expect(result.fields).toHaveProperty('proof_type');
    expect(result.body).not.toHaveProperty('proof_type');
  });

  it('rejects an upload value that does not match the field regex', () => {
    const result = validateRfiResponse(buildRfi(), {
      ...validAnswers,
      documents: ['ftp://files.blindpay.com/a.pdf'],
    });

    expect(result.fields).toHaveProperty('documents');
  });

  it('rejects more than 20 values on a multiple field', () => {
    const result = validateRfiResponse(buildRfi(), {
      ...validAnswers,
      documents: Array.from(
        { length: 21 },
        (_, i) => `https://files.blindpay.com/${i}.pdf`,
      ),
    });

    expect(result.fields.documents).toMatch(/20/);
  });

  it('wraps a lone string into an array for a multiple field', () => {
    const result = validateRfiResponse(buildRfi(), {
      ...validAnswers,
      documents: 'https://files.blindpay.com/a.pdf',
    });

    expect(result.fields).toEqual({});
    expect(result.body.documents).toEqual(['https://files.blindpay.com/a.pdf']);
  });

  it('lets a malformed compliance regex through rather than blaming the user', () => {
    const rfi = buildRfi();
    rfi.request[0].fields[0].regex = '([unclosed';

    const result = validateRfiResponse(rfi, validAnswers);

    expect(result.fields).toEqual({});
    expect(result.body.activity).toBe('Fintech de poupança');
  });
});
