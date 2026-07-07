;(() => {
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return
  }

  const retryKey = 'dashboard-shell-bootstrap-reload-attempted'
  const errors = []
  window.__dashboardShellBootstrapErrors = errors

  const toText = (value) => {
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    if (value.stack) return String(value.stack)
    if (value.message) return String(value.message)

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const record = (type, event) => {
    errors.push({
      type,
      message: toText(event.error ?? event.reason ?? event.message),
      source: event.filename ?? event.target?.src ?? '',
      line: event.lineno ?? '',
      column: event.colno ?? '',
      time: new Date().toISOString(),
    })
  }

  window.addEventListener('error', (event) => record('error', event))
  window.addEventListener('unhandledrejection', (event) =>
    record('unhandledrejection', event)
  )

  const rootHasMounted = () => {
    const root = document.getElementById('root')
    return root ? root.childElementCount > 0 : false
  }

  const removeDiagnostic = () => {
    document.getElementById('dashboard-bootstrap-diagnostic')?.remove()
    if (rootHasMounted()) {
      observer.disconnect()
      try {
        window.sessionStorage.removeItem(retryKey)
      } catch {
        // Ignore storage failures; the watchdog should never block boot.
      }
    }
  }

  const observer = new MutationObserver(removeDiagnostic)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })

  window.setTimeout(() => {
    const root = document.getElementById('root')
    if (!root || root.childElementCount > 0) return

    try {
      if (window.sessionStorage.getItem(retryKey) !== 'true') {
        window.sessionStorage.setItem(retryKey, 'true')
        window.location.reload()
        return
      }
    } catch {
      // If storage is unavailable, fall through to the visible diagnostic.
    }

    const scripts = Array.from(document.scripts).map(
      (script) => script.src || '[inline script]'
    )

    const panel = document.createElement('main')
    panel.id = 'dashboard-bootstrap-diagnostic'
    panel.style.cssText =
      'box-sizing:border-box;position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:32px;font:14px/1.5 Inter,system-ui,sans-serif;background:#09090b;color:#fafafa;'
    panel.innerHTML = `
      <section style="max-width:900px;margin:0 auto;border:1px solid #3f3f46;border-radius:8px;padding:20px;background:#18181b">
        <h1 style="margin:0 0 8px;font-size:20px">Dashboard bootstrap did not mount</h1>
        <p style="margin:0 0 16px;color:#d4d4d8">The dev HTML loaded, but React did not populate <code>#root</code>. Share the details below with the agent.</p>
        <p style="margin:0 0 16px;color:#d4d4d8">A guarded reload was already attempted once for this tab.</p>
        <h2 style="margin:18px 0 8px;font-size:14px">Captured errors</h2>
        <pre style="white-space:pre-wrap;overflow:auto;margin:0;padding:12px;border-radius:6px;background:#09090b;color:#f4f4f5">${escapeHtml(
          JSON.stringify(errors, null, 2)
        )}</pre>
        <h2 style="margin:18px 0 8px;font-size:14px">Module scripts</h2>
        <pre style="white-space:pre-wrap;overflow:auto;margin:0;padding:12px;border-radius:6px;background:#09090b;color:#f4f4f5">${escapeHtml(
          scripts.join('\n')
        )}</pre>
      </section>
    `
    document.getElementById(panel.id)?.remove()
    document.body.append(panel)
  }, 5000)

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }
})()
