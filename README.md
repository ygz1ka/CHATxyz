# Conecta XYZ — Chat Privado Corrigido

Base: a versão **Chat-Interno-XYZ-Auditado-Render**, não a versão simplificada da aula.

## Recursos

- Chat em tempo real com Node.js, Express, HTTP e Socket.IO.
- Salas públicas: `#geral`, `#projetos` e `#avisos`.
- Conversas privadas: clique em um nome na lista de participantes à direita ou em **CONVERSAS PRIVADAS** na barra lateral. O contato deve estar online para iniciar uma conversa nova. Conversas anteriores podem ser reabertas mesmo offline.
- Histórico público e privado separado (100 mensagens por canal ou par de usuários), digitando, avisos de conexão, lista de online.
- Mensagens próprias à direita (roxo), mensagens recebidas à esquerda. Identificador do navegador salvo no `localStorage` para sobreviver a recarregamentos. Mensagens públicas antigas criadas por uma identificação anterior usam o nome como alternativa quando não houver outro usuário online com o mesmo nome. Portanto, em nomes repetidos o alinhamento de mensagens legadas pode ser impreciso.
- Campo de mensagens mantido no rodapé. Envio não confirmado não apaga o texto.

## Executar

Instale o Node.js 20+ e execute **dentro desta pasta**:

```bash
npm install
npm start
```

Abra `http://localhost:3000`. Para um amigo na mesma rede, use `http://IP-DO-PC:3000` e libere o Node.js somente em redes privadas no firewall, se necessário. Para amigos em outras redes, publique no Render.

## Preservar histórico antigo

Se você já tem mensagens no projeto antigo, **pare o servidor** e copie o arquivo `data/messages.json` da versão antiga para `data/messages.json` desta versão **antes de iniciar**. Sem essa cópia, a nova pasta começa sem mensagens. O histórico privado novo é salvo em `data/private-messages.json`.

**Não suba `data/messages.json` nem `data/private-messages.json` ao GitHub** (estão ignorados). O Render não garante persistência desses arquivos locais durante um redeploy/reinicialização. Banco de dados externo é necessário para histórico durável.

## Publicação no Render

1. Crie um repositório no GitHub e envie os arquivos (exceto `node_modules` e arquivos de mensagens).
2. Render → New → Web Service → selecione o repositório.
3. Build Command: `npm ci`; Start Command: `npm start`.
4. O servidor usa a variável `PORT` do Render e serve o front-end junto com o back-end.

## Atenção sobre privacidade

**As mensagens privadas NÃO são protegidas por autenticação de usuário.** A identificação é baseada em ID salvo no navegador, que pode ser forjado. É uma demonstração acadêmica e **não deve ser usada com dados privados ou sensíveis reais**. Para garantir privacidade de verdade, é preciso autenticação e autorização no servidor, além de um banco de dados persistente.

## Testes antes da entrega

- Abra em dois navegadores ou dispositivos diferentes e entre com nomes distintos.
- Verifique envio e recebimento em `#geral`, troca de salas e mensagens alinhadas nas laterais corretas.
- Clique no nome do outro participante, envie mensagem privada e confirme que só os dois a recebem.
- Recarregue as páginas e confirme que o histórico aparece no mesmo lado.
- Abra `http://localhost:3000/health` e confirme `{"ok":true}`.
