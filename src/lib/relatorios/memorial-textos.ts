/**
 * Textos técnicos do memorial descritivo, por tipo de serviço.
 *
 * O tipo é reconhecido pela descrição do item (sem acentos, minúsculas); vale a
 * primeira categoria cuja expressão casar, então a ordem importa (ex.: aluguel
 * de contêiner é canteiro antes de ser "aluguel de equipamento").
 *
 * As normas citadas são as de referência de cada serviço, sempre "no que couber"
 * e nas edições vigentes; o texto é sugestão e pode ser editado antes de gerar
 * o documento.
 */

export interface CategoriaMemorial {
  id: string;
  /** título do subitem do escopo quando agrupa mais de um item */
  nome: string;
  padrao: RegExp;
  texto: string;
  /** normas técnicas (ABNT/DNIT) citadas nas considerações gerais */
  normas: string[];
  /** Normas Regulamentadoras pertinentes */
  nrs: string[];
  /** leis e resoluções */
  legislacao: string[];
}

export const NR = {
  "NR-1": "NR-1 (Disposições Gerais e Gerenciamento de Riscos Ocupacionais)",
  "NR-6": "NR-6 (Equipamentos de Proteção Individual)",
  "NR-10": "NR-10 (Segurança em Instalações e Serviços em Eletricidade)",
  "NR-12": "NR-12 (Segurança no Trabalho em Máquinas e Equipamentos)",
  "NR-18": "NR-18 (Segurança e Saúde no Trabalho na Indústria da Construção)",
  "NR-24": "NR-24 (Condições Sanitárias e de Conforto nos Locais de Trabalho)",
  "NR-26": "NR-26 (Sinalização de Segurança)",
  "NR-35": "NR-35 (Trabalho em Altura)",
} as const;

const RESIDUOS = ["Resolução CONAMA nº 307/2002", "Lei nº 12.305/2010 (Política Nacional de Resíduos Sólidos)"];

