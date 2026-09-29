// Stable question IDs prevent repeat rewards across retries and content revisions.
export interface LearningQuestion {
  id: string;
  question: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
  points: number;
}
export interface LearningLesson {
  id: number;
  version: number;
  title: string;
  subtitle: string;
  icon: string;
  duration: string;
  cards: { title: string; content: string }[];
  questions: LearningQuestion[];
}
export const LEARNING_LESSONS: LearningLesson[] = [
  {
    id: 1,
    title: 'O que é investir?',
    subtitle: 'Conceitos básicos',
    icon: 'eco',
    duration: '2 min',
    version: 1,
    cards: [
      {
        title: 'Guardar e investir',
        content:
          'Guardar ajuda a organizar sua vida. Investir expõe o dinheiro a oportunidades de rendimento e também a riscos. Crescimento não é garantido.',
      },
      {
        title: 'Inflação e planejamento',
        content:
          'A inflação reduz o poder de compra. Antes de investir, considere seus objetivos e quando poderá precisar do dinheiro.',
      },
    ],
    questions: [
      {
        id: 'lesson-1-q-1',
        question: 'O que a inflação pode fazer com dinheiro parado?',
        options: [
          {
            id: 'a',
            text: 'Reduzir seu poder de compra',
          },
          {
            id: 'b',
            text: 'Garantir lucro',
          },
          {
            id: 'c',
            text: 'Multiplicar o saldo',
          },
        ],
        correctOptionId: 'a',
        explanation: 'A inflação pode fazer o mesmo dinheiro comprar menos.',
        points: 10,
      },
      {
        id: 'lesson-1-q-2',
        question: 'Todo investimento garante crescimento?',
        options: [
          {
            id: 'a',
            text: 'Sim, todos os dias',
          },
          {
            id: 'b',
            text: 'Não, existe risco de perda',
          },
          {
            id: 'c',
            text: 'Sim, se estiver em um app',
          },
        ],
        correctOptionId: 'b',
        explanation: 'Rendimento e preservação do capital não são garantidos.',
        points: 10,
      },
      {
        id: 'lesson-1-q-3',
        question: 'O que considerar antes de investir?',
        options: [
          {
            id: 'a',
            text: 'Só a maior taxa anunciada',
          },
          {
            id: 'b',
            text: 'A cor do aplicativo',
          },
          {
            id: 'c',
            text: 'Objetivos, riscos e quando precisará do dinheiro',
          },
        ],
        correctOptionId: 'c',
        explanation:
          'O prazo e os riscos precisam fazer sentido para sua vida.',
        points: 10,
      },
    ],
  },
  {
    id: 2,
    title: 'Como o PigFi funciona?',
    subtitle: 'Wallet, BlindPay e vaults',
    icon: 'account-balance-wallet',
    duration: '2 min',
    version: 1,
    cards: [
      {
        title: 'Dinheiro na sua wallet',
        content:
          'A BlindPay faz a entrada e a saída entre moeda local e o ativo suportado. Receber USDC na wallet não aplica o dinheiro automaticamente.',
      },
      {
        title: 'Você escolhe',
        content:
          'Você escolhe o vault e autoriza o depósito na DeFindex. O rendimento depende da estratégia. No resgate, o ativo volta à wallet antes da saída para moeda local.',
      },
    ],
    questions: [
      {
        id: 'lesson-2-q-1',
        question: 'Quem escolhe o vault?',
        options: [
          {
            id: 'a',
            text: 'A BlindPay',
          },
          {
            id: 'b',
            text: 'Você',
          },
          {
            id: 'c',
            text: 'A cotação do dólar',
          },
        ],
        correctOptionId: 'b',
        explanation:
          'A escolha do vault é sua; a BlindPay cuida da entrada e saída.',
        points: 10,
      },
      {
        id: 'lesson-2-q-2',
        question: 'USDC chegou à wallet. Já está rendendo no vault?',
        options: [
          {
            id: 'a',
            text: 'Sim, automaticamente',
          },
          {
            id: 'b',
            text: 'Só precisa esperar um dia',
          },
          {
            id: 'c',
            text: 'Não, é preciso autorizar o depósito',
          },
        ],
        correctOptionId: 'c',
        explanation: 'Wallet e vault são etapas distintas.',
        points: 10,
      },
      {
        id: 'lesson-2-q-3',
        question: 'Para onde vai o ativo ao sair do vault?',
        options: [
          {
            id: 'a',
            text: 'Para a sua wallet',
          },
          {
            id: 'b',
            text: 'Direto para qualquer conta bancária',
          },
          {
            id: 'c',
            text: 'Para a carteira de outro usuário',
          },
        ],
        correctOptionId: 'a',
        explanation:
          'O ativo retorna à wallet. A saída em moeda local é uma operação posterior.',
        points: 10,
      },
    ],
  },
  {
    id: 3,
    title: 'Dólar, euro e diversificação',
    subtitle: 'USDC e EURC',
    icon: 'currency-exchange',
    duration: '2 min',
    version: 1,
    cards: [
      {
        title: 'Duas moedas de referência',
        content:
          'USDC busca acompanhar o dólar; EURC busca acompanhar o euro. Ambos têm riscos, como perda de paridade e problemas do emissor.',
      },
      {
        title: 'Câmbio também oscila',
        content:
          'Dólar e euro variam em relação ao real e entre si. Converter USDC em EURC tem uma cotação, custos e possível slippage. Diversificar moeda não elimina o risco da estratégia.',
      },
    ],
    questions: [
      {
        id: 'lesson-3-q-1',
        question: 'Qual moeda o EURC busca acompanhar?',
        options: [
          {
            id: 'a',
            text: 'Real',
          },
          {
            id: 'b',
            text: 'Euro',
          },
          {
            id: 'c',
            text: 'Dólar',
          },
        ],
        correctOptionId: 'b',
        explanation: 'EURC tem o euro como referência.',
        points: 10,
      },
      {
        id: 'lesson-3-q-2',
        question: 'USDC e EURC garantem valor constante em reais?',
        options: [
          {
            id: 'a',
            text: 'Sim',
          },
          {
            id: 'b',
            text: 'Só nos fins de semana',
          },
          {
            id: 'c',
            text: 'Não, o câmbio varia',
          },
        ],
        correctOptionId: 'c',
        explanation:
          'Stablecoin em dólar ou euro continua exposta ao câmbio frente ao real.',
        points: 10,
      },
      {
        id: 'lesson-3-q-3',
        question: 'O que verificar ao converter USDC em EURC?',
        options: [
          {
            id: 'a',
            text: 'Cotação, custos e valor mínimo a receber',
          },
          {
            id: 'b',
            text: 'Só o nome do token',
          },
          {
            id: 'c',
            text: 'Nada: sempre são equivalentes',
          },
        ],
        correctOptionId: 'a',
        explanation: 'A conversão depende da cotação e da liquidez disponível.',
        points: 10,
      },
    ],
  },
  {
    id: 4,
    title: 'XLM e volatilidade',
    subtitle: 'Entendendo exposição a cripto',
    icon: 'show-chart',
    duration: '2 min',
    version: 1,
    cards: [
      {
        title: 'XLM não é stablecoin',
        content:
          'XLM é o ativo nativo da Stellar. Seu preço pode subir ou cair bastante. Ele não busca manter paridade com dólar ou euro.',
      },
      {
        title: 'Mais unidades, menos valor',
        content:
          'Mesmo recebendo rendimento em XLM, seu saldo pode valer menos em reais ou dólares se a cotação cair. Pontos liberam acesso, mas não tornam o investimento adequado para todos.',
      },
    ],
    questions: [
      {
        id: 'lesson-4-q-1',
        question: 'XLM mantém paridade com o dólar?',
        options: [
          {
            id: 'a',
            text: 'Sim, sempre',
          },
          {
            id: 'b',
            text: 'Não, seu preço varia',
          },
          {
            id: 'c',
            text: 'Sim, quando está no vault',
          },
        ],
        correctOptionId: 'b',
        explanation: 'O vault não transforma XLM em uma stablecoin.',
        points: 10,
      },
      {
        id: 'lesson-4-q-2',
        question: 'Receber mais XLM garante mais dinheiro em reais?',
        options: [
          {
            id: 'a',
            text: 'Sim',
          },
          {
            id: 'b',
            text: 'Sim, se o APY for positivo',
          },
          {
            id: 'c',
            text: 'Não, a queda do preço pode superar o rendimento',
          },
        ],
        correctOptionId: 'c',
        explanation:
          'Quantidade do ativo e valor em moeda local são coisas diferentes.',
        points: 10,
      },
      {
        id: 'lesson-4-q-3',
        question: 'O que significa liberar o vault XLM?',
        options: [
          {
            id: 'a',
            text: 'Você pode escolher usá-lo, entendendo seus riscos',
          },
          {
            id: 'b',
            text: 'O PigFi garante seu lucro',
          },
          {
            id: 'c',
            text: 'Você precisa investir nele',
          },
        ],
        correctOptionId: 'a',
        explanation:
          'A liberação permite escolher; não obriga nem garante resultado.',
        points: 10,
      },
    ],
  },
  {
    id: 5,
    title: 'Liquidez e saída',
    subtitle: 'Resgate e conversão',
    icon: 'water-drop',
    duration: '2 min',
    version: 1,
    cards: [
      {
        title: 'De onde vem o rendimento',
        content:
          'Na estratégia Blend, ativos são emprestados e podem gerar juros. A DeFindex automatiza a estratégia. Taxas variam; não há promessa de rendimento fixo.',
      },
      {
        title: 'Sair tem duas etapas',
        content:
          'O resgate depende da liquidez do vault e do protocolo. Para receber moeda local pela BlindPay, pode ser necessário converter EURC ou XLM em USDC. Essa conversão também depende de liquidez e cotação.',
      },
    ],
    questions: [
      {
        id: 'lesson-5-q-1',
        question: 'O TVL garante que todo o dinheiro pode ser sacado agora?',
        options: [
          {
            id: 'a',
            text: 'Não, parte pode estar emprestada',
          },
          {
            id: 'b',
            text: 'Sim, sempre',
          },
          {
            id: 'c',
            text: 'Sim, para XLM',
          },
        ],
        correctOptionId: 'a',
        explanation:
          'TVL é o total alocado, não o saldo disponível para saque imediato.',
        points: 10,
      },
      {
        id: 'lesson-5-q-2',
        question:
          'Ao sair de um vault XLM pela BlindPay, o que pode ser necessário?',
        options: [
          {
            id: 'a',
            text: 'Criar outra conta PigFi',
          },
          {
            id: 'b',
            text: 'Converter XLM em USDC na wallet',
          },
          {
            id: 'c',
            text: 'Esperar XLM virar stablecoin',
          },
        ],
        correctOptionId: 'b',
        explanation: 'A conversão é separada do resgate e do on/off-ramp.',
        points: 10,
      },
      {
        id: 'lesson-5-q-3',
        question: 'Um APY passado garante o rendimento futuro?',
        options: [
          {
            id: 'a',
            text: 'Sim',
          },
          {
            id: 'b',
            text: 'Só para stablecoins',
          },
          {
            id: 'c',
            text: 'Não, a taxa e os riscos podem mudar',
          },
        ],
        correctOptionId: 'c',
        explanation: 'APY é uma medida ou estimativa, não uma garantia.',
        points: 10,
      },
    ],
  },
];
