import { LearningContentType } from '@prisma/client';

// Internal catalog revision. Increment whenever learner-facing copy, ordering or
// choices change. Stable legacy mappings preserve progress during this upgrade.
export const LEARNING_CATALOG_VERSION = 4;

type Option = { key: string; text: string };
type Question = {
  key: string;
  legacyKey: string;
  order: number;
  title: string;
  situation: { text?: string; card?: string[] };
  prompt: string;
  options: Option[];
  correct: string;
  success: string;
  retry: string;
  reviewScreenKey: string;
  valuesExample?: boolean;
  proSuccessAddition?: string;
};
type Content = {
  key: string;
  type: LearningContentType;
  title: string;
  content: Record<string, unknown>;
  order: number;
  required?: boolean;
};

const choices = (...texts: string[]): Option[] =>
  texts.map((text, index) => ({
    key: String.fromCharCode(65 + index),
    text,
  }));

const question = (
  key: string,
  legacyKey: string,
  order: number,
  title: string,
  situation: Question['situation'],
  prompt: string,
  options: string[],
  correct: string,
  success: string,
  retry: string,
  reviewScreenKey: string,
  extras: Pick<Question, 'valuesExample' | 'proSuccessAddition'> = {},
): Question => ({
  key,
  legacyKey,
  order,
  title,
  situation,
  prompt,
  options: choices(...options),
  correct,
  success,
  retry,
  reviewScreenKey,
  ...extras,
});

const screen = (
  key: string,
  order: number,
  title: string,
  guide: string,
  visual: string,
  explanation: string,
  extras: {
    newTerm?: string;
    valuesExample?: boolean;
    proAddition?: string;
    developerNote?: string;
  } = {},
): Content => ({
  key,
  order,
  title,
  type: LearningContentType.EXPLANATION,
  content: { guide, visual, explanation, ...extras },
  required: true,
});

const reflection = (
  key: string,
  order: number,
  title: string,
  text: string,
  response: string,
  developerNote: string,
): Content => ({
  key,
  order,
  title,
  type: LearningContentType.REFLECTION,
  content: { text, response, developerNote },
});

