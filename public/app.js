document
  .querySelector('[data-back]')
  ?.addEventListener('click', () => (history.length > 1 ? history.back() : location.assign('/')))
document.querySelector('.peek')?.addEventListener('click', (e) => {
  const field = e.currentTarget.previousElementSibling
  field.type = field.type === 'password' ? 'text' : 'password'
  e.currentTarget.setAttribute(
    'aria-label',
    field.type === 'text' ? 'Ocultar senha' : 'Mostrar senha',
  )
})
const sync = document.querySelector('#sync')
if (sync) {
  const ids = () => [...document.querySelectorAll('.order')].map((el) => el.dataset.id)
  const seen = new Set(ids())
  let sound
  document.querySelector('#sound').onclick = async (e) => {
    sound ??= new AudioContext()
    await sound.resume()
    e.target.textContent = 'Som ativado'
  }
  function timestamp() {
    sync.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR')
  }
  async function refresh() {
    try {
      const response = await fetch('/painel/cozinha?partial=1', {
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok || response.redirected) throw Error()
      const html = await response.text()
      document.querySelector('#cards').innerHTML = html
      const fresh = ids().filter((id) => !seen.has(id))
      fresh.forEach((id) => seen.add(id))
      if (fresh.length && sound) {
        const tone = sound.createOscillator(),
          gain = sound.createGain()
        gain.gain.value = 0.08
        tone.connect(gain)
        gain.connect(sound.destination)
        tone.start()
        tone.stop(sound.currentTime + 0.16)
      }
      timestamp()
    } catch {
      sync.textContent = 'Sem conexão com o painel. Tentando novamente…'
    }
    setTimeout(refresh, 5000)
  }
  timestamp()
  setTimeout(refresh, 5000)
}
