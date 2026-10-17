"""
Gera amostras reduzidas (dados reais) do pacote SICRO para os testes.
Uso: python3 -I scripts/gerar-fixtures-sicro.py <pasta com os XLSX oficiais extraídos> tests/fixtures/sicro
Mantém os nomes oficiais dos arquivos, os cabeçalhos e os blocos completos do
analítico das composições escolhidas (e dos insumos que elas usam).
"""
import os, sys, openpyxl

origem, destino = sys.argv[1], sys.argv[2]
os.makedirs(destino, exist_ok=True)
PREFIXO = "RJ 07-2026 Relatório "
COMPOSICOES = {"0307731", "0308308", "1108059", "5914655", "5914449"}

def ler(nome):
    return list(openpyxl.load_workbook(os.path.join(origem, PREFIXO + nome + ".xlsx"), read_only=True).worksheets[0].iter_rows(values_only=True))

def gravar(nome, linhas, aba="Sheet1"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = aba
    for l in linhas:
        ws.append(list(l))
    wb.save(os.path.join(destino, PREFIXO + nome + ".xlsx"))

# analítico: blocos completos das composições escolhidas
an = ler("Analítico de Composições de Custos")
blocos, atual = [], None
for l in an:
    if l[0] == "SISTEMA DE CUSTOS REFERENCIAIS DE OBRAS - SICRO":
        atual = [l]; blocos.append(atual)
    elif atual is not None:
        atual.append(l)
escolhidos = [b for b in blocos if str(b[2][0]) in COMPOSICOES]
usados = set()
for b in escolhidos:
    for l in b:
        if isinstance(l[0], str) and l[0][:1] in "MPEA" and l[0][1:].isdigit():
            usados.add(l[0])
gravar("Analítico de Composições de Custos", [l for b in escolhidos for l in b])

def filtrar(nome, codigos, aba="Sheet1"):
    linhas = ler(nome)
    gravar(nome, [linhas[0]] + [l for l in linhas[1:] if l[0] in codigos], aba)

filtrar("Sintético de Composições de Custos", COMPOSICOES)
filtrar("Sintético de Materiais", usados | {"M0104"})  # M0104: publicado com "-" (sem preço)
for n in ["Equipamentos", "Equipamentos - com desoneração"]:
    filtrar("Sintético de " + n, usados)
for n in ["Mão de Obra", "Mão de Obra - com desoneração"]:
    filtrar("Sintético de " + n, usados, "Rel. Sintético de Mão de Obra")
print(sorted(usados), len(escolhidos))
