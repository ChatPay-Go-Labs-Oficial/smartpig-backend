import { LearningContentType } from '@prisma/client';

// Increment whenever approved learner-facing copy or answer choices change.
// Stable editorial IDs keep prior XP; the version prevents stale screens from
// submitting an answer against text the user did not see.
export const LEARNING_CATALOG_VERSION = 3;

type Option = { key: string; text: string };
type Question = {
  key: string;
  order: number;
  prompt: string;
  options: Option[];
  correct: string;
  success: string;
  retry: string;
};
type Content = {
  key: string;
  type: LearningContentType;
  title?: string;
  content: { blocks: string[]; response?: string; developerNote?: string };
  order: number;
  required?: boolean;
};

const options = (...texts: string[]): Option[] =>
  texts.map((text, index) => ({ key: String.fromCharCode(65 + index), text }));
const question = (
  key: string,
  order: number,
  prompt: string,
  choices: string[],
  correct: string,
  success: string,
  retry: string,
): Question => ({
  key,
  order,
  prompt,
  options: options(...choices),
  correct,
  success,
  retry,
});
const screen = (
  key: string,
  order: number,
  title: string,
  ...blocks: string[]
): Content => ({
  key,
  order,
  title,
  type: LearningContentType.EXPLANATION,
  content: { blocks },
  required: true,
});
const screenWithNote = (
  key: string,
  order: number,
  title: string,
  blocks: string[],
  developerNote: string,
): Content => ({
  key,
  order,
  title,
  type: LearningContentType.EXPLANATION,
  content: { blocks, developerNote },
  required: true,
});
const reflection = (
  key: string,
  order: number,
  title: string,
  prompt: string,
  response: string,
  developerNote: string,
): Content => ({
  key,
  order,
  title,
  type: LearningContentType.REFLECTION,
  content: { blocks: [prompt], response, developerNote },
});

