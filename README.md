# Conecta XYZ — Mídia, Grupos e Perfis

Projeto baseado na versão **Conecta-XYZ-Chat-Privado-Corrigido**. Mantém os canais #geral, #projetos e #avisos, as conversas privadas e o alinhamento estilo WhatsApp.

## Executar

1. Instale Node.js 20 ou mais recente.
2. Abra esta pasta no terminal.
3. Rode `npm ci` (ou `npm install` se necessário).
4. Rode `npm start`.
5. Abra `http://localhost:3000`.

## Recursos

- Mensagens em tempo real via Socket.io, histórico público, privado e por grupo.
- Mensagens próprias alinhadas à direita, recebidas à esquerda. Mensagens antigas com IDs válidos seguem o mesmo alinhamento.
- Botão 📎 para anexar PNG, JPG, GIF, WebP, PDF, TXT, CSV, ZIP, DOCX e XLSX (5 MB por arquivo).
- Imagens aparecem diretamente na conversa; outros tipos aparecem com link para baixar.
- Botão ☺ abre o seletor de emojis.
- Botão “＋ Criar” na seção GRUPOS: escolha o nome e participantes que estejam online. Grupos permanecem na lista e guardam histórico.
- Botão 📷 ao lado do próprio perfil para enviar uma foto.
- Suporte a conversa particular e aos canais originais.

## Teste antes de publicar

- Abra duas janelas, cada uma com um perfil de navegador diferente (para garantir identificadores distintos).
- Entre com dois nomes, envie mensagens nos canais e confira o alinhamento.
- Envie imagens e documentos, reabra a conversa e teste o histórico.
- Crie um grupo com a segunda pessoa, envie mensagens e confira a atualização na outra janela.
- Atualize a foto e confira que aparece também para a outra pessoa.
- Atualize a página e teste grupos, anexos e histórico.

## Render, privacidade e limitações

O Render aceita `npm ci` como Build Command e `npm start` como Start Command; use um serviço Web com Node.js. A variável PORT é lida do ambiente e o servidor escuta em 0.0.0.0.

**ATENÇÃO:** este projeto é uma demonstração didática, não um mensageiro privado seguro. Não há login com senha, e o ID de usuário é enviado pelo navegador. Pessoas que consigam imitar esse ID podem acessar mensagens e grupos. Links de anexos podem ser acessados por qualquer pessoa com a URL. Não envie informações pessoais, credenciais ou documentos confidenciais.

O histórico, os grupos, as fotos e os uploads são armazenados em `data/` no disco local. **No Render o filesystem padrão é efêmero:** reiniciar/deployar pode apagar esse conteúdo. Antes do uso real, implemente autenticação, autorização de uploads, armazenamento externo (S3, Cloudinary etc.) e banco de dados persistente (PostgreSQL etc.). Limite atual de 5 MB e formatos permitidos pelo servidor.

## Estrutura

- `server.js`: Express, HTTP, Socket.io, uploads, grupos, perfis e histórico.
- `public/index.html`: interface.
- `public/app.js`: navegação e interações do chat.
- `public/style.css`: visual.
- `data/`: dados locais gerados automaticamente (não publicar informações reais).

## Situação dos testes

Sintaxe JS verificada com `node --check`. **Não foi possível completar `npm ci` neste ambiente por indisponibilidade de pacotes no cache/rede; testes end-to-end não foram executados.** Execute os testes descritos acima antes de hospedar.


## Atualização — imagens e mensagens de voz

- Imagens abrem em um visualizador dentro do chat. Feche pelo X, pela tecla Esc ou clicando fora da imagem.
- Clique no microfone para gravar; clique novamente para parar, ou em **Cancelar** para descartar. Após a gravação, o áudio é preparado como anexo: clique em **Enviar** para transmiti-lo à conversa atual.
- Os áudios ficam em um reprodutor dentro das mensagens e funcionam nos canais, privados e grupos. Limites: 45 segundos e 5 MB por arquivo. Compatível com formatos suportados pelo navegador (WebM, Ogg, MP4).
- Permissão de microfone requer `localhost` ou HTTPS; acesso via endereço IP em HTTP geralmente impede o microfone.
- Arquivos de mídia continuam salvos em `data/uploads`, armazenamento temporário em planos Render sem disco persistente.
- Isto implementa **mensagens de voz**, não chamadas de áudio em tempo real.

## Indicador de digitação (novo)

- Exibe **Fulano está digitando...** para os outros participantes da conversa aberta, nos canais, grupos e privados.
- Funciona mesmo quando dois participantes possuem o mesmo nome, pois o indicador vem do socket e não usa uma comparação simples por nome.
- O indicador é retirado ao enviar, sair do campo, mudar de conversa, desconectar ou ficar sem digitar. Também possui expiração automática caso um evento de parada se perca.
- Para testar, abra o chat em dois navegadores com perfis diferentes e digite sem enviar. Não aparece para a própria pessoa.

## LINK OFICIAL SITE

https://chatxyz-hump.onrender.com