export const CATEGORIAS: CategoriaMemorial[] = [
  {
    id: "administracao",
    nome: "Administração local e equipe técnica",
    padrao: /administra(cao|tiv)|engenheir|encarregad|mestre de obra|apontador|almoxarife|tecnico de seguranca|vigia|vigilan|topografo|equipe tecnica/,
    texto: "Compreende a estrutura de administração local necessária à condução técnica e administrativa dos serviços, com profissionais legalmente habilitados e em quantidade compatível com o porte, a complexidade e o cronograma da contratação. A medição deverá guardar proporcionalidade com a execução física dos serviços, vedado o pagamento desvinculado do avanço efetivo. O responsável técnico deverá registrar a Anotação de Responsabilidade Técnica (ART), nos termos da Lei nº 6.496/1977, ou o Registro de Responsabilidade Técnica (RRT), nos termos da Lei nº 12.378/2010, e manter o diário de obra atualizado.",
    normas: [], nrs: [], legislacao: ["Lei nº 6.496/1977", "Lei nº 5.194/1966"],
  },
  {
    id: "beneficios",
    nome: "Benefícios aos trabalhadores",
    padrao: /subsidio|alimentacao|cafe da manha|vale.?transporte|cesta basica|refeic/,
    texto: "Corresponde aos benefícios devidos aos trabalhadores alocados na execução dos serviços, na forma prevista na planilha orçamentária, na legislação trabalhista e nas convenções coletivas de trabalho aplicáveis, devendo a Contratada comprovar o efetivo fornecimento sempre que solicitado pela fiscalização.",
    normas: [], nrs: [], legislacao: [],
  },
  {
    id: "mobilizacao",
    nome: "Mobilização e desmobilização",
    padrao: /mobilizacao|desmobilizacao/,
    texto: "Compreende o transporte de equipes, máquinas e equipamentos até o local dos serviços e a sua retirada ao término, bem como as providências necessárias ao início e ao encerramento das atividades. A medição observará a mobilização efetivamente realizada, na faixa de distância e na quantidade previstas na planilha, não se confundindo com os serviços de execução propriamente ditos.",
    normas: [], nrs: ["NR-12"], legislacao: [],
  },
  {
    id: "canteiro",
    nome: "Canteiro de obras e instalações provisórias",
    padrao: /container|conteiner|banheiro quimico|barracao|canteiro|instalac(ao|oes) provisori|tapume|placa de obra|ligacao provisoria|almoxarifado|sanitario provisorio|escritorio de obra/,
    texto: "Compreende a instalação, a manutenção e a desmobilização das instalações provisórias, dimensionadas para o efetivo previsto e mantidas em condições adequadas de higiene, conforto e segurança, em atendimento à NR-18 e à NR-24. Os elementos locados deverão permanecer apenas pelo período necessário à execução e ser retirados ao término dos serviços, com a recomposição das áreas ocupadas; a placa de obra, quando prevista, seguirá o modelo fornecido pela Administração.",
    normas: [], nrs: ["NR-18", "NR-24"], legislacao: [],
  },
  {
    id: "andaime",
    nome: "Andaimes e plataformas de trabalho",
    padrao: /andaime|balancim|plataforma (de trabalho|elevatoria)|bandeja de protecao/,
    texto: "Compreende o fornecimento, a montagem, a utilização e a desmontagem de andaimes e plataformas de trabalho, com apoio, ancoragem, travamento, guarda-corpos e rodapés adequados, conforme a NR-18, a NR-35 e a ABNT NBR 6494 (Segurança nos andaimes). A montagem deverá ser supervisionada por profissional habilitado e inspecionada antes da liberação para uso.",
    normas: ["ABNT NBR 6494 (segurança nos andaimes)"], nrs: ["NR-18", "NR-35"], legislacao: [],
  },
  {
    id: "sinalizacao-viaria",
    nome: "Sinalização viária",
    padrao: /sinalizacao (horizontal|vertical|viaria)|faixa de pedestre|tacha|tachao|pintura de faixa|demarcacao viaria|placa de regulamentacao|placa de advertencia/,
    texto: "Compreende a execução da sinalização viária definitiva, horizontal e/ou vertical, conforme projeto, o Código de Trânsito Brasileiro (Lei nº 9.503/1997) e o Manual Brasileiro de Sinalização de Trânsito do CONTRAN, observadas as especificações dos materiais (tintas, películas e dispositivos refletivos) e a retrorrefletividade exigida, com a via devidamente sinalizada e isolada durante a aplicação.",
    normas: [], nrs: ["NR-26"], legislacao: ["Lei nº 9.503/1997 (Código de Trânsito Brasileiro)"],
  },
  {
    id: "sinalizacao",
    nome: "Sinalização e isolamento das frentes de trabalho",
    padrao: /sinaliza|cavalete|cone |cones|fita zebrada|pisca|barreira|tela de (protecao|sinalizacao)|grade de isolamento/,
    texto: "Compreende o fornecimento, a instalação, a conservação e a retirada dos dispositivos temporários de sinalização e isolamento das frentes de trabalho, de modo a garantir a segurança de trabalhadores, pedestres e veículos. Nas intervenções em vias públicas, a sinalização atenderá ao Código de Trânsito Brasileiro (Lei nº 9.503/1997) e ao Manual Brasileiro de Sinalização de Trânsito do CONTRAN, além da NR-18 e da NR-26, devendo permanecer íntegra e visível, inclusive no período noturno, enquanto houver risco. A localização, a quantidade e o período de utilização serão definidos conforme cada frente de serviço.",
    normas: [], nrs: ["NR-18", "NR-26"], legislacao: ["Lei nº 9.503/1997 (Código de Trânsito Brasileiro)"],
  },
  {
    id: "sondagem",
    nome: "Sondagens e investigações geotécnicas",
    padrao: /sondagem|spt\b|trado/,
    texto: "Compreende a investigação geotécnica do subsolo pelo método indicado em cada item, com locação e identificação dos furos, registro de profundidades, amostras ou testemunhos, níveis d’água e demais ocorrências, e emissão de boletins e relatório técnico assinado por profissional habilitado. As sondagens à percussão (SPT) observarão a ABNT NBR 6484, as sondagens a trado a ABNT NBR 9603 e a programação dos furos a ABNT NBR 8036, no que couber. A mudança de método durante a perfuração deverá ser justificada tecnicamente e comunicada à fiscalização, e cada trecho será medido uma única vez, no item correspondente ao método e ao material constatados.",
    normas: ["ABNT NBR 6484 (sondagem de simples reconhecimento com SPT)", "ABNT NBR 9603 (sondagem a trado)", "ABNT NBR 8036 (programação de sondagens de simples reconhecimento)"],
    nrs: ["NR-12", "NR-18"], legislacao: [],
  },
  {
    id: "demolicao",
    nome: "Demolições",
    padrao: /demolic|desmonte|arrancamento|quebra de|quebra manual|picotamento/,
    texto: "Compreende a demolição dos elementos indicados, executada de forma planejada e progressiva, precedida de vistoria das edificações e instalações vizinhas, do desligamento das redes de energia, água, gás e telecomunicações e do isolamento da área, conforme a ABNT NBR 5682 (Contratação, execução e supervisão de demolições) e a NR-18. Os materiais reaproveitáveis serão separados e entregues conforme orientação da fiscalização, e os resíduos serão segregados, acondicionados, transportados e destinados a áreas licenciadas, em atendimento à Resolução CONAMA nº 307/2002 e à Lei nº 12.305/2010, com apresentação dos comprovantes de destinação.",
    normas: ["ABNT NBR 5682 (contratação, execução e supervisão de demolições)"], nrs: ["NR-18", "NR-35"], legislacao: RESIDUOS,
  },
  {
    id: "residuos",
    nome: "Carga, transporte e destinação de materiais",
    padrao: /entulho|bota.?fora|cacamba|\bcarga\b|descarga|transporte|destinacao|caminhao basculante|aterro sanitario/,
    texto: "Compreende a carga, o transporte e a descarga dos materiais e resíduos indicados, em veículos adequados e devidamente cobertos, com destinação final em locais licenciados pelo órgão ambiental competente. O transporte de resíduos da construção civil será acompanhado do respectivo documento de controle de transporte e observará a Resolução CONAMA nº 307/2002, a Lei nº 12.305/2010 e a legislação municipal aplicável. A medição considerará o volume ou a massa efetivamente transportados, na unidade e na distância de transporte previstas na planilha.",
    normas: [], nrs: ["NR-12"], legislacao: RESIDUOS,
  },
  {
    id: "remocao",
    nome: "Remoções e retiradas",
    padrao: /remocao|retirada/,
    texto: "Compreende a remoção ou retirada cuidadosa dos elementos indicados, com proteção das partes remanescentes e das instalações vizinhas. Os materiais aproveitáveis serão acondicionados e entregues em local indicado pela fiscalização, e os inservíveis terão destinação adequada, conforme a Resolução CONAMA nº 307/2002.",
    normas: [], nrs: ["NR-18"], legislacao: RESIDUOS,
  },
  {
    id: "limpeza-terreno",
    nome: "Limpeza do terreno e roçada",
    padrao: /rocada|capina|limpeza (manual |mecanizada )?d[oe] terreno|destocamento|desmatamento|raspagem|\bpoda\b|supressao/,
    texto: "Compreende a remoção de vegetação, a capina, a roçada e a limpeza da área estritamente necessária à execução dos serviços, com o recolhimento e a destinação adequada do material resultante. A supressão de vegetação arbórea, quando houver, dependerá de autorização do órgão ambiental competente, observada a legislação ambiental vigente.",
    normas: [], nrs: ["NR-12"], legislacao: [],
  },
  {
    id: "limpeza-final",
    nome: "Limpeza da obra",
    padrao: /limpeza (final|geral|de obra|da obra|permanente)/,
    texto: "Compreende a limpeza permanente das frentes de serviço e a limpeza final das áreas trabalhadas, com remoção de entulhos, sobras de materiais e resíduos, de modo que os locais sejam entregues em condições de uso, observada a destinação adequada dos resíduos.",
    normas: [], nrs: [], legislacao: [],
  },
  {
    id: "locacao",
    nome: "Locação e serviços topográficos",
    padrao: /locacao de obra|locacao da obra|gabarito|topografi|levantamento planialtimetrico|nivelamento geometrico|cadastro de rede/,
    texto: "Compreende a locação dos elementos da obra e os serviços topográficos necessários, executados por equipe habilitada, com referências de nível e marcos devidamente materializados e preservados, conforme a ABNT NBR 13133 (Execução de levantamento topográfico).",
    normas: ["ABNT NBR 13133 (execução de levantamento topográfico)"], nrs: [], legislacao: [],
  },
  {
    id: "ensaios",
    nome: "Ensaios e controle tecnológico",
    padrao: /ensaio|controle tecnologico|laudo|prova de carga|extracao de corpo/,
    texto: "Compreende a realização dos ensaios e verificações de controle tecnológico previstos, por laboratório ou profissional habilitado, conforme as normas ABNT aplicáveis a cada material ou serviço, com apresentação dos resultados e da respectiva responsabilidade técnica à fiscalização.",
    normas: [], nrs: [], legislacao: [],
  },
  {
    id: "terraplenagem",
    nome: "Movimento de terra",
    padrao: /escavac|reaterro|aterro|compactac|regularizacao (do|de) (sub)?leito|apiloamento|espalhamento|terraplen|corte (de|em) (terreno|talude|solo)/,
    texto: "Compreende os serviços de escavação, aterro, reaterro e compactação nas dimensões e cotas de projeto, com controle de umidade e de grau de compactação compatíveis com a finalidade do serviço. As escavações serão executadas com escoramento ou taludamento adequados, nos termos da NR-18 e da ABNT NBR 9061 (Segurança de escavação a céu aberto); os aterros em edificações observarão a ABNT NBR 5681 (Controle tecnológico da execução de aterros em obras de edificações), no que couber. O material excedente ou inservível será destinado conforme a legislação ambiental.",
    normas: ["ABNT NBR 9061 (segurança de escavação a céu aberto)", "ABNT NBR 5681 (controle tecnológico de aterros em edificações)"], nrs: ["NR-12", "NR-18"], legislacao: [],
  },
  {
    id: "fundacao",
    nome: "Fundações",
    padrao: /estaca|fundac|sapata|tubulao|radier|bloco de coroamento|baldrame|cravacao/,
    texto: "Compreende a execução dos elementos de fundação conforme os projetos estrutural e de fundações, com verificação das cotas de assentamento, das dimensões e das condições do terreno de apoio, em conformidade com a ABNT NBR 6122 (Projeto e execução de fundações). Qualquer divergência entre as condições encontradas e as premissas de projeto será comunicada à fiscalização antes da continuidade dos serviços.",
    normas: ["ABNT NBR 6122 (projeto e execução de fundações)"], nrs: ["NR-18"], legislacao: [],
  },
  {
    id: "drenagem",
    nome: "Drenagem pluvial",
    padrao: /drenagem|galeria|tubo de concreto|tubos de concreto|boca de lobo|caixa ralo|poco de visita|sarjeta|canaleta|bueiro|aduela|dreno/,
    texto: "Compreende a execução dos dispositivos de drenagem pluvial indicados, nas cotas e declividades de projeto, com assentamento sobre base regularizada, rejuntamento das peças e reaterro compactado, conforme a ABNT NBR 8890 (Tubo de concreto de seção circular para águas pluviais e esgotos sanitários) e a ABNT NBR 15645 (Execução de obras de esgoto sanitário e drenagem de águas pluviais utilizando tubos e aduelas de concreto), no que couber.",
    normas: ["ABNT NBR 8890 (tubos de concreto para águas pluviais e esgoto)", "ABNT NBR 15645 (execução de redes com tubos e aduelas de concreto)"], nrs: ["NR-18"], legislacao: [],
  },
  {
    id: "pavimentacao",
    nome: "Pavimentação e passeios",
    padrao: /asfalt|cbuq|concreto betuminoso|imprimacao|pintura de ligacao|fresagem|base de brita|sub.?base|paralelepipedo|bloquete|intertravado|meio.?fio|calcada|passeio|pavimenta|tapa.?buraco|recapeamento|lama asfaltica/,
    texto: "Compreende a execução das camadas de pavimento e dos elementos complementares indicados, sobre subleito e camadas subjacentes devidamente regularizados e compactados, com controle de espessura, grau de compactação, alinhamento e acabamento. Os serviços de pavimentação asfáltica observarão as especificações de serviço do DNIT aplicáveis (imprimação, pintura de ligação e concreto asfáltico) ou as especificações do órgão rodoviário de referência; os pavimentos intertravados observarão a ABNT NBR 15953, e os passeios, a ABNT NBR 9050.",
    normas: ["especificações de serviço do DNIT aplicáveis à pavimentação", "ABNT NBR 15953 (pavimento intertravado com peças de concreto)"], nrs: ["NR-12", "NR-18"], legislacao: [],
  },
  {
    id: "acessibilidade",
    nome: "Acessibilidade",
    padrao: /podotatil|acessibilidade|rampa|corrimao|guarda.?corpo|barra de apoio/,
    texto: "Compreende a execução dos elementos de acessibilidade previstos, em conformidade com a ABNT NBR 9050 (Acessibilidade a edificações, mobiliário, espaços e equipamentos urbanos) e, para a sinalização tátil no piso, com a ABNT NBR 16537, atendendo à Lei nº 13.146/2015 (Estatuto da Pessoa com Deficiência).",
    normas: ["ABNT NBR 9050 (acessibilidade)", "ABNT NBR 16537 (sinalização tátil no piso)"], nrs: [], legislacao: ["Lei nº 13.146/2015 (Estatuto da Pessoa com Deficiência)"],
  },
  {
    id: "impermeabilizacao",
    nome: "Impermeabilização",
    padrao: /impermeabiliza|manta asfaltica|membrana|emulsao asfaltica|cimento polimerico|argamassa polimerica/,
    texto: "Compreende a execução do sistema de impermeabilização especificado sobre superfícies regularizadas, limpas, secas e com os caimentos adequados, incluindo arremates em ralos, rodapés, juntas e passagens de tubulação, e o teste de estanqueidade antes da proteção mecânica, conforme a ABNT NBR 9574 (Execução de impermeabilização) e a ABNT NBR 9575 (Impermeabilização — seleção e projeto).",
    normas: ["ABNT NBR 9574 (execução de impermeabilização)", "ABNT NBR 9575 (impermeabilização — seleção e projeto)"], nrs: [], legislacao: [],
  },
  {
    id: "cobertura",
    nome: "Coberturas",
    padrao: /\btelha|telhado|cobertura|cumeeira|rufo|\bcalha|madeiramento|tesoura|terca|ripamento/,
    texto: "Compreende a execução ou recuperação das estruturas de cobertura, telhamentos, cumeeiras, rufos, calhas e arremates, com fixação, inclinação e recobrimentos recomendados pelos fabricantes, garantindo a estanqueidade do conjunto; o escoamento das águas pluviais observará a ABNT NBR 10844. Os trabalhos em altura observarão a NR-35 e a NR-18, com sistemas de proteção contra quedas e profissionais capacitados.",
    normas: ["ABNT NBR 10844 (instalações prediais de águas pluviais)"], nrs: ["NR-18", "NR-35"], legislacao: [],
  },
  {
    id: "esquadrias",
    nome: "Esquadrias, vidros e serralheria",
    padrao: /esquadria|\bporta|janela|portao|\bgrade\b|vidro|basculante|ferragem|fechadura|gradil|alambrado|serralheria/,
    texto: "Compreende o fornecimento e a instalação de esquadrias, portas, janelas, grades e respectivos vidros e ferragens, com prumo, nível, esquadro, vedação e funcionamento adequados, conforme a ABNT NBR 10821 (Esquadrias para edificações), no que couber, e a ABNT NBR 7199 quanto aos vidros.",
    normas: ["ABNT NBR 10821 (esquadrias para edificações)", "ABNT NBR 7199 (vidros na construção civil)"], nrs: [], legislacao: [],
  },
  {
    id: "eletrica",
    nome: "Instalações elétricas",
    padrao: /eletric|eletroduto|cabo (de cobre|flexivel|isolado)|disjuntor|quadro de (distribuicao|medicao|comando)|tomada|interruptor|luminaria|lampada|iluminacao|aterramento|spda|para.?raios|refletor|reator/,
    texto: "Compreende a execução das instalações elétricas indicadas, com materiais certificados e dimensionamento compatível com as cargas previstas, conforme a ABNT NBR 5410 (Instalações elétricas de baixa tensão), a ABNT NBR 5419 (Proteção contra descargas atmosféricas), quando aplicável, e as exigências da concessionária local. Os serviços serão executados por profissionais qualificados e autorizados, com as instalações desenergizadas, conforme a NR-10, e testados antes da entrega.",
    normas: ["ABNT NBR 5410 (instalações elétricas de baixa tensão)", "ABNT NBR 5419 (proteção contra descargas atmosféricas)"], nrs: ["NR-10"], legislacao: [],
  },
  {
    id: "hidrossanitaria",
    nome: "Instalações hidrossanitárias",
    padrao: /agua fria|agua quente|hidraul|tubo (de )?pvc|tubulacao|\bregistro|torneira|valvula|caixa d.?agua|reservatorio|bacia sanitaria|vaso sanitario|lavatorio|mictorio|\bpia\b|esgoto|sifao|\bralo\b|caixa de gordura|caixa de inspecao|fossa|filtro anaerobio|sumidouro|\blouca/,
    texto: "Compreende a execução das instalações hidrossanitárias com tubos, conexões, aparelhos e metais especificados, observadas as declividades, a estanqueidade e o funcionamento do conjunto, conforme a ABNT NBR 5626 (Sistemas prediais de água fria e água quente) e a ABNT NBR 8160 (Sistemas prediais de esgoto sanitário) e, quando houver tratamento individual de esgoto, a ABNT NBR 7229 e a ABNT NBR 13969. As redes serão submetidas a ensaios de estanqueidade antes do fechamento.",
    normas: ["ABNT NBR 5626 (água fria e água quente)", "ABNT NBR 8160 (esgoto sanitário)"], nrs: [], legislacao: [],
  },
  {
    id: "pintura",
    nome: "Pinturas",
    padrao: /pintura|\btinta|selador|massa corrida|massa acrilica|verniz|textura|esmalte|fundo preparador|emassamento|caiacao/,
    texto: "Compreende o preparo das superfícies (limpeza, correção de imperfeições, lixamento e aplicação de fundo ou selador, quando previsto) e a aplicação das demãos necessárias ao perfeito cobrimento, respeitados os intervalos indicados pelos fabricantes, conforme a ABNT NBR 13245 (Tintas para construção civil — execução de pinturas em edificações não industriais). As tintas serão de linha compatível com a especificação do item e com as superfícies a que se destinam.",
    normas: ["ABNT NBR 13245 (execução de pinturas em edificações não industriais)"], nrs: [], legislacao: [],
  },
  {
    id: "revestimento",
    nome: "Revestimentos de argamassa",
    padrao: /chapisco|emboco|reboco|massa unica|revestimento (de|em) argamassa/,
    texto: "Compreende a execução de chapisco, emboço, reboco ou massa única sobre bases limpas e previamente umedecidas, respeitadas as espessuras e os tempos de cura entre camadas, conforme a ABNT NBR 7200 (Execução de revestimento de paredes e tetos de argamassas inorgânicas) e a ABNT NBR 13749 (Revestimento de paredes e tetos de argamassas inorgânicas — especificação).",
    normas: ["ABNT NBR 7200 (execução de revestimento de argamassa)", "ABNT NBR 13749 (revestimento de argamassa — especificação)"], nrs: [], legislacao: [],
  },
  {
    id: "pisos",
    nome: "Pisos e revestimentos cerâmicos",
    padrao: /ceramic|porcelanato|azulejo|ladrilho|\bpiso|rodape|soleira|peitoril|granito|marmore|contrapiso|cimentado/,
    texto: "Compreende o preparo da base, a execução de contrapisos e o assentamento de pisos e revestimentos com os materiais e as argamassas especificados, observados os caimentos, as juntas de assentamento e de movimentação e o nivelamento das superfícies, conforme as ABNT NBR 13753, NBR 13754 e NBR 13755, conforme o caso, e a ABNT NBR ISO 13006 quanto às placas cerâmicas.",
    normas: ["ABNT NBR 13753, NBR 13754 e NBR 13755 (revestimentos cerâmicos)"], nrs: [], legislacao: [],
  },
  {
    id: "alvenaria",
    nome: "Alvenarias e vedações",
    padrao: /alvenaria|bloco ceramico|bloco de concreto|tijolo|divisoria|drywall|gesso acartonado|verga|encunhamento/,
    texto: "Compreende a execução de alvenarias e vedações nas espessuras, alinhamentos e prumos indicados, com amarração adequada às estruturas, vergas e contravergas nos vãos e encunhamento após o período recomendado. Os blocos cerâmicos atenderão à ABNT NBR 15270 e os blocos de concreto à ABNT NBR 6136, observadas as normas ABNT aplicáveis ao sistema de vedação adotado.",
    normas: ["ABNT NBR 15270 (componentes cerâmicos para alvenaria)", "ABNT NBR 6136 (blocos vazados de concreto)"], nrs: ["NR-18"], legislacao: [],
  },
  {
    id: "concreto",
    nome: "Estruturas de concreto",
    padrao: /concreto|forma |formas|armacao|aco ca|\blaje|\bpilar|\bviga\b|graute|escoramento/,
    texto: "Compreende o fornecimento, o preparo, o lançamento, o adensamento e a cura do concreto, bem como as fôrmas, os escoramentos e as armaduras correspondentes, conforme o projeto estrutural e as ABNT NBR 6118 (Projeto de estruturas de concreto), ABNT NBR 14931 (Execução de estruturas de concreto) e ABNT NBR 12655 (Concreto de cimento Portland — preparo, controle, recebimento e aceitação). O aço para armaduras atenderá à ABNT NBR 7480. O controle tecnológico, com moldagem e ensaio de corpos de prova, será realizado conforme as normas aplicáveis, e os resultados serão apresentados à fiscalização.",
    normas: ["ABNT NBR 6118 (projeto de estruturas de concreto)", "ABNT NBR 14931 (execução de estruturas de concreto)", "ABNT NBR 12655 (concreto — preparo, controle, recebimento e aceitação)"], nrs: ["NR-18"], legislacao: [],
  },
  {
    id: "paisagismo",
    nome: "Paisagismo",
    padrao: /grama|plantio|\bmuda|paisag|jardim|arvore|terra vegetal|adubo/,
    texto: "Compreende o preparo do solo, o fornecimento e o plantio das espécies indicadas e os cuidados de manutenção até o recebimento, de forma a assegurar o pegamento e o desenvolvimento adequado da vegetação.",
    normas: [], nrs: [], legislacao: [],
  },
  {
    id: "equipamentos",
    nome: "Equipamentos",
    padrao: /aluguel|locacao de|hora produtiva|hora improdutiva|caminhao|retroescavadeira|escavadeira|rolo compactador|motoniveladora|pa carregadeira|trator|guindaste|munck|compressor|betoneira/,
    texto: "Compreende a disponibilização dos equipamentos indicados, com operador quando previsto, em perfeitas condições de funcionamento e segurança, medidos pelas horas ou períodos efetivamente utilizados e atestados pela fiscalização. As máquinas e os equipamentos atenderão à NR-12 e à NR-18, e os veículos, à legislação de trânsito.",
    normas: [], nrs: ["NR-12", "NR-18"], legislacao: [],
  },
  {
    id: "mao-de-obra",
    nome: "Mão de obra",
    padrao: /servente|pedreiro|carpinteiro|eletricista|encanador|bombeiro hidraulico|pintor|soldador|armador|operador|ajudante|motorista|auxiliar/,
    texto: "Compreende a disponibilização de mão de obra qualificada para a função indicada, medida pelas horas efetivamente trabalhadas e atestadas pela fiscalização, com todos os encargos sociais e trabalhistas e o fornecimento dos equipamentos de proteção individual pela Contratada, conforme a NR-6.",
    normas: [], nrs: ["NR-6"], legislacao: [],
  },
];

export const CATEGORIA_GERAL: CategoriaMemorial = {
  id: "geral",
  nome: "Demais serviços",
  padrao: /$^/,
  texto: "Compreende a execução do serviço conforme a discriminação do item na base de referência indicada, as especificações técnicas do projeto, as recomendações dos fabricantes e as normas técnicas da ABNT aplicáveis, com materiais de qualidade comprovada e mão de obra qualificada, sujeitos à aprovação da fiscalização.",
  normas: [], nrs: [], legislacao: [],
};

export const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ");

export function categoriaDoItem(descricao: string): CategoriaMemorial {
  const d = ` ${semAcento(descricao)} `;
  return CATEGORIAS.find((c) => c.padrao.test(d)) ?? CATEGORIA_GERAL;
}

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];

/** Número por extenso (0 a 199), para prazos: "12 (doze)". */
export function porExtenso(n: number): string {
  if (n === 0) return "zero";
  if (n === 100) return "cem";
  if (n > 100) return `cento e ${porExtenso(n - 100)}`;
  if (n < 20) return UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
}
