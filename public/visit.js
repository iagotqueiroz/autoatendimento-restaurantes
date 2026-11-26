const account = document.querySelector('#visit-account')

if (account) {
  let timer
  async function refresh() {
    if (document.hidden) return schedule()
    try {
      const response = await fetch(account.dataset.refreshUrl, {
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw Error()
      document.querySelector('#visit-live').innerHTML = await response.text()
    } catch {
      document.querySelector('.live-update')?.classList.add('offline')
    }
    schedule()
  }
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(refresh, 4000)
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh()
  })
  schedule()
}
