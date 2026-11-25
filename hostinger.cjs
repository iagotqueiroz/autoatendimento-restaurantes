// A Hostinger carrega o arquivo inicial com require(). Este arquivo CommonJS
// inicia a aplicação ESM por importação dinâmica, compatível com esse runtime.
import('./server.js').catch((error) => {
  console.error('Falha ao carregar a aplicação:', error)
  process.exit(1)
})
