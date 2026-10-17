"""
Gera amostras reduzidas (dados reais) dos pacotes SCO-Rio (O e D) para os testes.
Uso: python3 -I scripts/gerar-fixtures-sco.py <pasta com O/ e D/ extraídos> tests/fixtures/sco
Mantém nomes oficiais, cabeçalhos, a hierarquia (área/grupo/subgrupo) e os
blocos completos das composições escolhidas, com os elementares que usam.
"""
import os, re, sys, openpyxl

origem, destino = sys.argv[1], sys.argv[2]
# serviços escolhidos no O (com RSE, B, EVE %, reutilização no cabeçalho, REQ) e os correspondentes no D (mesma descrição)
ESCOLHIDOS_O = ["AD 05.05.0050 (/)", "AD 05.05.0650 (B)", "AD 05.05.0706 (A)", "AD 10.10.0100 (/)", "AD 05.10.0050 (/)"]
SERV = re.compile(r"^[A-Z]{2} \d{2}\.\d{2}\.\d{4} \(")

def arq(p, prefixo):
    return [f for f in os.listdir(os.path.join(origem, p)) if f.startswith(prefixo) and f.endswith(".xlsx")][0]

def ler(p, prefixo):
    f = arq(p, prefixo)
    return f, list(openpyxl.load_workbook(os.path.join(origem, p, f), read_only=True).worksheets[0].iter_rows(values_only=True))

def gravar(p, nome, linhas, aba):
    os.makedirs(os.path.join(destino, p), exist_ok=True)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = aba
    for l in linhas: ws.append(list(l))
    wb.save(os.path.join(destino, p, nome))

desc_o = {}
f6, r6 = ler("O", "CATÁLOGO DOS ITENS")
for r in r6:
    if isinstance(r[2], str) and SERV.match(r[2]): desc_o[r[2].strip()] = r[3]
alvo_desc = [desc_o[c] for c in ESCOLHIDOS_O]

for p in ["O", "D"]:
    f6, r6 = ler(p, "CATÁLOGO DOS ITENS")
    sem_sufixo = lambda t: re.sub(r"\s*\(desonerado\)\s*$", "", t or "")
    escolhidos = [r[2].strip() for r in r6 if isinstance(r[2], str) and SERV.match(r[2]) and sem_sufixo(r[3]) in alvo_desc]
    out, ctx, vistos = list(r6[:3]), {}, set()
    for r in r6[3:]:
        if r[0]: ctx = {"a": r}
        elif r[1]: ctx = {"a": ctx.get("a"), "g": r}
        elif isinstance(r[2], str) and not SERV.match(r[2]): ctx = {"a": ctx.get("a"), "g": ctx.get("g"), "s": r}
        elif isinstance(r[2], str) and r[2].strip() in escolhidos:
            for k in "ags":
                if ctx.get(k) is not None and id(ctx[k]) not in vistos: vistos.add(id(ctx[k])); out.append(ctx[k])
            out.append(r)
    gravar(p, f6, out, "FGV06")
    f7, r7 = ler(p, "CATÁLOGO DAS COMPOSIÇÕES")
    out, usados, dentro = list(r7[:5]), set(), False
    for r in r7[5:]:
        if r[0]:
            dentro = any(str(r[0]).strip().startswith(c) for c in escolhidos)
            if dentro: out.append(r)
        elif dentro:
            out.append(r)
            if r[2] and r[2] != "Código": usados.add(r[2])
    gravar(p, f7, out, "FGV07")
    f4, r4 = ler(p, "REL DE ITENS")
    out = list(r4[:4])
    for r in r4[4:]:
        if r[0] and (r[0] in usados or not re.match(r"^[A-Z]{3}\d", str(r[0]))): out.append(r)
    gravar(p, f4, out, "FGV04")
    print(p, escolhidos, sorted(usados))
