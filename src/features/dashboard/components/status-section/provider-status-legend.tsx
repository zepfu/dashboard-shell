import type { ReactElement } from 'react'

export function ProviderStatusLegend(): ReactElement {
  return (
    <div
      role='region'
      aria-label='Provider health and quota color legend'
      className='status-color-legend'
    >
      <span className='legend-group-label'>Health</span>
      {[
        ['ok', 'health-ok'],
        ['degraded', 'health-degraded'],
        ['down', 'health-down'],
        ['no data', 'health-no-data'],
        ['miss', 'health-miss'],
      ].map(([label, className]) => (
        <span className='status-legend-item' key={`health-${label}`}>
          <span
            aria-hidden='true'
            className={`status-legend-swatch ${className}`}
          />
          {label}
        </span>
      ))}
      <span className='legend-group-label'>Quota used</span>
      {[
        ['0-5', 'quota-0-5'],
        ['5-10', 'quota-5-10'],
        ['10-25', 'quota-10-25'],
        ['25-50', 'quota-25-50'],
        ['50+', 'quota-50-p'],
      ].map(([label, className]) => (
        <span className='status-legend-item' key={`quota-${label}`}>
          <span
            aria-hidden='true'
            className={`status-legend-swatch ${className}`}
          />
          {label}
        </span>
      ))}
      <span className='legend-group-label'>Burn</span>
      {[
        ['slow', 'velocity-slow'],
        ['steady', 'velocity-steady'],
        ['fast', 'velocity-fast'],
        ['hot', 'velocity-hot'],
        ['peak', 'velocity-peak'],
      ].map(([label, className]) => (
        <span className='status-legend-item' key={`velocity-${label}`}>
          <span
            aria-hidden='true'
            className={`status-legend-swatch ${className}`}
          />
          {label}
        </span>
      ))}
    </div>
  )
}
