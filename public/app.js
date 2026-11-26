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
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!confirm(form.dataset.confirm)) event.preventDefault()
  })
})
const sync = document.querySelector('#sync')
if (sync) {
  const ids = () => [...document.querySelectorAll('.order')].map((el) => el.dataset.id)
  const seen = new Set(ids())
  let sound,
    timer,
    delay = sync.dataset.view === 'cozinha' ? 4000 : 6000
  document.querySelector('#sound')?.addEventListener('click', async (e) => {
    sound ??= new AudioContext()
    await sound.resume()
    e.target.textContent = 'Som ativado'
  })
  function timestamp() {
    sync.textContent = 'Atualização automática · ' + new Date().toLocaleTimeString('pt-BR')
    sync.classList.remove('offline')
  }
  async function refresh() {
    if (document.hidden) return schedule()
    try {
      const url = new URL(location.href)
      url.searchParams.set('partial', '1')
      const response = await fetch(url, {
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
      delay = sync.dataset.view === 'cozinha' ? 4000 : 6000
    } catch {
      sync.textContent = 'Sem conexão · tentando novamente…'
      sync.classList.add('offline')
      delay = Math.min(delay * 2, 30000)
    }
    schedule()
  }
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(refresh, delay)
  }
  timestamp()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh()
  })
  schedule()
}
