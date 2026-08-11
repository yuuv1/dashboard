# Pasta `dias/`

Uma pasta por dia de operação, no formato `AAAA-MM-DD` (ex.: `2026-08-11`).

Dentro de cada pasta:
- `print-01.jpg`, `print-02.jpg`, ... → os prints das operações daquele dia (na ordem);
- `operacoes.json` → o registro das operações (preenchido pelo agente ao receber os prints).

⚠️ Não edite estes arquivos na mão — o fluxo é: você manda os prints na conversa
e o agente organiza aqui e atualiza o `edgecontrol_master.json`.