export const learningCatalog = [
  {
    key: 'M1',
    order: 1,
    title: 'Do dinheiro que você conhece às moedas digitais',
    description:
      'Distinguir moeda digital, stablecoin, lastro, DeFi e liquidez.',
    content: [
      screen(
        'M1-SCREEN-A',
        1,
        'Dinheiro sem nota de papel',
        'Quando você recebe um Pix de R$20, não recebe uma nota na mão. Mesmo assim, vê o valor no aplicativo e pode usá-lo. Você já está acostumado a lidar com dinheiro digital.',
        'Também existem outras moedas que só circulam de forma digital, sem notas ou moedas de metal. Algumas usam um sistema diferente do banco. Vamos conhecer como elas funcionam.',
      ),
      screen(
        'M1-SCREEN-B',
        2,
        'Quem anota o que aconteceu?',
        'Geralmente o banco é que faz isso. Anota que fulano enviou x para ciclano, então ciclano agora é detentor de x. Pense num caderno que o banco registra quem enviou e quem recebeu.Nesse caso temos só uma "pessoa" fazendo as anotações, o banco, e temos que confiar unicamente nessa "pessoa". Agora imagine várias cópias desse caderno, em computadores diferentes, sendo verificadas por pessoas diferentes. Os computadores seguem regras para conferir e acrescentar os registros.São várias "pessoas" conferindo o mesmo registro em diferentes lugares do mundo. E essas "pessoas" não se conhecem. Ou seja, é muito difícil fraudar um registro pois as outras "pessoas" mostrariam o erro',
        'Essa comparação ajuda a entender uma tecnologia chamada blockchain. Ela é usada para registrar movimentações de muitas moedas digitais e de modo descentralizado (em vez de confiar em uma "pessoa", há várias para atestar as operações). Você não precisa decorar o nome: a ideia principal é que os registros são conferidos por uma rede de computadores descentralizada.',
      ),
      screen(
        'M1-SCREEN-C',
        3,
        'Dólar e euro no celular',
        'O real é a moeda que usamos no Brasil. Você talvez já tenha usado dólar numa viagem ou compra de fora do país. O euro é usado em vários países da Europa.',
        'Existem moedas digitais feitas para tentar acompanhar o valor dessas moedas fisicas (ou fiduciárias, emitidas por uma Casa da Moeda e controladas por um Banco Central). O USDC procura valer 1 dólar por unidade. O EURC procura valer 1 euro por unidade. Elas são chamadas de stablecoins: moedas digitais que buscam manter o valor próximo de uma referência, quase como a representação digital dessas moedas na blockchain.',
        'A ideia é manter o valor perto de 1 dólar ou 1 euro. Na hora da troca, o preço pode ser diferente. Por isso, o aplicativo mostra quanto você vai receber antes de confirmar. E, se o dólar ou o euro mudar de preço em reais, o valor que você vê em reais também muda.',
      ),
      screen(
        'M1-SCREEN-D',
        4,
        'O que existe por trás desse valor?',
        'Imagine um guarda-volumes: o comprovante representa algo que ficou guardado. A comparação ajuda a pensar em lastro: dinheiro ou bens mantidos como apoio ao valor de uma moeda digital.',
        'No USDC e no EURC, a empresa que cria essas moedas informa manter reservas para dar esse apoio. Para conhecer uma moeda, vale perguntar: o que está guardado, quem cuida disso e quais são as regras para trocar de volta?',
        'A Circle, empresa que emite o USDC, mantém reservas em dinheiro e aplicações para dar apoio às moedas que coloca em circulação. A ideia é ter o equivalente a 1 dólar em reservas para cada USDC.',
        'Nem toda moeda com lastro busca um preço estável. Se uma moeda digital representa ouro, por exemplo, o preço do ouro pode subir ou cair. Ter algo por trás e manter o mesmo preço são ideias diferentes.',
      ),
      screen(
        'M1-SCREEN-E',
        5,
        'E o tal de DeFi?',
        'Pense numa máquina de vender bebidas: você escolhe, paga e ela segue as regras programadas para entregar o pedido. Existem programas de computador que também seguem regras para movimentar moedas digitais, por exemplo, em empréstimos.',
        'Esses programas são chamados de contratos inteligentes. Serviços financeiros que usam esses programas numa rede como a que acabamos de conhecer fazem parte do DeFi, nome curto para finanças descentralizadas. Esses programas executam as regras definidas para aquele serviço. Alguns permitem atualizações, seguindo regras sobre quem pode fazer mudanças.',
        'Eles permitem fazer operações sem depender de um banco para executar cada passo. Ainda existem pessoas e empresas que criam e cuidam dos serviços. Como qualquer programa, podem ter falhas; usar essa tecnologia não garante rendimento.',
      ),
      screen(
        'M1-SCREEN-F',
        6,
        'Quando posso usar o dinheiro?',
        'Ter R$100 na mão é diferente de ter um objeto que vale R$100 e precisa ser vendido. O valor pode ser parecido, mas o tempo e o trabalho para usar esse dinheiro são diferentes.',
        'Nos investimentos, também precisamos perguntar: consigo retirar ou trocar quando precisar? Quanto tempo leva? Quanto vou receber depois das cobranças? Essa facilidade de transformar o que você tem em dinheiro para usar se chama liquidez.',
      ),
      reflection(
        'M1-A01',
        7,
        'Meu plano',
        'Quero guardar para ___. Acho que vou precisar em ___. Vou pagar em reais, dólares, euros ou ainda não sei.',
        'Tudo bem ainda não saber. Você pode mudar essas respostas enquanto aprende.',
        'Permitir responder por opções ou texto. “Ainda não sei” vale em qualquer campo. Atividade opcional, sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'M1-Q01',
        1,
        'Ana mandou R$20 por Pix para a irmã. O que a irmã recebeu?',
        [
          'Uma nova moeda chamada Pix.',
          'R$20 transferidos pelo aplicativo.',
          '20 dólares.',
        ],
        'B',
        'Pix é uma forma de enviar reais. Ele não troca reais por dólares.',
        'Pense num envelope: ele ajuda a enviar uma coisa, mas não muda o que está dentro. Pix é o meio de enviar; a moeda continua sendo o real.',
      ),
      question(
        'M1-Q02',
        2,
        'Qual moeda digital procura acompanhar o dólar, e qual procura acompanhar o euro?',
        [
          'USDC acompanha o dólar; EURC acompanha o euro.',
          'USDC acompanha o real; EURC acompanha o dólar.',
          'As duas mantêm sempre o mesmo valor em reais.',
        ],
        'A',
        'USDC: dólar digital. EURC: euro digital. Essa é uma forma curta de lembrar o que cada uma procura acompanhar.',
        'Lembre das duas etiquetas: USDC → dólar; EURC → euro. O preço delas em reais pode mudar.',
      ),
      question(
        'M1-Q03',
        3,
        'Uma moeda digital diz ter ouro guardado para dar apoio ao seu valor. Isso significa que seu preço em reais nunca muda?',
        [
          'Sim, porque existe ouro guardado.',
          'Sim, porque ela só existe no celular.',
          'Não. O preço do ouro também pode subir ou cair.',
        ],
        'C',
        'O ouro é o lastro desse exemplo. Ele dá apoio à moeda, mas seu próprio preço pode mudar.',
        'Imagine uma joia de ouro. Ela continua sendo de ouro mesmo quando o preço de venda muda. Ter lastro não é ter um preço fixo.',
      ),
      question(
        'M1-Q04',
        4,
        'Lembre da máquina que segue regras para entregar uma bebida. No DeFi, o que segue regras para realizar operações com moedas digitais?',
        [
          'Programas de computador que executam as regras combinadas.',
          'Um atendente do banco, que aprova cada operação manualmente.',
          'A própria moeda digital, sem precisar de um programa com regras.',
        ],
        'A',
        'Esses programas são os contratos inteligentes. Eles ajudam a executar operações.',
        'Na comparação, é a máquina que segue as instruções. No DeFi, são os programas.',
      ),
      question(
        'M1-Q05',
        5,
        'João precisa de R$200 amanhã. Antes de investir esse valor hoje, o que ele deve conferir?',
        [
          'Se muita gente usa o aplicativo.',
          'Se consegue retirar a tempo e quanto receberá depois das cobranças.',
          'Se o nome da moeda é conhecido.',
        ],
        'B',
        'Isso é olhar a liquidez: quando e em quais condições o valor volta a ficar disponível para usar.',
        'Pense na conta de amanhã. Saber que algo vale R$200 não basta; João precisa conseguir usar esse valor na hora certa.',
      ),
      question(
        'M1-Q06',
        6,
        'Você está guardando para um curso que custa R$300. Seu saldo está em USDC. O que ajuda a saber se já dá para pagar?',
        [
          'Olhar só quantos USDC tem.',
          'Olhar só os pontos das lições.',
          'Conferir quanto receberia em reais depois da troca e das cobranças.',
        ],
        'C',
        'Como o curso será pago em reais, é esse valor final que precisa ser comparado com os R$300.',
        'Imagine ter dinheiro de uma viagem no bolso. Antes de pagar uma conta no Brasil, você precisa saber quanto ele vale em reais.',
      ),
    ],
  },
  {
    key: 'M2',
    order: 2,
    title: 'O caminho do seu dinheiro no PigFi',
    description:
      'Separar carteira, entrada/saída, conversão e vault; interpretar rendimento.',
    content: [
      screen(
        'M2-SCREEN-A',
        1,
        'Trocar, receber e investir',
        'Imagine uma viagem: primeiro você troca reais pela moeda que vai usar. Depois recebe essa moeda. Só então decide o que fazer com ela. No PigFi, também há passos separados.',
        'Uma empresa parceira faz a entrada dos reais e a troca pela moeda digital aceita naquele caminho. Essa moeda chega à sua carteira digital: a parte do aplicativo pela qual você acompanha e movimenta suas moedas.',
        'A carteira lembra a carteira do bolso pela função de receber e usar valores. Mas as moedas digitais são registradas na rede de computadores que conhecemos, não ficam guardadas fisicamente no celular.',
      ),
      screen(
        'M2-SCREEN-B',
        2,
        'Onde entra o investimento?',
        'Receber na carteira é diferente de investir. Você escolhe uma opção, confere e confirma o depósito.',
        'No PigFi, essas opções são os porquinhos de investimento, chamados tecnicamente de vaults. Você pode pensar em espaços separados, cada um com uma moeda e suas regras. Não são cofres com valor garantido: o resultado e as condições de retirada dependem de cada investimento.',
      ),
      screenWithNote(
        'M2-SCREEN-C',
        3,
        'De onde vem o dinheiro a mais?',
        [
          'Em um investimento baseado em empréstimos, moedas ficam disponíveis para quem toma emprestado seguindo as regras do serviço. Quem pega emprestado paga juros: um valor a mais pelo uso dessas moedas.',
          'Esse pagamento ajuda a gerar o rendimento, o dinheiro a mais que o investimento pode produzir. O resultado pode variar. Só ter dólar digital na carteira não significa receber juros.',
        ],
        'Este exemplo descreve empréstimos, como os usados em Blend. Não atribuir a mesma origem de rendimento a um vault sem conferir sua configuração. Nomes de fornecedores ficam em “Saiba mais”, sem serem exigidos no quiz.',
      ),
      screen(
        'M2-SCREEN-D',
        4,
        'Uma previsão para o ano',
        'Se aparecer “rendimento estimado de 5% ao ano”, pense assim: em 100 moedas, seriam cerca de 5 moedas a mais em um ano se aquela estimativa se confirmasse. Não são 5 moedas por mês, nem uma promessa.',
        'A sigla APY, quando aparecer, é uma forma de mostrar essa estimativa anual considerando que o que rende continua investido e também pode render. O valor que chega para você ainda depende das condições e cobranças. Para saber quanto vale em reais, também é preciso olhar o preço da moeda.',
      ),
      screen(
        'M2-SCREEN-E',
        5,
        'Confirmar é autorizar',
        'Antes de fazer um Pix, você confere quem vai receber e quanto vai enviar. Aqui, faça parecido: confira a moeda, a quantidade, para onde ela vai e o que será cobrado. Ao confirmar uma operação, você autoriza o que está escrito na tela.',
      ),
      screen(
        'M2-SCREEN-F',
        6,
        'Aprender e investir têm marcadores diferentes',
        'O nível do porquinho acompanha o valor investido. Seu nível de usuário acompanha seu aprendizado e as atividades no app. As atividades dão pontos chamados XP. Esses pontos não são dinheiro.',
        'A Chama mostra a sequência de dias em que você faz uma atividade de aprendizado. Você pode manter esse hábito sem fazer depósitos.',
      ),
      reflection(
        'M2-A01',
        7,
        'Conte para alguém de casa',
        'Imagine que alguém pergunta: “Fiz o Pix. Já está investido?” Como você explicaria os passos?',
        'Um jeito de explicar: primeiro os reais são trocados por moedas digitais. Elas chegam à carteira. Depois eu escolho e confirmo o investimento.',
        'Aceitar resposta falada para si mesmo, texto opcional ou apenas abrir “Ver um exemplo”. Não avaliar vocabulário técnico. Atividade opcional, sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'M2-Q01',
        1,
        'O USDC chegou à sua carteira. Quando ele passa a fazer parte do porquinho de investimento escolhido?',
        [
          'Assim que aparece na carteira.',
          'Quando você termina uma lição.',
          'Depois que você confirma o depósito no porquinho de investimento e ele é concluído.',
        ],
        'C',
        'Receber na carteira e investir são dois passos. Você escolhe quando seguir para o segundo.',
        'Ter dinheiro na carteira não significa que ele já foi aplicado. No PigFi, você precisa escolher e confirmar o depósito.',
      ),
      question(
        'M2-Q02',
        2,
        'Para usar reais e investir em USDC, qual caminho combina com o que aprendemos?',
        [
          'Trocar reais por USDC → receber na carteira → escolher e confirmar o investimento.',
          'Fazer Pix → o app escolhe sozinho onde investir.',
          'Investir primeiro → escolher a moeda depois.',
        ],
        'A',
        'Assim você acompanha onde está o valor em cada passo e decide antes de investir.',
        'Pense em três passos separados: trocar, receber e investir. Não é a mesma coisa acontecendo automaticamente.',
      ),
      question(
        'M2-Q03',
        3,
        'Num investimento que usa empréstimos, de onde pode vir o dinheiro a mais?',
        [
          'Dos pontos ganhos nas perguntas.',
          'Dos juros pagos por quem pegou as moedas emprestadas.',
          'Do nome “dólar digital”, mesmo sem investir.',
        ],
        'B',
        'Juros são um valor pago pelo uso do dinheiro emprestado. Parte do resultado pode ir para quem participa do investimento.',
        'Quem pega emprestado pode pagar um valor a mais pelo uso. Esse pagamento ajuda a formar o rendimento; os pontos do app não viram juros.',
      ),
      question(
        'M2-Q04',
        4,
        'Um exemplo mostra rendimento estimado de 5% ao ano. Em 100 moedas, isso seria cerca de 5 moedas a mais em um ano se a estimativa se confirmasse. O que isso quer dizer?',
        [
          'Vou ganhar 5 moedas todo mês.',
          'Com certeza vou receber mais 5 reais.',
          'É uma estimativa para um ano; o resultado pode ser diferente.',
        ],
        'C',
        '“Ao ano” indica o período. “Estimado” indica que não é um resultado garantido.',
        'É parecido com estimar o tempo de uma viagem: ajuda a planejar, mas o resultado depende do que acontecer pelo caminho.',
      ),
      question(
        'M2-Q05',
        5,
        'Você queria investir USDC, mas a tela mostra EURC. O que fazer?',
        [
          'Voltar e conferir até a tela mostrar o que você escolheu.',
          'Confirmar para não perder os pontos.',
          'Confirmar porque o app deve saber o que você quer.',
        ],
        'A',
        'Confira a moeda, a quantidade, o destino e as cobranças. Confirmar deve representar a sua escolha.',
        'É como conferir os dados de um Pix antes de enviar. Se algo não está como você queria, volte e revise.',
      ),
      question(
        'M2-Q06',
        6,
        'Você terminou uma lição e ganhou XP, os pontos de aprendizado. Não fez nenhum depósito. O que aumentou?',
        [
          'O dinheiro investido.',
          'Seu progresso no app.',
          'O rendimento do investimento.',
        ],
        'B',
        'Os pontos mostram seu progresso. O saldo investido é acompanhado separadamente.',
        'Pense numa medalha por completar uma atividade: ela reconhece o que você fez, mas não coloca dinheiro na carteira.',
      ),
    ],
  },
  {
    key: 'M3',
    order: 3,
    title: 'Euro digital: como guardar e como usar depois',
    description:
      'Entender referência cambial, diversificação e duas camadas de liquidez.',
    content: [
      screen(
        'M3-SCREEN-A',
        1,
        'Pense na moeda do seu plano',
        'Se você planeja uma viagem para um lugar que usa euro, vai ver preços nessa moeda. Se quer pagar um curso no Brasil, provavelmente vai pagar em reais. Saber em qual moeda será a despesa ajuda a acompanhar quanto falta.',
        'O EURC é a moeda digital que procura acompanhar o euro. Ele pode manter um valor próximo de 1 euro e, mesmo assim, mudar de preço em reais.',
      ),
      screen(
        'M3-SCREEN-B',
        2,
        'O preço da troca',
        'Imagine que hoje você precisa de R$6 para comprar 1 euro. Em outro dia, pode precisar de mais ou menos reais. Esse preço de uma moeda em outra é o câmbio.',
        'Guardar parte em dólar e parte em euro é uma forma de diversificar: distribuir entre opções diferentes. Isso muda a combinação do que você tem, mas não garante que o total aumente.',
      ),
      screen(
        'M3-SCREEN-C',
        3,
        'Quanto posso retirar agora?',
        'Imagine uma caixa com dez moedas. Nove foram emprestadas e uma ficou. A caixa começou com dez, mas só uma está disponível naquele momento.',
        'Um investimento que empresta moedas também pode ter uma parte disponível e outra emprestada. Por isso, o total investido não é necessariamente o total que pode ser retirado agora. Essa é uma das coisas que precisamos olhar para entender a liquidez.',
      ),
      screen(
        'M3-SCREEN-D',
        4,
        'Retirar e trocar são dois passos',
        'Primeira pergunta: consigo tirar o EURC do porquinho de investimento e receber na carteira? Segunda pergunta: consigo trocar esse EURC para chegar aos reais que quero usar? Uma resposta “sim” não garante a outra.',
        'Pense em voltar de viagem com euros no bolso: você já tem as notas, mas ainda precisa encontrar uma opção de troca e conferir o preço. Com EURC, o app também precisa ter um caminho de troca disponível.',
      ),
      screenWithNote(
        'M3-SCREEN-E',
        5,
        'Lastro não define a hora da retirada',
        [
          'O lastro que conhecemos antes é o apoio à moeda. O investimento é o lugar onde você decidiu usar essa moeda. São coisas diferentes.',
          'Ter reservas por trás do EURC não significa que todo valor colocado num investimento esteja pronto para retirada a qualquer momento. Antes de escolher, confira como retirar, como trocar e quando receber.',
        ],
        'No desenho previsto, a volta a reais pode passar por EURC → USDC → reais. Apresentar somente o caminho confirmado no produto. Não prometer troca direta, retirada imediata ou prazo fixo.',
      ),
      reflection(
        'M3-A01',
        6,
        'Onde quero entender melhor?',
        'Para voltar a usar em reais, quero entender melhor: tirar do investimento; trocar a moeda; receber na conta.',
        'Escolha um passo para rever a explicação. Você pode consultar os três.',
        'Cada opção abre a explicação correspondente. Não apresentar caminhos ainda indisponíveis como serviços prontos. Atividade opcional, sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'M3-Q01',
        1,
        'Imagine que você tem 10 EURC, valendo perto de 10 euros. Antes, cada euro valia R$5: cerca de R$50. Agora vale R$6: cerca de R$60. Sem outras mudanças, o que aconteceu?',
        [
          'Os 10 EURC continuam valendo R$50.',
          'Você continua com 10 EURC, mas eles valem mais em reais.',
          'Você ganhou EURC porque o euro ficou mais caro.',
        ],
        'B',
        'A quantidade não mudou. Mudou o preço do euro em reais: 10 × R$6 = R$60. Se o euro cair, o valor em reais também pode diminuir.',
        'É como voltar de viagem com as mesmas notas de euro. Na hora de trocar, você pode receber uma quantidade diferente de reais.',
      ),
      question(
        'M3-Q02',
        2,
        'Bia divide o que guarda entre dólar digital e euro digital. O que essa escolha faz?',
        [
          'Ela passa a ter duas moedas, que podem mudar de preço de formas diferentes.',
          'Garante que o total nunca diminua em reais.',
          'Garante que uma sempre suba quando a outra cair.',
        ],
        'A',
        'Isso é diversificar: distribuir entre opções diferentes. Ajuda a mudar a composição do que você tem, mas não garante ganho.',
        'Pense em duas plantas: elas podem reagir de formas diferentes ao tempo, mas uma não melhora obrigatoriamente quando a outra piora. Com moedas, também não há compensação garantida.',
      ),
      question(
        'M3-Q03',
        3,
        'Imagine uma caixa com 10 moedas. Nove foram emprestadas e ainda não voltaram. Só uma ficou na caixa. Dá para entregar cinco moedas agora usando apenas o que ficou?',
        [
          'Sim, porque a caixa tinha dez.',
          'Sim, porque são moedas que acompanham o euro.',
          'Não. Há apenas uma moeda disponível agora.',
        ],
        'C',
        'A comparação mostra por que o total investido pode ser diferente do que está disponível para retirada naquele momento.',
        'Conte só o que ficou: uma moeda. As nove emprestadas fazem parte do total, mas não estão disponíveis na caixa agora. O prazo para voltarem precisa ser verificado.',
      ),
      question(
        'M3-Q04',
        4,
        'Você retirou EURC do porquinho de investimento e ele chegou à carteira digital. O dinheiro já está em reais na sua conta bancária?',
        [
          'Sim, retirar do investimento já faz tudo.',
          'Não. Ainda é preciso fazer as trocas necessárias e pedir o envio para a conta.',
          'Sim, porque a carteira digital e a conta bancária recebem o mesmo saldo automaticamente.',
        ],
        'B',
        'O EURC chegou à carteira. Trocar e receber reais no banco são os próximos passos, conforme as opções disponíveis.',
        'Pense em voltar de viagem com euros na carteira: você tem o valor com você, mas ele ainda não virou reais na conta.',
      ),
      question(
        'M3-Q05',
        5,
        'O EURC tem reservas que dão apoio ao seu valor. Isso garante que todo EURC colocado num investimento pode ser retirado na mesma hora?',
        [
          'Sim. As reservas e o investimento são a mesma coisa.',
          'Sim, porque acompanhar o euro significa poder retirar a qualquer hora.',
          'Não. Também é preciso conferir quanto está disponível no investimento.',
        ],
        'C',
        'Uma coisa é o que dá apoio à moeda. Outra é onde ela foi investida e quando pode ser retirada.',
        'Pense em uma nota verdadeira que foi emprestada: saber que ela é verdadeira não faz com que volte ao seu bolso imediatamente. O exemplo ajuda a separar o valor da moeda do prazo de retirada.',
      ),
      question(
        'M3-Q06',
        6,
        'Você quer usar o dinheiro amanhã para pagar uma conta em reais. Antes de colocá-lo no porquinho de investimento em EURC hoje, qual pergunta ajuda mais?',
        [
          'Consigo retirar, trocar e receber na conta a tempo? Quanto vou receber?',
          'Qual tem a maior previsão de rendimento?',
          'Se acompanha o euro, posso considerar disponível amanhã?',
        ],
        'A',
        'O prazo precisa combinar com a sua conta. Você pode conferir e decidir se quer seguir ou esperar.',
        'Uma boa previsão de rendimento não paga a conta de amanhã se o valor não chegar a tempo. Olhe o caminho inteiro de volta.',
      ),
    ],
  },
  {
    key: 'M4',
    order: 4,
    title: 'XLM: a quantidade pode ser igual e o preço mudar',
    description:
      'Distinguir ativo nativo, volatilidade, rendimento em unidades e resultado em reais.',
    content: [
      screen(
        'M4-SCREEN-A',
        1,
        'Outra moeda, outra função',
        'Você conheceu moedas digitais que procuram acompanhar dólar e euro. O XLM é diferente: não foi feito para manter o preço de um dólar ou de um euro.',
        'Ele é uma moeda usada na Stellar, uma rede de computadores que registra movimentações de moedas digitais. Pense na rede como uma estrada por onde essas movimentações passam. XLM é usado, por exemplo, para pagar pequenas taxas dessa rede. Essa é só uma comparação para entender sua função.',
      ),
      screen(
        'M4-SCREEN-B',
        2,
        'A etiqueta de preço muda',
        'Pense no preço de um produto na feira: hoje pode custar mais, amanhã menos. O preço de XLM também muda conforme as pessoas compram e vendem.',
        'Essas subidas e descidas de preço são chamadas de volatilidade. Elas podem mudar bastante o valor que você receberia em reais.',
      ),
      screen(
        'M4-SCREEN-C',
        3,
        'Duas coisas para olhar',
        'Imagine dez produtos numa prateleira, cada um com sua etiqueta de preço. Você precisa saber quantos há e quanto cada um vale para calcular o total.',
        'Com XLM é parecido: acompanhe a quantidade de moedas e o preço de cada uma. Mesmo que um investimento acrescente moedas, uma queda de preço pode fazer o total valer menos em reais.',
      ),
      screen(
        'M4-SCREEN-D',
        4,
        'A escolha continua sua',
        'Antes de escolher, pense: se esse valor diminuir, como isso afeta meu plano? Quando vou precisar usar o dinheiro? Como faço para retirar?',
        'Aprender sobre XLM não significa ter que investir nele. Você pode conhecer a opção, comparar e decidir depois. Ter acesso a mais opções não torna uma delas melhor para todo mundo.',
      ),
      reflection(
        'M4-A01',
        5,
        'Meu plano com valores diferentes',
        'Você separou R$100 para um plano. Imagine resultados de R$80, R$100 ou R$120. O que cada um mudaria?',
        'Pensar nisso ajuda a decidir quanto uma mudança de valor afetaria você. Nenhuma resposta obriga a escolher um investimento.',
        'Para cada valor, oferecer “mudaria muito”, “mudaria pouco” e “quero pensar mais”. Não atribuir perfil de risco nem selecionar produto. Atividade opcional, sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'M4-Q01',
        1,
        'Depois de conhecer USDC e EURC, você encontra XLM. Qual é a diferença principal?',
        [
          'XLM também procura valer sempre um dólar.',
          'XLM é usado na rede Stellar e seu preço não é preso ao dólar ou ao euro.',
          'XLM vale o mesmo número de reais todos os dias.',
        ],
        'B',
        'XLM tem uma função na rede e seu preço pode subir ou cair conforme as negociações.',
        'Usar a mesma rede é como viajar pela mesma estrada: não significa que tudo o que passa por ela tem o mesmo preço.',
      ),
      question(
        'M4-Q02',
        2,
        'Você tem 10 XLM. Cada um valia R$1, somando R$10. Agora cada um vale R$2. Você não comprou nem vendeu nada. O que tem?',
        [
          '20 XLM, porque o preço dobrou.',
          '10 XLM, ainda valendo R$10.',
          '10 XLM, agora valendo R$20.',
        ],
        'C',
        'A quantidade continuou dez. O valor mudou: 10 × R$2 = R$20. O preço pode subir ou cair sem mudar a quantidade que você tem.',
        'Imagine dez produtos numa prateleira. Mudar a etiqueta de preço não muda quantos produtos estão lá.',
      ),
      question(
        'M4-Q03',
        3,
        'Você tinha 10 XLM a R$2 cada: R$20. Num exemplo inventado, o investimento aumentou sua quantidade para 11 XLM. Mas o preço caiu para R$1 cada. Quanto isso vale agora?',
        [
          'R$11. Tenho mais XLM, mas o total vale menos em reais.',
          'R$22, porque a quantidade aumentou.',
          'R$20, porque o valor inicial não pode mudar.',
        ],
        'A',
        '11 × R$1 = R$11. Ganhar moedas e ganhar valor em reais não são a mesma coisa.',
        'Olhe duas coisas: quantas moedas você tem agora e quanto cada uma vale agora. O exemplo serve para aprender, não para prever quanto XLM vai render.',
      ),
      question(
        'M4-Q04',
        4,
        'O preço de XLM subiu nos últimos três dias. O que sabemos sobre amanhã?',
        [
          'Vai subir de novo.',
          'Ainda pode subir ou cair.',
          'Vai ficar igual porque já subiu bastante.',
        ],
        'B',
        'Os dias anteriores mostram o que aconteceu, mas não decidem o preço de amanhã.',
        'É como olhar os preços de uma feira: saber quanto custava ontem não garante o preço da próxima compra.',
      ),
      question(
        'M4-Q05',
        5,
        'Você quer pagar um curso em reais daqui a alguns meses. Antes de escolher XLM, qual pergunta ajuda?',
        [
          'Quantas pessoas escolheram XLM?',
          'Como o preço subiu recentemente, posso contar que vai continuar subindo?',
          'Se o preço cair, ainda consigo pagar o curso quando precisar?',
        ],
        'C',
        'Essa pergunta liga a escolha ao que importa para você: conseguir realizar o plano.',
        'Imagine chegar à data do curso com a mesma quantidade de moedas, mas menos reais. Vale pensar nisso antes de decidir.',
      ),
      question(
        'M4-Q06',
        6,
        'Você terminou as lições e o acesso a XLM foi liberado. O que pode fazer?',
        [
          'Escolher XLM, continuar onde está ou decidir depois.',
          'Depositar para não perder o que aprendeu.',
          'Trocar todo o saldo porque o novo é sempre melhor.',
        ],
        'A',
        'Aprender abre opções. Você continua decidindo se e quando quer usar cada uma.',
        'É como conhecer um novo caminho para o trabalho: saber que ele existe não obriga você a passar por ele.',
      ),
    ],
  },
  {
    key: 'M5',
    order: 5,
    title: 'Como o dinheiro volta para você',
    description:
      'Planejar resgate, conversão e recebimento; comparar condições e decidir.',
    content: [
      screen(
        'M5-SCREEN-A',
        1,
        'O destino é a sua conta',
        'Pense numa viagem com paradas. Para receber reais no banco, você pode precisar primeiro retirar as moedas do porquinho de investimento, depois fazer uma troca e, por último, pedir o envio para a conta.',
        'Cada passo tem suas condições. O app deve mostrar onde o valor está e o que falta fazer. Retirar do investimento não significa que os reais já chegaram ao banco.',
      ),
      screen(
        'M5-SCREEN-B',
        2,
        'Quanto vou receber na troca?',
        'Antes de trocar uma moeda por outra, o app mostra uma cotação: quanto você entrega e quanto pode receber naquele momento. É parecido com pedir um orçamento antes de contratar um serviço.',
        'Confira as cobranças e até quando aquele preço vale. Se o prazo acabar, peça um preço atualizado e decida de novo. Você não precisa aceitar só porque começou a olhar.',
      ),
      screen(
        'M5-SCREEN-C',
        3,
        'Compare o valor final',
        'Numa compra, um preço menor pode deixar de ser o mais barato quando você soma o frete. Numa troca de moedas, também vale olhar todas as cobranças.',
        'Para comparar investimentos, pergunte: qual moeda vou ter? De onde pode vir o rendimento? O preço pode mudar? Como retiro? Quanto pago? Em quanto tempo consigo usar o dinheiro?',
      ),
      screen(
        'M5-SCREEN-D',
        4,
        'Estudar não é condição para retirar',
        'Se você parar de fazer as lições, poderá continuar consultando o saldo e pedindo a retirada. A Chama e os pontos não devem impedir isso. A retirada ainda depende das condições do investimento.',
        'Antes do primeiro depósito em cada opção, haverá uma explicação sobre o que pode acontecer com seu dinheiro. Você poderá ler, tirar dúvidas e decidir se quer continuar. Confirmar que leu não dá pontos.',
      ),
      reflection(
        'M5-A01',
        5,
        'Minha escolha em palavras simples',
        'Quero guardar para ___. Estou conhecendo a moeda ___. Seu preço pode mudar porque ___. Para usar depois, preciso ___. Minha dúvida é ___.',
        'Você pode continuar aprendendo, consultar as opções ou decidir depois.',
        'Oferecer exemplos ao lado dos campos e permitir pular. Não destacar depositar como o final certo da atividade. Atividade opcional, sem resposta certa e sem XP.',
      ),
    ],
    questions: [
      question(
        'M5-Q01',
        1,
        'Neste exemplo, o app informa que precisa trocar XLM por USDC antes de enviar reais ao banco. Qual é a ordem?',
        [
          'Receber reais no banco → retirar XLM do investimento.',
          'Retirar XLM do porquinho de investimento para a carteira → confirmar a troca por USDC → pedir o envio em reais.',
          'Retirar XLM para a carteira → receber reais no banco sem confirmar a troca.',
        ],
        'B',
        'São três passos separados. O app deve mostrar o que foi concluído e o que ainda falta.',
        'Pense numa viagem com uma conexão: terminar uma parte não significa já ter chegado ao destino. Aqui, o destino é receber reais na conta.',
      ),
      question(
        'M5-Q02',
        2,
        'O app mostrou quanto você receberia numa troca, mas o tempo para aceitar aquele preço acabou. O que fazer?',
        [
          'Pedir preço atualizado, conferir e decidir novamente.',
          'Contar que receberá o preço antigo.',
          'Aceitar qualquer valor novo sem olhar.',
        ],
        'A',
        'Você pode conferir o novo preço e escolher continuar ou deixar para depois.',
        'É como um orçamento com prazo: quando ele vence, é preciso confirmar as condições de novo. Atualizar não é aceitar.',
      ),
      question(
        'M5-Q03',
        3,
        'Duas opções de troca mostram: A paga R$100 e cobra R$4. B paga R$99 e cobra R$1. Qual deixa mais dinheiro para você?',
        [
          'A, porque mostra R$100 antes da cobrança.',
          'As duas deixam o mesmo.',
          'B: sobram R$98; na A, sobram R$96.',
        ],
        'C',
        'A conta é: R$100 − R$4 = R$96; R$99 − R$1 = R$98. Compare o que sobra no final.',
        'Pense no preço de uma compra com frete: o primeiro número não conta a história toda. É preciso incluir todas as cobranças. Também confira o prazo de cada opção.',
      ),
      question(
        'M5-Q04',
        4,
        'O app informa que não há moedas disponíveis suficientes para concluir sua retirada naquele momento. O que fazer?',
        [
          'Concluir que o saldo desapareceu.',
          'Consultar a explicação e as opções disponíveis e acompanhar o saldo.',
          'Colocar mais dinheiro para garantir a retirada.',
        ],
        'B',
        'Essa mensagem, sozinha, não diz que o saldo sumiu. É preciso entender o motivo e o que pode ser feito.',
        'Lembre da caixa com moedas emprestadas. Uma falta de disponibilidade agora precisa ser explicada. Ela não garante um prazo de retorno nem é motivo para depositar mais.',
      ),
      question(
        'M5-Q05',
        5,
        'Você parou as lições por alguns dias e quer retirar. Precisa recuperar a Chama primeiro?',
        [
          'Não. As lições e a Chama não são exigências para pedir a retirada.',
          'Sim, precisa estudar por sete dias.',
          'Sim, se tiver XLM.',
        ],
        'A',
        'Seu acesso ao saldo não depende de estudar todos os dias. A retirada continua seguindo os prazos e condições do investimento.',
        'Pontos e Chama acompanham seu aprendizado. Eles não devem trancar o dinheiro que você já investiu.',
      ),
      question(
        'M5-Q06',
        6,
        'Antes de escolher onde investir, qual conjunto de perguntas ajuda mais?',
        [
          'Qual promete mais? Qual dá mais pontos?',
          'Qual é mais conhecido? Qual meus amigos usam?',
          'Qual moeda vou ter? Como pode render? O preço pode mudar? Como retiro e quanto pago?',
        ],
        'C',
        'Essas perguntas ajudam a escolher de acordo com o seu plano. Você também pode perceber que quer aprender mais antes.',
        'É como comparar uma compra: olhar só o anúncio não basta. Vale entender o que você recebe, quanto paga e quais são as condições.',
      ),
    ],
  },
] as const;

