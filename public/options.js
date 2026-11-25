// O editor monta o mesmo formato de grupos aceito pelo formulário sem JavaScript.
for (const source of document.querySelectorAll('textarea[name=groups]')) {
  const original = source.closest('label'),
    hint = original.nextElementSibling
  const editor = document.createElement('section')
  original.before(editor)
  original.hidden = true
  hint.hidden = true
  const groups = []
  function add(tag, parent, text = '') {
    const element = document.createElement(tag)
    element.textContent = text
    parent.append(element)
    return element
  }
  function action(parent, title, fn) {
    const button = add('button', parent, title)
    button.type = 'button'
    button.className = 'quiet'
    button.onclick = fn
  }
  function field(parent, label, value, type = 'text') {
    const input = add('input', add('label', parent, label))
    input.type = type
    input.value = value
    input.required = true
    if (type === 'number') input.min = 0
    return input
  }
  function addGroup(initial = { name: '', min: 0, max: 1, options: [] }) {
    const box = add('fieldset', list),
      fields = add('div', box)
    fields.className = 'row'
    const name = field(fields, 'Nome do grupo', initial.name),
      min = field(fields, 'Mínimo', initial.min, 'number'),
      max = field(fields, 'Máximo', initial.max, 'number')
    const choices = add('div', box),
      rows = []
    function addChoice(option = { name: '', price: 0 }) {
      const row = add('div', choices)
      row.className = 'row'
      const label = field(row, 'Opção', option.name),
        price = field(row, 'Adicional (R$)', (option.price / 100).toFixed(2))
      price.inputMode = 'decimal'
      price.pattern = '[0-9]{1,5}([.,][0-9]{1,2})?'
      rows.push({ row, label, price })
      action(row, 'Remover opção', () => row.remove())
    }
    action(box, '＋ Adicionar opção', () => addChoice())
    action(box, 'Remover grupo', () => box.remove())
    if (initial.options.length) initial.options.forEach(addChoice)
    else addChoice()
    groups.push({ box, name, min, max, rows })
  }
  add('h3', editor, 'Grupos de opções')
  const list = add('div', editor)
  action(editor, '＋ Adicionar grupo', () => addGroup())
  for (const g of JSON.parse(source.dataset.groups)) addGroup(g)
  source.form.addEventListener('submit', (e) => {
    const lines = []
    for (const g of groups.filter((g) => g.box.isConnected)) {
      const rows = g.rows.filter((r) => r.row.isConnected)
      for (const input of [g.name, ...rows.map((r) => r.label)]) {
        input.setCustomValidity(
          /[|;=]/.test(input.value) ? 'Evite os caracteres | ; = no nome.' : '',
        )
        input.oninput = () => input.setCustomValidity('')
      }
      g.max.setCustomValidity(
        Number(g.min.value) > Number(g.max.value) ||
          Number(g.max.value) > rows.length ||
          Number(g.max.value) < 1
          ? 'Confira os limites e a quantidade de opções.'
          : '',
      )
      g.box.oninput = () => g.max.setCustomValidity('')
      g.box.onclick = () => g.max.setCustomValidity('')
      lines.push(
        [
          g.name.value,
          g.min.value,
          g.max.value,
          rows.map((r) => r.label.value + '=' + r.price.value).join('; '),
        ].join(' | '),
      )
    }
    if (!source.form.reportValidity()) e.preventDefault()
    source.value = lines.join('\n')
  })
}
