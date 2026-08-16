import { ArrowUpRight } from 'lucide-react'
import { resolveServiceIcon } from '../lib/icon-map'
import type { PresentedService } from '../domain/directory-types'

type Props = {
  service: PresentedService
}

export function ServiceCard({ service }: Props) {
  const Icon = resolveServiceIcon(service.icon)

  return (
    <a className={`service-card theme-${service.cardTheme} card-variant-${service.cardVariant}`} href={service.href} rel="noreferrer" target="_blank">
      <span className="service-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.65} /></span>
      <div className="service-card-copy">
        <h3>{service.name}</h3>
        <p>{service.description}</p>
      </div>
      <span className="open-icon" aria-hidden="true"><ArrowUpRight size={16} /></span>
    </a>
  )
}
