const tracker = document.querySelector('#order-tracker')

if (tracker) {
  const stageIndex = {
    'aguarda caixa': 0,
    'aguarda aceite': 0,
    aceito: 1,
    'em preparo': 2,
    pronto: 3,
    entregue: 4,
  }
  const stage = document.querySelector('#order-stage')
  const title = document.querySelector('#order-title')
  const payment = document.querySelector('#order-payment')
  const message = document.querySelector('#order-message')
  const live = document.querySelector('#live-status')
  const hero = document.querySelector('.receipt-hero')
  const check = document.querySelector('.receipt-check')
  let delay = 4000,
    timer

  function render(data) {
    stage.textContent = data.stage
    title.textContent = data.title
    payment.textContent = data.payment
    message.textContent = data.message
    const cancelled = data.stage === 'cancelado'
    hero.classList.toggle('receipt-cancelled', cancelled)
    check.textContent = cancelled ? '!' : '✓'
    document.querySelector('#progress-steps').classList.toggle('is-cancelled', cancelled)
    document.querySelectorAll('[data-step]').forEach((step) => {
      const index = Number(step.dataset.step)
      const current = stageIndex[data.stage] ?? 0
      step.classList.toggle('complete', !cancelled && current >= index)
      step.classList.toggle('current', !cancelled && current === index)
      step.querySelector('span').textContent = current > index ? '✓' : index + 1
    })
    live.classList.remove('offline')
    live.lastChild.textContent = 'Atualizado agora'
    delay = ['entregue', 'cancelado'].includes(data.stage) ? 30000 : 4000
  }

  async function refresh() {
    if (document.hidden) return schedule()
    try {
      const response = await fetch(tracker.dataset.statusUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw Error()
      render(await response.json())
    } catch {
      live.classList.add('offline')
      live.lastChild.textContent = 'Reconectando…'
      delay = Math.min(delay * 2, 30000)
    }
    schedule()
  }
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(refresh, delay)
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh()
  })
  schedule()
}