export const learningCatalog = [
  {
    key: 'M1',
    order: 1,
    title: 'Fundamentos',
    description:
      'Do dinheiro que você conhece às moedas digitais, com lastro, programas e liquidez.',
    content: [
      screen(
        'L1-T01',
        1,
        'Dinheiro sem nota de papel',
        'Quando você recebe um Pix de R$20, não recebe uma nota na mão.',
        'Aviso de Pix recebido no celular, com “+R$20”.',
        'Mesmo assim, você vê o valor e pode usar. Você já lida com dinheiro digital.',
      ),
      screen(
        'L1-T02',
        3,
        'Quem anota o que aconteceu?',
        'Num Pix, o banco anota quem enviou e quem recebeu, num registro só dele.',
        'Um caderno sozinho ao lado de várias cópias iguais, cada uma num computador, ligadas entre si.',
        'Algumas moedas digitais usam outro sistema: muitas cópias do registro, conferidas por muitos computadores. Se alguém muda uma cópia, os outros percebem.',
        {
          proAddition:
            'Essa tecnologia se chama blockchain. A rede usada pelo PigFi é a Stellar.',
        },
      ),
      screen(
        'L1-T03',
        4,
        'Dólar e euro no celular',
        'Existem moedas digitais feitas para acompanhar o dólar e o euro.',
        '“1 dólar digital ≈ 1 dólar” e “1 euro digital ≈ 1 euro”, com os ícones das moedas.',
        'Elas procuram ficar perto de 1 dólar ou de 1 euro. Em reais, o preço delas muda quando o dólar ou o euro mudam.',
        {
          newTerm: 'dólar digital e euro digital',
          proAddition:
            'Moedas digitais que buscam manter o valor de uma referência se chamam stablecoins.',
        },
      ),
      screen(
        'L1-T04',
        6,
        'O que existe por trás desse valor?',
        'Num guarda-volumes, o comprovante representa algo que ficou guardado.',
        'Comprovante ligado a uma caixa no guarda-volumes.',
        'A empresa que emite o dólar digital e o euro digital informa guardar reservas para apoiar o valor delas. Esse apoio se chama lastro.',
        {
          newTerm: 'lastro',
          proAddition: 'A empresa que emite o USDC e o EURC é a Circle.',
        },
      ),
      screen(
        'L1-T05',
        7,
        'Lastro não é preço fixo',
        'Imagine uma moeda digital que representa ouro guardado.',
        'Barra de ouro com uma etiqueta de preço que sobe e desce.',
        'O preço do ouro sobe e desce. Ter algo por trás e ter preço fixo são coisas diferentes.',
      ),
      screen(
        'L1-T06',
        9,
        'Programas que seguem regras',
        'Numa máquina de bebidas, você escolhe, paga e ela entrega, seguindo regras.',
        'Máquina de bebidas ao lado de um programa com as etapas “escolher, pagar, entregar”.',
        'Na rede das moedas digitais, há programas que seguem regras para movimentar dinheiro, como em empréstimos. Eles podem ter falhas e não garantem ganho.',
        {
          proAddition:
            'Esses programas se chamam contratos inteligentes, e os serviços financeiros feitos com eles formam o DeFi (finanças descentralizadas).',
        },
      ),
      screen(
        'L1-T07',
        11,
        'Quando posso usar o dinheiro?',
        'Ter R$100 na mão é diferente de ter um objeto que vale R$100 e precisa ser vendido.',
        'Nota pronta para usar ao lado de um objeto com a etiqueta “precisa vender”.',
        'Antes de guardar, pergunte: consigo tirar quando precisar? Em quanto tempo e quanto recebo? Essa facilidade se chama liquidez.',
        { newTerm: 'liquidez' },
      ),
      reflection(
        'L1-A01',
        14,
        'Meu plano',
        'Quero guardar para ___. Acho que vou precisar em ___. Vou pagar em reais, dólares, euros ou ainda não sei.',
        'Tudo bem ainda não saber. Você pode mudar essas respostas enquanto aprende.',
        'Responder por opções ou por texto; “Ainda não sei” vale em qualquer campo. Sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'L1-Q01',
        'M1-Q01',
        2,
        'O Pix mudou a moeda?',
        { text: 'Ana mandou R$20 por Pix para a irmã.' },
        'O que a irmã recebeu?',
        [
          'Uma moeda nova chamada Pix.',
          'R$20, enviados pelo aplicativo.',
          '20 dólares.',
        ],
        'B',
        'O Pix é um jeito de enviar reais. Ele não troca a moeda.',
        'Um envelope leva a carta, mas não muda o que está escrito nela. O Pix leva o real.',
        'L1-T01',
      ),
      question(
        'L1-Q02',
        'M1-Q02',
        5,
        'Duas moedas digitais',
        { text: 'Você tem dólar digital e euro digital na carteira.' },
        'O que cada uma procura acompanhar?',
        [
          'O dólar digital, o dólar; o euro digital, o euro.',
          'O dólar digital, o real; o euro digital, o dólar.',
          'As duas, o mesmo valor em reais todo dia.',
        ],
        'A',
        'Cada uma acompanha a sua moeda. O preço delas em reais ainda pode mudar.',
        'Pense nas etiquetas: dólar digital, perto de 1 dólar; euro digital, perto de 1 euro.',
        'L1-T03',
      ),
      question(
        'L1-Q03',
        'M1-Q03',
        8,
        'O que é o lastro?',
        {
          text: 'Uma moeda digital tem ouro guardado para apoiar o seu valor.',
        },
        'O preço dela em reais pode mudar?',
        [
          'Não, porque existe ouro guardado.',
          'Não, porque ela só existe no celular.',
          'Sim, porque o preço do ouro sobe e desce.',
        ],
        'C',
        'O ouro é o lastro, mas o preço dele muda.',
        'Uma joia continua sendo de ouro quando o preço do ouro muda. Lastro não é preço fixo.',
        'L1-T05',
      ),
      question(
        'L1-Q04',
        'M1-Q04',
        10,
        'Quem segue as regras?',
        { text: 'Uma operação de empréstimo acontece na rede.' },
        'Quem executa as regras dessa operação?',
        [
          'Programas que seguem as regras combinadas.',
          'Um atendente que aprova cada operação.',
          'A própria moeda, sem programa.',
        ],
        'A',
        'São esses programas que executam as operações.',
        'Na máquina de bebidas, é a máquina que segue as instruções. Na rede, são os programas.',
        'L1-T06',
        { proSuccessAddition: 'Eles se chamam contratos inteligentes.' },
      ),
      question(
        'L1-Q05',
        'M1-Q05',
        12,
        'Vou precisar amanhã',
        { text: 'João precisa de R$200 amanhã.' },
        'Antes de guardar hoje, o que ele deve conferir?',
        [
          'Se muita gente usa o aplicativo.',
          'Se consegue tirar a tempo e quanto recebe.',
          'Se o nome da moeda é conhecido.',
        ],
        'B',
        'Isso é olhar a liquidez: quando e como o dinheiro volta para você.',
        'Saber que algo vale R$200 não basta: o João precisa do dinheiro na hora certa.',
        'L1-T07',
      ),
      question(
        'L1-Q06',
        'M1-Q06',
        13,
        'Minha conta é em reais',
        { card: ['Curso: R$300', 'Seu saldo: em dólar digital'] },
        'Como saber se já dá para pagar?',
        [
          'Olhar só quantos dólares digitais tenho.',
          'Olhar o XP das lições.',
          'Ver quanto recebo em reais, depois da troca e das cobranças.',
        ],
        'C',
        'O curso é pago em reais: compare o valor final com os R$300.',
        'Com dinheiro de viagem, você confere quanto ele vale em reais antes de pagar uma conta aqui.',
        'L1-T07',
      ),
    ],
  },
  {
    key: 'M2',
    order: 2,
    title: 'Como o dinheiro entra e sai',
    proTitle: 'Wallet/Ramp/Vault',
    description:
      'Separar depósito por Pix, carteira e porquinho e entender a taxa ao ano.',
    content: [
      screen(
        'L2-T01',
        1,
        'Trocar, receber e guardar',
        'Numa viagem, você troca reais pela moeda, recebe e só depois decide o que fazer.',
        'Três passos em sequência: “Depositar pelo Pix”, “Dólar digital na carteira” e “Guardar no porquinho”.',
        'No PigFi também são passos separados. Você deposita reais pelo Pix, uma empresa parceira troca por dólar digital e ele chega à sua carteira.',
      ),
      screen(
        'L2-T02',
        3,
        'A carteira e o porquinho',
        'A carteira é onde você recebe e movimenta suas moedas. Elas ficam registradas na rede, não dentro do celular.',
        'Carteira e porquinho lado a lado, com “Guardar” entre eles.',
        'Guardar no porquinho é outro passo: você escolhe, confere e confirma. Cada porquinho tem uma moeda e regras próprias, e não é um cofre com valor garantido.',
      ),
      screen(
        'L2-T03',
        5,
        'De onde vem o dinheiro a mais?',
        'Nos porquinhos do PigFi, o dinheiro guardado é emprestado a quem precisa, por meio de um serviço de empréstimos.',
        'Dinheiro saindo do porquinho para quem pega emprestado e voltando com juros.',
        'Quem pega emprestado paga juros. Esses juros, com alguns prêmios do serviço, formam o ganho do porquinho. A taxa muda e não é garantida.',
        {
          developerNote:
            'Os três porquinhos atuais usam estratégia de empréstimos. Se um porquinho futuro tiver outra origem de ganho, revisar esta tela.',
          proAddition:
            'O serviço de empréstimos é o Blend; cada vault usa uma estratégia do DeFindex sobre ele.',
        },
      ),
      screen(
        'L2-T04',
        7,
        'Uma taxa para o ano',
        'Imagine um porquinho mostrando “5% ao ano”.',
        '“100 moedas → cerca de 105 em um ano”, com a linha “se a taxa não mudar”.',
        'Seriam cerca de 5 moedas a mais em um ano, se a taxa ficasse igual. Não são 5 por mês, nem uma promessa.',
        {
          valuesExample: true,
          proAddition: 'APY é a taxa anual que considera o ganho reinvestido.',
        },
      ),
      screen(
        'L2-T05',
        9,
        'Confirmar é autorizar',
        'Antes de um Pix, você confere quem recebe e quanto vai enviar.',
        'Tela de confirmação com moeda, quantidade, destino e cobranças em destaque.',
        'Aqui é igual: confira a moeda, a quantidade, o destino e as cobranças. Ao confirmar, você autoriza o que está na tela.',
      ),
      screen(
        'L2-T06',
        11,
        'Aprender e guardar têm marcadores diferentes',
        'No PigFi, há dois marcadores diferentes.',
        'O nível do porquinho ao lado do Nível de Usuário, cada um com o que acompanha.',
        'O nível do porquinho acompanha o valor guardado em dólar digital e em euro digital. O Nível de Usuário acompanha o seu aprendizado: cada lição concluída dá XP, que não é dinheiro.',
      ),
      reflection(
        'L2-A01',
        13,
        'Conte para alguém de casa',
        'Imagine que alguém pergunta: “Fiz o Pix. Já está guardado no porquinho?” Como você explicaria os passos?',
        'Um jeito de explicar: primeiro os reais viram dólar digital, que chega à carteira. Depois eu escolho um porquinho e confirmo para guardar.',
        'Aceitar resposta falada para si mesmo, texto opcional ou só abrir “Ver um exemplo”. Não avaliar vocabulário. Sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'L2-Q02',
        'M2-Q02',
        2,
        'Qual é a ordem?',
        {
          text: 'Você quer guardar no porquinho em dólar a partir dos seus reais.',
        },
        'Qual é o caminho?',
        [
          'Depositar pelo Pix, receber na carteira e guardar no porquinho.',
          'Fazer o Pix e deixar o app escolher onde guardar.',
          'Guardar primeiro e escolher a moeda depois.',
        ],
        'A',
        'Assim você sabe onde está o dinheiro em cada passo.',
        'São três passos: depositar, receber e guardar. Nada acontece sozinho.',
        'L2-T01',
      ),
      question(
        'L2-Q01',
        'M2-Q01',
        4,
        'Na carteira ou no porquinho?',
        { text: 'O dólar digital chegou à sua carteira.' },
        'Quando ele passa a estar no porquinho?',
        [
          'Assim que aparece na carteira.',
          'Quando você conclui uma lição.',
          'Depois que você confirma guardar no porquinho.',
        ],
        'C',
        'Receber na carteira e guardar no porquinho são dois passos.',
        'Ter dinheiro na carteira não quer dizer que ele está no porquinho. Você escolhe e confirma.',
        'L2-T02',
      ),
      question(
        'L2-Q03',
        'M2-Q03',
        6,
        'De onde vem o dinheiro a mais?',
        { text: 'Um porquinho empresta o dinheiro guardado.' },
        'De onde vem o ganho dele?',
        [
          'Do XP das lições.',
          'Dos juros pagos por quem pegou emprestado.',
          'Do nome “dólar digital”.',
        ],
        'B',
        'É dos juros que vem o ganho do porquinho.',
        'Quem pega emprestado paga um valor a mais. O XP do app não vira dinheiro.',
        'L2-T03',
      ),
      question(
        'L2-Q04',
        'M2-Q04',
        8,
        'Entendendo “5% ao ano”',
        { text: 'Um porquinho mostra 5% ao ano.' },
        'O que isso quer dizer?',
        [
          '5 moedas a mais todo mês.',
          '5 reais a mais, com certeza.',
          'Uma taxa para um ano, que pode mudar.',
        ],
        'C',
        '“Ao ano” é o período. E a taxa muda: não é garantida.',
        'É como a previsão de tempo de uma viagem: ajuda a planejar, mas pode mudar.',
        'L2-T04',
        { valuesExample: true },
      ),
      question(
        'L2-Q05',
        'M2-Q05',
        10,
        'Conferir antes de confirmar',
        {
          text: 'Você queria guardar em dólar, mas a confirmação mostra o porquinho em euro.',
        },
        'O que fazer?',
        [
          'Voltar e conferir.',
          'Confirmar para não perder o XP.',
          'Confirmar, porque o app sabe o que eu quero.',
        ],
        'A',
        'Confirmar tem que representar a sua escolha.',
        'Como num Pix: se algo não está como você queria, volte e revise.',
        'L2-T05',
      ),
      question(
        'L2-Q06',
        'M2-Q06',
        12,
        'Ganhei XP. Ganhei dinheiro?',
        { text: 'Você concluiu uma lição e ganhou XP. Não guardou nada.' },
        'O que aumentou?',
        [
          'O dinheiro guardado.',
          'O seu progresso no app.',
          'O ganho do porquinho.',
        ],
        'B',
        'O XP mostra o seu progresso. O dinheiro é acompanhado à parte.',
        'Uma medalha reconhece o que você fez, mas não coloca dinheiro na carteira.',
        'L2-T06',
      ),
    ],
  },
  {
    key: 'M3',
    order: 3,
    title: 'Misturando dólar e euro',
    proTitle: 'Diversificação dólar/euro',
    description:
      'Entender câmbio, diversificação e o caminho para voltar a reais.',
    content: [
      screen(
        'L3-T01',
        1,
        'A moeda do seu plano',
        'Cada plano tem uma moeda. Veja dois exemplos:',
        'Dois cartões: “Viagem para a Europa · Os preços estão em euro” e “Curso no Brasil · Você paga em reais”.',
        'Saber em que moeda será a despesa ajuda a acompanhar quanto falta.',
      ),
      screen(
        'L3-T02',
        2,
        'O euro digital em reais',
        'O euro digital procura acompanhar o euro.',
        '“1 euro digital ≈ 1 euro” e, abaixo, “Em reais: muda”.',
        'Ele pode ficar perto de 1 euro e, mesmo assim, mudar de preço em reais.',
      ),
      screen(
        'L3-T03',
        3,
        'O preço da troca',
        'Imagine que hoje você precisa de R$6 para comprar 1 euro.',
        'Cartão “Você dá R$6 · Você recebe 1 euro” e a linha “Amanhã pode ser mais ou menos”.',
        'Em outro dia, você pode precisar de mais ou de menos reais. Esse preço de uma moeda em outra é o câmbio.',
        { newTerm: 'câmbio', valuesExample: true },
      ),
      screen(
        'L3-T04',
        5,
        'Dólar e euro juntos',
        'Imagine que você guarda uma parte em dólar digital e outra em euro digital.',
        'Cartão dividido em “Dólar” e “Euro”, com a linha “Cada moeda pode mudar de preço de um jeito”.',
        'Isso é diversificar: distribuir entre opções diferentes. Muda a combinação do que você tem, mas não garante que o total aumente.',
        { newTerm: 'diversificar' },
      ),
      screen(
        'L3-T05',
        7,
        'Quanto posso tirar agora?',
        'Imagine uma caixa com dez moedas. Nove foram emprestadas.',
        'Caixa com dez moedas: nove marcadas “emprestada” e uma “disponível”.',
        'Só uma está disponível agora. Num porquinho que empresta, o total guardado pode ser maior do que o que dá para tirar na hora. Isso também é liquidez.',
      ),
      screen(
        'L3-T06',
        9,
        'Tirar, trocar e sacar',
        'Para usar em reais o que está no porquinho em euro, são três passos.',
        '“Tirar do porquinho”, “Trocar por dólar digital” e “Sacar pelo Pix”, em sequência.',
        'Conseguir um passo não garante o seguinte. É como voltar de viagem com euros: ainda é preciso trocar, e você confere o preço antes.',
        {
          developerNote:
            'O caminho de volta do euro é tirar, trocar por dólar digital e sacar. Não prometer troca direta para reais, tirada na hora nem prazo fixo.',
        },
      ),
      screen(
        'L3-T07',
        11,
        'Lastro não define a hora de tirar',
        'O lastro apoia o valor da moeda. O porquinho é onde você escolheu guardar.',
        'Dois cartões: “Lastro: apoia o valor” e “Porquinho: onde está guardado”.',
        'Ter reservas por trás do euro digital não garante tirar a qualquer momento. Confira como tirar, trocar e quando o dinheiro chega.',
      ),
      reflection(
        'L3-A01',
        14,
        'Onde quero entender melhor?',
        'Para voltar a usar em reais, quero entender melhor: tirar do porquinho, trocar a moeda ou sacar pelo Pix.',
        'Escolha um passo para rever a explicação. Você pode ver os três.',
        'Cada opção abre a explicação correspondente. Sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'L3-Q01',
        'M3-Q01',
        4,
        'O euro mudou de preço',
        {
          card: [
            'Você tem 10 euros digitais',
            'Antes: 1 euro = R$5 · cerca de R$50',
            'Agora: 1 euro = R$6 · cerca de R$60',
          ],
        },
        'Sem outra mudança, o que aconteceu?',
        [
          'Continuam valendo R$50.',
          'A quantidade é a mesma, e vale mais em reais.',
          'Ganhei mais euros digitais.',
        ],
        'B',
        '10 × R$6 = R$60. A quantidade não mudou: mudou o preço do euro.',
        'É como voltar de viagem com as mesmas notas de euro: na troca, você recebe outro valor em reais.',
        'L3-T03',
        { valuesExample: true },
      ),
      question(
        'L3-Q02',
        'M3-Q02',
        6,
        'Ter dólar e euro',
        {
          text: 'Bia guarda uma parte em dólar digital e outra em euro digital.',
        },
        'O que essa escolha faz?',
        [
          'Ela tem duas moedas, que mudam de preço de formas diferentes.',
          'O total nunca diminui em reais.',
          'Uma sempre sobe quando a outra cai.',
        ],
        'A',
        'Isso é diversificar: muda a combinação, mas não garante ganho.',
        'Duas plantas reagem de jeitos diferentes ao tempo, mas uma não melhora só porque a outra piorou.',
        'L3-T04',
      ),
      question(
        'L3-Q03',
        'M3-Q03',
        8,
        'Quanto está disponível agora?',
        { text: 'Na caixa com dez moedas, nove foram emprestadas.' },
        'Dá para entregar cinco agora, só com o que ficou?',
        [
          'Sim, a caixa tinha dez.',
          'Sim, porque elas acompanham o euro.',
          'Não, só uma está disponível.',
        ],
        'C',
        'O total guardado pode ser diferente do que está disponível agora.',
        'Conte só o que ficou: uma moeda. As outras nove ainda não voltaram.',
        'L3-T05',
      ),
      question(
        'L3-Q04',
        'M3-Q04',
        10,
        'Já chegou ao banco?',
        {
          text: 'Você tirou euro digital do porquinho, e ele chegou à carteira.',
        },
        'O dinheiro já está em reais no banco?',
        [
          'Sim, tirar já resolve tudo.',
          'Não, ainda falta trocar e sacar pelo Pix.',
          'Sim, a carteira e o banco têm o mesmo saldo.',
        ],
        'B',
        'Trocar e sacar em reais são os próximos passos.',
        'Com euros na carteira de viagem, o dinheiro está com você, mas ainda não virou reais.',
        'L3-T06',
      ),
      question(
        'L3-Q05',
        'M3-Q05',
        12,
        'Lastro e saída são a mesma coisa?',
        { text: 'O euro digital tem reservas que apoiam o seu valor.' },
        'Dá para tirar tudo do porquinho na mesma hora?',
        [
          'Sim, reservas e porquinho são a mesma coisa.',
          'Sim, acompanhar o euro garante a saída.',
          'Não necessariamente: é preciso ver o que está disponível.',
        ],
        'C',
        'Uma coisa é o que apoia a moeda. Outra é quando ela pode ser tirada.',
        'Uma nota verdadeira emprestada não volta ao seu bolso na hora só por ser verdadeira.',
        'L3-T07',
      ),
      question(
        'L3-Q06',
        'M3-Q06',
        13,
        'Preciso pagar amanhã',
        { text: 'Você vai pagar uma conta em reais amanhã.' },
        'Antes de guardar hoje no porquinho em euro, o que perguntar?',
        [
          'Consigo tirar, trocar e sacar a tempo? Quanto recebo?',
          'Qual porquinho tem a maior taxa?',
          'Se acompanha o euro, vai estar disponível amanhã?',
        ],
        'A',
        'O prazo precisa combinar com a sua conta. Você pode seguir ou esperar.',
        'Uma taxa alta não paga a conta de amanhã se o dinheiro não chegar a tempo.',
        'L3-T06',
      ),
    ],
  },
  {
    key: 'M4',
    order: 4,
    title: 'Quando o preço oscila',
    proTitle: 'Volatilidade de XLM',
    description:
      'Distinguir quantidade, preço, volatilidade e resultado em reais.',
    content: [
      screen(
        'L4-T01',
        1,
        'Outra moeda, outra função',
        'Você já conhece o dólar digital e o euro digital. A criptomoeda do PigFi é diferente.',
        'A criptomoeda ao lado do dólar digital e do euro digital; só os dois últimos têm as etiquetas “≈ 1 dólar” e “≈ 1 euro”.',
        'Ela não acompanha o dólar nem o euro. É a moeda da própria rede e serve, por exemplo, para pagar as pequenas taxas da rede.',
        {
          proAddition: 'A criptomoeda é o XLM, a moeda nativa da rede Stellar.',
        },
      ),
      screen(
        'L4-T02',
        3,
        'A etiqueta de preço muda',
        'Pense no preço de uma fruta na feira: hoje mais cara, amanhã mais barata.',
        'Etiqueta de preço com um gráfico pequeno que sobe e desce.',
        'O preço da criptomoeda também muda, conforme as pessoas compram e vendem. Essas subidas e descidas se chamam volatilidade.',
        { newTerm: 'volatilidade' },
      ),
      screen(
        'L4-T03',
        5,
        'Duas coisas para olhar',
        'Para saber o total, olhe quantas unidades você tem e quanto vale cada uma.',
        '“10 unidades × R$1 = R$10”.',
        'Mesmo que o porquinho acrescente unidades, uma queda de preço pode fazer o total valer menos em reais.',
        { valuesExample: true },
      ),
      screen(
        'L4-T04',
        8,
        'A escolha continua sua',
        'Antes de escolher, pense no seu plano.',
        'Três cartões: “Se cair, afeta meu plano?”, “Quando vou precisar?” e “Como faço para tirar?”.',
        'Aprender sobre a criptomoeda não obriga você a guardar nela. Você pode conhecer, comparar e decidir depois.',
      ),
      reflection(
        'L4-A01',
        11,
        'Meu plano com valores diferentes',
        'Você separou R$100 para um plano. Imagine três resultados: R$80, R$100 ou R$120. O que cada um mudaria nesse plano?',
        'Pensar nisso ajuda a ver quanto uma mudança de valor afetaria você. Nenhuma resposta obriga você a guardar em algum porquinho.',
        'Para cada valor, oferecer “mudaria muito”, “mudaria pouco” e “quero pensar mais”. Não atribuir perfil de risco nem sugerir porquinho. Sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'L4-Q01',
        'M4-Q01',
        2,
        'O que muda na criptomoeda?',
        { text: 'Você está comparando a criptomoeda com o dólar digital.' },
        'Qual é a diferença principal?',
        [
          'Ela também vale sempre perto de 1 dólar.',
          'É a moeda da rede, e o preço não acompanha dólar nem euro.',
          'Ela vale os mesmos reais todo dia.',
        ],
        'B',
        'Ela tem uma função na rede, e o preço sobe e desce com as negociações.',
        'Passar pela mesma estrada não faz tudo ter o mesmo preço.',
        'L4-T01',
      ),
      question(
        'L4-Q04',
        'M4-Q04',
        4,
        'Subiu ontem. E amanhã?',
        { text: 'O preço da criptomoeda subiu nos últimos três dias.' },
        'O que esperar de amanhã?',
        ['Vai subir de novo.', 'Pode subir ou cair.', 'Vai ficar igual.'],
        'B',
        'O passado mostra o que aconteceu, mas não decide o preço de amanhã.',
        'Saber o preço da fruta ontem não garante o preço na próxima feira.',
        'L4-T02',
      ),
      question(
        'L4-Q02',
        'M4-Q02',
        6,
        'Quantidade e preço',
        {
          card: [
            'Você tem 10 unidades',
            'Antes: R$1 cada · R$10',
            'Agora: R$2 cada',
          ],
        },
        'Sem comprar nem vender, o que você tem agora?',
        [
          '20 unidades.',
          '10 unidades, valendo R$10.',
          '10 unidades, valendo R$20.',
        ],
        'C',
        '10 × R$2 = R$20. A quantidade é a mesma: mudou o preço.',
        'Trocar a etiqueta de preço não muda quantos produtos há na prateleira.',
        'L4-T03',
        { valuesExample: true },
      ),
      question(
        'L4-Q03',
        'M4-Q03',
        7,
        'Ganhou unidades e vale menos?',
        {
          card: ['Antes: 10 unidades × R$2 = R$20', 'Agora: 11 unidades × R$1'],
        },
        'Quanto vale agora?',
        [
          'R$11: mais unidades, menos reais.',
          'R$22, porque a quantidade aumentou.',
          'R$20, porque o valor não muda.',
        ],
        'A',
        '11 × R$1 = R$11. Ganhar unidades não é o mesmo que ganhar reais.',
        'Olhe as duas coisas: quantas unidades e quanto vale cada uma agora.',
        'L4-T03',
        { valuesExample: true },
      ),
      question(
        'L4-Q05',
        'M4-Q05',
        9,
        'Combina com o meu plano?',
        { text: 'Você quer pagar um curso em reais daqui a alguns meses.' },
        'Antes de escolher a criptomoeda, o que perguntar?',
        [
          'Quantas pessoas escolheram?',
          'Se subiu, vai continuar subindo?',
          'Se o preço cair, ainda consigo pagar o curso?',
        ],
        'C',
        'Essa pergunta liga a escolha ao que importa: o seu plano.',
        'Imagine chegar ao curso com as mesmas unidades, mas menos reais.',
        'L4-T04',
      ),
      question(
        'L4-Q06',
        'M4-Q06',
        10,
        'Aprendi. Preciso guardar?',
        {
          text: 'Imagine que você concluiu as lições e o porquinho em criptomoeda foi liberado.',
        },
        'O que você pode fazer?',
        [
          'Escolher a criptomoeda, continuar como está ou decidir depois.',
          'Guardar nela para não perder o que aprendeu.',
          'Trocar todo o saldo, porque a opção nova é melhor.',
        ],
        'A',
        'Aprender abre opções. A decisão continua sua.',
        'Conhecer um caminho novo não obriga você a passar por ele.',
        'L4-T04',
      ),
    ],
  },
  {
    key: 'M5',
    order: 5,
    title: 'Tirar quando precisar',
    proTitle: 'Liquidez e saída',
    description: 'Planejar retirada, troca, saque, cotação e valor final.',
    content: [
      screen(
        'L5-T01',
        1,
        'O destino é a sua conta',
        'Para receber reais no banco, o caminho tem paradas, e cada uma tem as suas condições.',
        '“Tirar do porquinho”, “Trocar por dólar digital (se precisar)” e “Sacar pelo Pix”, em sequência, com o banco no fim.',
        'Se o dinheiro estiver em euro digital ou em criptomoeda, ele vira dólar digital antes do saque. Tirar do porquinho não quer dizer que os reais já chegaram.',
      ),
      screen(
        'L5-T02',
        4,
        'Quanto vou receber na troca?',
        'Antes de trocar, o app mostra uma cotação: quanto você entrega e quanto recebe naquele momento.',
        'Cotação com “Você entrega”, “Você recebe”, as cobranças e “Vale por pouco tempo”.',
        'É como um orçamento: tem prazo. Se o prazo acabar, peça um preço atualizado e decida de novo.',
        { newTerm: 'cotação' },
      ),
      screen(
        'L5-T03',
        6,
        'Compare o valor final',
        'Numa compra, o mais barato pode mudar quando você soma o frete.',
        'Duas opções lado a lado: “R$100, menos R$4 de cobranças” e “R$99, menos R$1 de cobranças”.',
        'Numa troca também: compare o que sobra depois de todas as cobranças.',
        { valuesExample: true },
      ),
      screen(
        'L5-T04',
        8,
        'Estudar não é condição para tirar',
        'Se você parar de fazer as lições, nada muda no acesso ao seu dinheiro.',
        'Saldo e botão “Tirar” disponíveis, sem cadeado.',
        'Você continua vendo o saldo e tirando o dinheiro: isso depende só das condições do porquinho. Antes de guardar pela primeira vez no porquinho em euro ou em criptomoeda, você lê os riscos.',
      ),
      reflection(
        'L5-A01',
        11,
        'Minha escolha em palavras simples',
        'Quero guardar para ___. Estou conhecendo a moeda ___. O preço dela pode mudar porque ___. Para usar o dinheiro depois, preciso ___. Minha dúvida agora é ___.',
        'Você pode continuar aprendendo, ver as opções ou decidir depois.',
        'Mostrar exemplos ao lado dos campos e permitir pular. Não apresentar guardar como o final certo da atividade. Sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'L5-Q01',
        'M5-Q01',
        2,
        'Voltando para reais',
        { text: 'Você tem criptomoeda guardada e quer reais no banco.' },
        'Qual é a ordem?',
        [
          'Sacar pelo Pix e depois tirar do porquinho.',
          'Tirar do porquinho, trocar por dólar digital e sacar pelo Pix.',
          'Tirar do porquinho e sacar sem trocar.',
        ],
        'B',
        'São três passos, e o app mostra o que falta.',
        'Terminar um trecho da viagem não é chegar ao destino.',
        'L5-T01',
      ),
      question(
        'L5-Q04',
        'M5-Q04',
        3,
        'Não deu para tirar agora',
        {
          text: 'O app avisa que não há dinheiro disponível suficiente no porquinho agora.',
        },
        'O que fazer?',
        [
          'Concluir que o saldo sumiu.',
          'Ler a explicação, ver as opções e acompanhar o saldo.',
          'Guardar mais para conseguir tirar.',
        ],
        'B',
        'O aviso não quer dizer que o saldo sumiu. Entenda o motivo antes de decidir.',
        'Lembre da caixa com moedas emprestadas: a falta agora tem um motivo.',
        'L5-T01',
      ),
      question(
        'L5-Q02',
        'M5-Q02',
        5,
        'O preço da troca venceu',
        { text: 'O prazo da cotação acabou antes de você confirmar.' },
        'O que fazer?',
        [
          'Pedir o preço atualizado e decidir de novo.',
          'Contar com o preço antigo.',
          'Aceitar qualquer valor novo.',
        ],
        'A',
        'Você confere o preço novo e escolhe seguir ou esperar.',
        'Quando o orçamento vence, as condições precisam ser confirmadas de novo.',
        'L5-T02',
      ),
      question(
        'L5-Q03',
        'M5-Q03',
        7,
        'Quanto sobra depois das cobranças?',
        {
          card: ['Opção 1: R$100, cobra R$4', 'Opção 2: R$99, cobra R$1'],
        },
        'Qual deixa mais dinheiro para você?',
        [
          'A opção 1, porque mostra R$100.',
          'As duas deixam o mesmo valor.',
          'A opção 2: sobram R$98, contra R$96.',
        ],
        'C',
        'R$99 − R$1 = R$98. Compare sempre o que sobra no final.',
        'Como na compra com frete: o primeiro número não conta tudo.',
        'L5-T03',
        { valuesExample: true },
      ),
      question(
        'L5-Q05',
        'M5-Q05',
        9,
        'Fiquei alguns dias sem estudar',
        {
          text: 'Você ficou alguns dias sem lições e quer tirar o que guardou.',
        },
        'Precisa concluir alguma lição antes?',
        [
          'Não, lições e XP não são exigência para tirar.',
          'Sim, precisa concluir a trilha.',
          'Sim, se tiver criptomoeda guardada.',
        ],
        'A',
        'O acesso ao seu dinheiro não depende de estudar.',
        'Lições e XP acompanham o aprendizado. Eles nunca trancam o seu dinheiro.',
        'L5-T04',
      ),
      question(
        'L5-Q06',
        'M5-Q06',
        10,
        'Agora sei o que perguntar',
        { text: 'Você vai escolher um porquinho.' },
        'Quais perguntas ajudam?',
        [
          'Qual promete mais? Qual dá mais XP?',
          'Qual é o mais conhecido? Qual meus amigos usam?',
          'Qual moeda vou ter? De onde vem o ganho? Como eu tiro e quanto pago?',
        ],
        'C',
        'Essas perguntas ajudam a escolher pelo seu plano.',
        'Numa compra, o anúncio não basta: veja o que recebe e quanto paga.',
        'L5-T03',
      ),
    ],
  },
] as const;

