# Layouts dos arquivos oficiais (verificados em arquivos reais)

Fonte das observações: arquivos enviados pelo usuário em 15/10/2026 —
`SINAPI-2026-09-formato-xlsx.zip` e `092026.rar` (EMOP, boletim 767/26,
13ª edição). Tudo abaixo foi lido desses arquivos; nada foi presumido.
Novos layouts exigem nova amostra e um novo adaptador.

## SINAPI (formato 2025+, XLSX)

ZIP com:

| Arquivo | Abas | Uso no sistema |
|---|---|---|
| `SINAPI_Referência_AAAA_MM.xlsx` (13,6 MB) | Menu, Busca, ISD, ICD, ISE, CSD, CCD, CSE, Analítico, Analítico com Custo | **Principal** |
| `SINAPI_mao_de_obra_AAAA_MM.xlsx` | SEM Desoneração, COM Desoneração | % de mão de obra por composição/UF (informativo) |
| `SINAPI_familias_e_coeficientes_AAAA_MM.xlsx` | Coeficientes | Famílias/coeficientes de representatividade (informativo) |
| `SINAPI_Manutenções_AAAA_MM.xlsx` | Manutenções | Histórico de alterações de código/descrição (Referência, Tipo, Código, Descrição, Manutenção) |

### Abas de insumos ISD / ICD / ISE

- Linha 3: `Mês de Referência:` | `MM/AAAA`. Linha 4: `Data de emissão:`.
- ISD/ICD, linha 4, col. E: `(SEM DESONERAÇÃO)` / `(COM DESONERAÇÃO)`;
  linhas 4–7 trazem por UF: sigla, localidade, encargos Horista e Mensalista.
  ISE: "RELATÓRIO DE PREÇOS DE INSUMOS - SEM EN[CARGOS]".
- Linha 10 (cabeçalho): `Classificação`, `Código do Insumo`, `Descrição do
  Insumo`, `Unidade`, `Origem de Preço`, depois uma coluna por UF
  (AC … ; **RJ na coluna índice 23 em 09/2026** — localizar pelo cabeçalho,
  nunca por posição fixa).
- Dados a partir da linha 11. Código numérico (célula numérica). 4.878 insumos.
- Classificação (09/2026): MATERIAL, MAO DE OBRA, EQUIPAMENTO (AQUISIÇÃO),
  EQUIPAMENTO (LOCAÇÃO), ENCARGOS COMPLEMENTARES, SERVIÇOS, ESPECIAIS.
- Origem de preço: `C` = coletado, `CR` = coeficiente de representatividade.
- "Preço em branco para determinado estado" = **sem preço** (nunca zero).

### Abas de composições CSD / CCD / CSE

- Mesmo cabeçalho de topo; linha 9 tem as siglas das UFs, linha 10:
  `Grupo`, `Código da Composição`, `Descrição`, `Unidade`, e pares
  (`Custo (R$)`, `%AS`) por UF. RJ: colunas 40/41 em 09/2026.
- **Atenção**: a célula do código contém a fórmula
  `=HYPERLINK("#"&CELL("address",OFFSET(Analítico!$B$1,MATCH(104658,…`
  e o valor armazenado é **0**. O código deve ser extraído da fórmula
  (`MATCH(<código>,`) e conferido com a aba Analítico.
- `%AS`: percentual do custo obtido com preços atribuídos de São Paulo.
- **Custo zero**: nota oficial na própria aba — "Custo zerado (hífen) indica
  que pelo menos um dos itens da composição não tem custo/preço". Em 09/2026,
  2.156 composições no RJ (por regime). São gravadas **sem preço**, nunca R$ 0.
- 10.599 composições.

### Aba Analítico

- Linha 10: `Grupo`, `Código da Composição`, `Tipo Item`, `Código do Item`,
  `Descrição`, `Unidade`, `Coeficiente`, `Situação`.
- Linha de cabeçalho da composição: `Tipo Item` vazio (descrição/unidade da
  própria composição). Linhas seguintes: componentes com `Tipo Item` =
  `INSUMO` ou `COMPOSICAO`.
- Situação: COM PREÇO, SEM PREÇO (insumo), COM CUSTO, SEM CUSTO, EM ESTUDO
  (composição).
- Não depende do regime (uma única aba).

## EMOP-RJ (DBF dBase III, codificação CP850)

RAR mensal `MMAAAA.rar`. Os `.xls` são cópias byte a byte dos `.dbf`.
O sufixo `MMAA` do nome identifica a competência (`0926` = 09/2026).

| Arquivo | Campos (nome:tipo(tamanho,decimais)) | Registros 09/2026 |
|---|---|---|
| `EMOPMMAA` | CODIGO:C(13) PRECO:N(17,2) | 22.248 |
| `DIPRMMAA` | CODIGO:C(13) DESCR1..DESCR6:C(60) UNID:C(6) CUSTO:N(18,2) | 22.248 |
| `COMPMMAA` | CODIGO:C(13) SEQUENCIA:C(3) ELEMENTAR:C(5) QUANTIDADE:N(19,8) PERCENTUAL:N(19,8) | 103.866 |
| `MATMMAA`  | ELEMENTAR:C(5) DESCRICAO:C(40) DESCR1..DESCR3:C(40) UNID:C(6) PRECO:N(21,4) | 5.268 |
| `REUTMMAA` | ELEMENTAR:C(5) COMPOSICAO:C(10) DESCRICAO:C(40) DESCR1..DESCR3:C(40) UNIDADE:C(6) | 1.952 |
| `ELEMMMAA` | ELEMENTAR:C(5) PRECO:N(21,4) | 7.220 (= MAT + REUT) |

Observações verificadas:

- Descrições longas são cortadas em campos de largura fixa, inclusive no
  meio de palavras (`…REGIAO METROP` + `OLITANA…`). Juntar os campos **sem**
  remover espaços internos e só então aparar o final.
- Código de serviço `CC.FFF.IIII-D`; `D` (último caractere) = regime,
  conforme o Catálogo de Referência (13ª ed.): 0–4 sem desoneração, A–E com
  desoneração; 1/B composição reutilizada; 2–4/C–E só na categoria 19.
  Distribuição em 09/2026: 0/A 10.120 cada; 1/B 572; 2/C 165; 3/D 109; 4/E 158.
- `REUT.COMPOSICAO` é o código do serviço sem pontuação (`0100100751` =
  `01.001.0075-1`).
- 10 serviços do DIPR não têm linhas no COMP (sem analítica publicada →
  não exibir analítica para eles). Todos os elementares do COMP têm preço em ELEM.
- Em 36.744 linhas do COMP `PERCENTUAL` > 0 (sempre junto de QUANTIDADE > 0).
- Regra de custo conferida: `truncar₂(Σ QUANTIDADE × PRECO_ELEM × (1 + PERCENTUAL/100))`
  = CUSTO publicado em 22.013 de 22.238 serviços com analítica (99,0%);
  os demais diferem em R$ 0,01. O sistema usa o CUSTO publicado.
- Data de última atualização no cabeçalho DBF: 05/10/2026.
- **Índices setoriais**: 10 registros `CC.FFF.9999-D` do DIPR/EMOP sem unidade
  (ex.: 05.100.9999-0 = Índice Geral da Construção Civil = 8683). O "custo"
  é número-índice (conferido com o PDF "Índices com e sem desoneração"); não
  entram no catálogo de preços, ficam no relatório da importação.
- **Sem unidade**: 6 elementares do REUT 09/2026 (01294–01296, 30500–30502,
  guindaste CP/CF/CI) não têm unidade publicada; são gravados sem unidade.
