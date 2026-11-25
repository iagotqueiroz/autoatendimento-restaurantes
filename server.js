// A Hostinger carrega este arquivo com require(). A aplicação permanece em
// módulos ESM e é iniciada por importação dinâmica, compatível com o runtime.
import('./app.mjs').catch((error) => {
  console.error('Falha ao carregar a aplicação:', error)
  process.exit(1)
})