const liteGlossary = [
  [
    'Moeda digital',
    'Moeda que você recebe e usa pelo celular, sem notas de papel. Existem tipos diferentes, com regras diferentes.',
  ],
  [
    'Dólar digital',
    'Moeda digital que procura valer perto de 1 dólar. O preço dela em reais pode mudar.',
  ],
  [
    'Euro digital',
    'Moeda digital que procura valer perto de 1 euro. O preço dela em reais pode mudar.',
  ],
  [
    'Criptomoeda',
    'Moeda da rede que registra as moedas digitais do PigFi. O preço dela sobe e desce bastante.',
  ],
  [
    'Lastro',
    'Dinheiro ou bens guardados para apoiar o valor de uma moeda digital.',
  ],
  [
    'Carteira',
    'Parte do app onde você acompanha e movimenta suas moedas. Não é uma conta de banco.',
  ],
  [
    'Porquinho',
    'Onde você guarda dinheiro no PigFi, com uma moeda e regras próprias. Não é um cofre com valor garantido.',
  ],
  ['Juros', 'Valor pago pelo uso de dinheiro emprestado.'],
  [
    'Taxa ao ano',
    'Estimativa de quanto o porquinho pode ganhar em um ano. Muda e não é garantida.',
  ],
  ['Câmbio', 'Preço de uma moeda em outra, como quantos reais compram 1 euro.'],
  [
    'Cotação',
    'Preço informado para uma troca num certo momento, com prazo para aceitar.',
  ],
  [
    'Liquidez',
    'Facilidade de tirar ou trocar o que você tem para usar o dinheiro, considerando tempo, preço e cobranças.',
  ],
  ['Volatilidade', 'As subidas e descidas de preço ao longo do tempo.'],
  ['Diversificar', 'Distribuir o que você guarda entre opções diferentes.'],
  ['XP', 'Pontos que mostram o seu progresso no app. Não são dinheiro.'],
  [
    'Nível de Usuário',
    'Nível que sobe com o XP. Mostra o seu aprendizado, não o seu dinheiro.',
  ],
];

