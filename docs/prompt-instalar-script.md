# Instalar o script de revisão em todos os sites

O script de revisão precisa estar em cada site para o cliente conseguir comentar:

```html
<script src="https://lysch-feedback.vercel.app/loader.js" data-studio="lysch" defer></script>
```

Para instalar à mão, cole essa linha em **Site settings → Custom code → Footer code** (Webflow) ou em **Site Settings → General → Custom Code → End of `<body>` tag** (Framer) e publique.

Para instalar em vários sites de uma vez, use o prompt abaixo num chat do Claude com o **conector do Webflow** ligado (na conta que tem acesso aos sites). Ele lista os sites, mostra o que vai fazer, pede confirmação e só publica se você autorizar.

## Como funciona

- O Claude instala o script pela API do Webflow, como um **script do site** (aparece em Site settings → Custom code → "Custom code added by apps", não no campo Footer code).
- A API não enxerga o que foi colado à mão no Footer code. Por isso o Claude abre cada site publicado para ver se ainda existe o **script antigo** (`pxmwnesytlwtdxcalmux`) e, se existir, pede para você apagar à mão. Os dois juntos não quebram nada, mas o antigo manda os comentários para o ambiente antigo.
- O script só passa a valer depois de **publicar** o site.
- A revisão abre sozinha em `*.webflow.io`, `*.framer.app` e `*.framer.website`. Domínio próprio precisa ser liberado no estúdio (veja o fim deste arquivo).

## Prompt (copie tudo dentro do bloco)

````text
Quero instalar o script da ferramenta de feedback da Lysch nos sites Webflow. Use o conector do Webflow e siga estes passos, falando comigo em português simples. Não publique nada sem eu autorizar.

O script, em forma de script inline (é o que vai pela API, com 219 caracteres):
(function(){if(window.__FB_LOADER__)return;var s=document.createElement('script');s.src='https://lysch-feedback.vercel.app/loader.js';s.defer=true;s.setAttribute('data-studio','lysch');document.body.appendChild(s);})();

1. Levantar a situação (só leitura)
   - Chame webflow_guide_tool uma vez antes das outras ferramentas do Webflow.
   - Liste todos os sites a que você tem acesso, com o subdomínio (<shortName>.webflow.io) e os domínios próprios.
   - Para cada site, veja os scripts já aplicados pela API (data_scripts_tool) e procure um script registrado com displayName "Lysch Feedback".
   - Para cada site, abra a página inicial publicada em https://<shortName>.webflow.io/ e procure no HTML:
     - "lysch-feedback.vercel.app/loader.js" → script novo já está no ar;
     - "pxmwnesytlwtdxcalmux" → script ANTIGO colado à mão no Footer code;
     - nenhum dos dois → sem script.
   - Mostre uma tabela: site · endereço · script novo (aplicado pela API? no ar?) · script antigo no Footer code? · o que você propõe.

2. Perguntar
   - Quais sites devem receber o script (sugira todos os que ainda não têm o script novo).
   - Se devo publicar depois de instalar e onde: só no subdomínio *.webflow.io (recomendado para sites em revisão) ou também nos domínios próprios.
   Espere a resposta. Sem resposta, pare aqui.

3. Instalar (só nos sites aprovados)
   - Se o site ainda não tem o script "Lysch Feedback" registrado, registre o script inline acima com displayName "Lysch Feedback" e version "1.0.0".
   - Aplique no site com location "footer". IMPORTANTE: a aplicação substitui a lista de scripts do site; leia antes os scripts já aplicados e mantenha todos eles, só acrescentando o novo.
   - Não mexa em páginas, estilos, CMS nem em nenhum outro script.
   - Se algo falhar, não contorne: anote o erro e siga para o próximo site.

4. Publicar (só se eu autorizei no passo 2)
   - Publique só nos destinos que eu autorizei.
   - Depois, abra a página inicial publicada e confira se "lysch-feedback.vercel.app/loader.js" aparece no HTML.

5. Resumo final
   - Tabela: site · instalado? · publicado? · conferido no ar? · pendências.
   - Para cada site com o script ANTIGO, escreva o passo a passo para eu remover à mão: Webflow → Site settings → Custom code → Footer code → apagar a linha com "pxmwnesytlwtdxcalmux" → Save → Publish.
   - Para sites com domínio próprio, lembre que o domínio precisa ser liberado no estúdio para a revisão abrir nele.
   - Sites Framer ou de código não passam pelo conector: liste-os com a linha para colar à mão:
     <script src="https://lysch-feedback.vercel.app/loader.js" data-studio="lysch" defer></script>
````

## Domínio próprio

Para a revisão abrir num domínio próprio (ex.: `www.cliente.com.br`), libere o domínio no estúdio, no SQL Editor do Supabase (projeto `ipntwqtdbjpbgtlglznc`):

```sql
update fb_studios set allowed_domains = array_append(allowed_domains, 'www.cliente.com.br') where id = 'lysch';
```

Links de revisão (`?review=…`) e o painel funcionam em qualquer domínio, mesmo sem essa liberação.

## Conferir um site

Abra o site publicado com `?painel` no fim do endereço (ex.: `https://lysch-nova.webflow.io/?painel`). Se aparecer o login "Painel do estúdio", o script está funcionando.