const glossary: Record<string, string> = {
  'Moeda digital':
    'Uma moeda que você recebe e usa eletronicamente, sem precisar de notas de papel. Existem tipos diferentes, com regras diferentes.',
  Blockchain:
    'Um registro de movimentações conferido por uma rede de computadores. Pense nas cópias de um caderno que seguem regras para serem atualizadas.',
  Stablecoin:
    'Moeda digital que procura acompanhar um valor, como o dólar ou o euro. Isso não fixa seu preço em reais.',
  Lastro:
    'Dinheiro ou bens mantidos como apoio a uma moeda digital, conforme suas regras.',
  DeFi: 'Serviços financeiros que usam programas numa rede de computadores para executar operações com moedas digitais.',
  'Contrato inteligente':
    'Programa que executa operações conforme regras definidas. Não é uma promessa de lucro.',
  'Carteira digital / wallet':
    'Recurso pelo qual você acompanha e movimenta suas moedas digitais.',
  'Porquinho de investimento / vault':
    'Uma opção de investimento no PigFi, com uma moeda e regras próprias.',
  Rendimento:
    'O valor a mais que um investimento pode produzir. Ele não é garantido.',
  Juros: 'Um valor pago pelo uso de dinheiro emprestado.',
  Câmbio:
    'O preço de uma moeda em outra, como quantos reais são necessários para comprar um euro.',
  Cotação: 'O preço informado para uma troca em determinado momento.',
  Liquidez:
    'A facilidade de retirar ou trocar o que você tem para usar o valor, considerando tempo, preço e cobranças.',
  Volatilidade: 'As subidas e descidas de preço ao longo do tempo.',
  Resgate:
    'Retirada de um investimento. O valor pode voltar primeiro à carteira digital.',
  APY: 'Estimativa de rendimento para um ano que considera manter os rendimentos investidos. Não garante o resultado.',
  XP: 'Pontos que reconhecem seu progresso no app. Não são dinheiro.',
  Chama: 'Marcador da sequência de dias com atividades de aprendizado.',
};