const proGlossary = [
  ['USDC', 'Stablecoin de dólar emitida pela Circle.'],
  ['EURC', 'Stablecoin de euro emitida pela Circle.'],
  ['XLM', 'Moeda nativa da rede Stellar.'],
  [
    'Stablecoin',
    'Moeda digital que busca manter o valor de uma referência, como o dólar ou o euro.',
  ],
  [
    'Blockchain',
    'Registro de movimentações conferido por uma rede de computadores.',
  ],
  ['Stellar', 'A rede onde as moedas do PigFi são registradas.'],
  [
    'Contrato inteligente',
    'Programa que executa operações conforme regras definidas.',
  ],
  ['DeFi', 'Serviços financeiros feitos com contratos inteligentes.'],
  ['Vault', 'Nome técnico do porquinho.'],
  ['APY', 'Taxa anual que considera o ganho reinvestido. Não é garantida.'],
];

export const standaloneContent: Content[] = [
  {
    key: 'WELCOME',
    order: 1,
    title: 'Introdução ao PigFi',
    type: LearningContentType.INTRODUCTION,
    content: {
      text: 'Você já usa dinheiro para pagar contas, fazer compras e guardar para um plano. Aqui você vai conhecer outras formas de fazer isso pelo celular. Não precisa saber nada de finanças para começar. Vamos por partes?',
    },
  },
  {
    key: 'GLOSSARY',
    order: 2,
    title: 'Dicionário',
    type: LearningContentType.GLOSSARY,
    content: {
      lite: liteGlossary.map(([term, explanation]) => ({ term, explanation })),
      proAdditional: proGlossary.map(([term, explanation]) => ({
        term,
        explanation,
      })),
      developerNote:
        'Consulta opcional. Não apresentar tudo antes da primeira lição nem exigir memorização.',
    },
  },
];

export const proVocabulary = {
  'dólar digital': 'USDC',
  'euro digital': 'EURC',
  criptomoeda: 'XLM',
  porquinho: 'vault',
  'porquinho em dólar': 'vault USDC',
  'porquinho em euro': 'vault EURC',
  'porquinho em criptomoeda': 'vault XLM',
  'a rede': 'a rede Stellar',
  'Trocar moedas': 'Swap',
  'Tirar do porquinho': 'Resgate do vault',
  'depositar e sacar pelo Pix': 'on-ramp e off-ramp via Pix',
} as const;