export const standaloneContent: Content[] = [
  {
    key: 'WELCOME',
    order: 1,
    type: LearningContentType.INTRODUCTION,
    title: 'Boas-vindas',
    content: {
      blocks: [
        'Você já usa dinheiro para pagar contas, fazer compras e guardar para um plano. Aqui vamos conhecer outras formas de fazer isso pelo celular. Não precisa saber nada de investimentos para começar. Vamos por partes?',
      ],
      developerNote:
        'Mostrar uma explicação curta de cada vez. Os blocos abaixo são pequenas telas, não um texto único para rolar.\nAlternar explicação, exemplo e pergunta. Permitir voltar à explicação a qualquer momento.\nFalar com um adulto que está aprendendo algo novo. Evitar diminutivos, broncas e frases como “é óbvio” ou “é muito fácil”.\nNão exigir que a pessoa decore siglas. USDC, EURC e XLM devem aparecer sempre acompanhados de uma explicação curta até ficarem familiares.\nNas perguntas, mostrar uma alternativa por linha. As letras são referências do documento; podem ser embaralhadas no app mantendo o gabarito associado à resposta.\nMostrar “Isso!” com a explicação após acerto. Após erro, usar “Vamos ver um exemplo?” com o retorno indicado. A pessoa pode tentar novamente, sem perder pontos.\nNas contas, mostrar também o resultado explicado. O objetivo é entender a escolha, não testar matemática. Não usar cronômetro.\nNas simulações, mostrar: “Vamos usar valores inventados para aprender. Os preços reais podem ser diferentes.”\nAs analogias explicam uma ideia de cada vez. Carteira não é conta bancária; investimento não é cofre com valor garantido; registro compartilhado não garante lucro. Não estender as comparações a essas promessas.',
    },
  },
  {
    key: 'H-A01',
    order: 101,
    type: LearningContentType.PRACTICE,
    title: 'Um pedaço do caminho já foi feito',
    content: {
      blocks: [
        'Lia quer juntar R$100 para um curso. Já separou R$25. Imagine uma barra dividida em quatro partes iguais. Quantas partes ela já completou?',
        'A. Uma das quatro partes.',
        'B. Duas das quatro partes.',
        'C. As quatro partes.',
        'Gabarito: A.',
      ],
      response:
        'Se acertar: “Isso! R$25 são uma das quatro partes de R$100. Esse pedaço também é chamado de 25%.” Se errar: “Quatro partes de R$25 formam R$100. Lia já separou uma delas. Ainda faltam três.”',
      developerNote:
        'Mostrar barra com quatro partes rotuladas; a informação não pode depender só de cor. Depois, oferecer “Para o que você gostaria de guardar?” como reflexão opcional. Prática sem XP; os marcos de metas reais seguem regras separadas.',
    },
  },
  {
    key: 'H-A02',
    order: 102,
    type: LearningContentType.PRACTICE,
    title: 'A moeda do meu objetivo',
    content: {
      blocks: [
        'Seu curso custa R$100. Ontem, o dólar digital que você guardou valia cerca de R$100. Hoje, a mesma quantidade vale cerca de R$90. Sem contar cobranças, já dá para pagar o curso inteiro?',
        'A. Sim, porque a quantidade de moedas não mudou.',
        'B. Não. Para pagar o curso em reais, ainda faltam R$10.',
        'Gabarito: B.',
      ],
      response:
        'Se acertar: “Você olhou o valor na moeda que vai usar para pagar. Esse é o número que ajuda a acompanhar o plano.” Se errar: “O curso custa R$100, e hoje a troca daria R$90. Faltam R$10, mesmo que a quantidade de moedas digitais seja a mesma.”',
      developerNote:
        'Exemplo sem rendimento e sem custos, apenas para ensinar a diferença entre quantidade e preço. Sem XP. Não premiar uma mudança no câmbio como se fosse um novo depósito na meta.',
    },
  },
  {
    key: 'H-A03',
    order: 103,
    type: LearningContentType.PRACTICE,
    title: 'Hoje eu quero só aprender',
    content: {
      blocks: [
        'Você quer manter a Chama, que acompanha os dias de aprendizado, mas hoje não quer depositar dinheiro. O que pode fazer?',
        'A. Concluir uma atividade da trilha.',
        'B. Depositar para conseguir estudar.',
        'C. Confirmar a mensagem de riscos para ganhar pontos.',
        'Gabarito: A.',
        'Convite para voltar: “Quer continuar de onde parou? Uma atividade curta mantém sua Chama.”',
        'Depois de uma pausa: “Seu aprendizado continua salvo. Você pode retomar hoje.”',
      ],
      response:
        'Se acertar: “Você pode continuar aprendendo sem movimentar dinheiro.” Se errar: “A Chama acompanha as atividades de aprendizado. Ela não exige um depósito.”',
      developerNote:
        'Sem XP próprio; a conclusão registrada pode contar como atividade diária. Apenas abrir o app ou aceitar riscos não conta como aprendizado.',
    },
  },
  {
    key: 'GLOSSARY',
    order: 200,
    type: LearningContentType.GLOSSARY,
    title: 'Pequeno dicionário',
    content: {
      blocks: Object.entries(glossary).map(
        ([term, definition]) => `${term}: ${definition}`,
      ),
      developerNote:
        'Consulta opcional. Não apresentar tudo antes da primeira lição nem exigir memorização.',
    },
  },
];
